## Media Coin — Sync Vaults & Local-First Retrieval

Extends the existing standalone Media Coin engine with **per-peer Sync Vaults** so mined SWARM coins become verifiable local storage for content received from trusted peers. Keeps all existing sync paths (gossip, chunk, manifest, torrent) untouched — the vault is read-through cache + local seeder, never a new transport.

### Guardrails (non-negotiable)
- Zero changes to existing gossip / chunk / manifest / torrent code paths. Vault sits *beside* them as cache + verifier.
- Respects `mem://constraints/memory-coin-exploration-only`: this is **user content** (creator media), not learned-pattern coins, so it's in scope — but ships behind a soft flag (`?vaults=1` + Settings toggle) defaulting on for new installs, off until first successful bind for existing users, with a kill-switch.
- Only `sealed` SWARM coins from the wallet can be allocated as vault containers (respects `coinSpend` rules). Vault allocation is a non-destructive tag, not a `spent` transition.
- Storage-quota guarded via existing `quotaGuard` — vault writes stop at 90% and surface the existing warning.

### Architecture

```text
                ┌─────────────────────────────┐
   creator ──►  │  Media Coin (canonical)     │ ── torrent ──► peers
                │  1 coin per published item  │
                └─────────────────────────────┘
                              │
                              ▼
peer B connects to peer A ──► Sync Vault(peerA)
                              ├─ Media Coin #1  [~80% full]
                              ├─ Media Coin #2  [filling]
                              └─ manifest index (hash → coin+offset)

feed request ──► vault.lookup(hash)
                  ├─ HIT  → serve locally, skip torrent
                  └─ MISS → torrent fetches missing pieces → write into active vault coin
```

### Deliverables

**1. Sync Vault store** — `src/lib/blockchain/syncVault.ts`
   - `SyncVault { peerId, coins: VaultCoinRef[], index: Map<contentHash, {coinId, offset, length}>, updatedAt }`
   - `VaultCoinRef { coinId, role: 'canonical'|'receiver', fillBytes, capacityBytes }` — capacity derived from existing coin `maxWeight` scaled to bytes.
   - CRUD via IndexedDB (`swarm-vaults` store, versioned through existing DB upgrade lifecycle — non-destructive).
   - `allocateVaultCoin(peerId)` — pulls a sealed wallet coin, tags it as vault container, opens at 0% fill.
   - `rolloverAt80(peerId)` — auto-allocates new receiver coin once active one crosses 80% capacity.

**2. Creator canonical binding** — extend `mediaCoin.standalone.ts` (additive only)
   - On mint, tag the created NFT coin as `role: 'canonical'` inside the creator's own vault (`peerId = self`). Existing mint flow unchanged; just fires a new `emitMediaCustody` we already have.

**3. Receiver write path** — `src/lib/blockchain/vaultIngest.ts`
   - Subscribes to `onMediaCustody` (existing bus) — when a piece is verified & reassembled, writes bytes into the active receiver coin of the source peer's vault, updates the index.
   - No changes to `chunkFetch.ts` / torrent code — this only *observes* completion events already emitted.

**4. Local retrieval short-circuit** — `src/lib/blockchain/vaultLookup.ts`
   - `resolveFromVaults(contentHash): Uint8Array | null` — feed and preview call this *before* dialing torrents. Miss falls through to the existing pipeline unchanged.
   - Wired into `contentPipeline.ts` at one call site (guard-flag gated).

**5. Torrent reinforcement (read-only)** — `src/lib/blockchain/vaultSeeder.ts`
   - Registers vault-held pieces with `meshTorrentAdapter` as *available* so the existing swarm treats us as a seeder. Uses the adapter's existing "have" API — no new gossip topic, no new pubsub channel.

**6. UI surfaces (minimal)**
   - Wallet → Coins: badge sealed coins tagged as vault containers with source peer + fill %.
   - `/storage-diagnostics`: new "Sync Vaults" panel — peers, coin counts, vault size, hit-rate counter, "Purge vault for peer X" button.
   - Settings → Storage: toggle "Use SWARM coins as media cache" (default on).

**7. Tests**
   - `syncVault.test.ts` — allocate, rollover at 80%, index round-trip.
   - `vaultLookup.test.ts` — hit/miss falls through cleanly, no torrent dial on hit.
   - `vaultSeeder.test.ts` — announces `have` pieces to adapter without new topics.

### Explicit non-goals (this plan)
- No changes to coin economics, mining, spend rules, or lifecycle states.
- No new gossip topics, pubsub channels, or transport paths.
- No cross-peer vault sync — each vault is strictly local.
- No auto-migration of existing cached media into vaults (opportunistic on next fetch).
- Learned-pattern / brain memory coins remain out of scope per existing constraint.

### Acceptance
1. Publishing media creates one canonical Media Coin in the creator's self-vault, visible in Wallet.
2. Receiving media from peer X writes into vault(X); coins roll over at 80% fill.
3. Reloading a feed item served earlier hits the vault (verified via hit-counter) with zero torrent requests in devtools network.
4. Toggling the Settings switch off restores pre-vault behavior identically.
5. UQRC check + typecheck clean; no changes to gossip/chunk/manifest test suites.
