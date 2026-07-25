## Peer Vaults panel — replace "Network Created Content"

Rename and reshape the bottom section of the **Content Distribution** card (Node Dashboard → `TorrentSwarmPanel`) into a **Peer Vaults** list. Each row is a collapsible per-peer vault summary that expands into a viewable content feed. Add a one-time migration so completed torrents/files already listed in Content Distribution get enrolled into a vault instead of being orphaned.

### Scope (do not touch anything else)

- Only the "Network Created Content" block inside `src/components/p2p/dashboard/TorrentSwarmPanel.tsx` is replaced.
- The Files, Chunks, Active Transfers, Seeding, Ignored, and Retry sections above it are untouched.
- No changes to gossip, chunk fetch, torrent code, or Sync Vault write path — this is a read + one-time enroll UI on top of the existing `syncVault` store.

### UI shape

```text
Peer Vaults                                       [N peers]
─────────────────────────────────────────────────
▸ @host-abcd…  Coins Used: 1   Media Files: 5    12.4 MB
▸ self          Coins Used: 2   Media Files: 9    68.1 MB
    (expanded)
      ┌── Viewable Content Feed ──────────────┐
      │ 🖼 image  photo.jpg      2.1 MB       │
      │ 🎬 video  clip.mp4       18 MB   ▶    │
      │ 🎵 audio  song.mp3       3.2 MB  ▶    │
      │ …                                     │
      └───────────────────────────────────────┘

(empty state)
No peer vaults created.
```

- Row summary comes from `listVaults()` — `coins.length`, `Object.keys(index).length`, sum of `entry.length`.
- Expand renders entries from `vault.index`, grouped by mime icon (reuse existing `mimeIcon`). Clicking an image/video entry opens it inline via existing `resolveFromVaults` bytes → object URL; audio/video get a small play button; unknown mime shows a download link.
- Empty state text is exactly **"No peer vaults created."**

### Migration — enroll existing completed content

Add `src/lib/blockchain/vaultMigration.ts` with `migrateCompletedTorrentsIntoVaults()`:

1. Read completed items already surfaced in this panel:
   - `files` where `percent === 100` (owner = source peer, or `self` when `owner === localPeerId`).
   - `persistedTorrents` where `state === 'seeding' | 'complete'` (owner defaults to `self`).
2. For each, if `findVaultEntry(contentHash)` returns null:
   - `ensureVault(ownerPeerId)`
   - `getOrRolloverReceiverCoin(ownerPeerId, walletCoins)` (or `allocateVaultCoin(..., 'canonical', ...)` when owner is self)
   - `recordVaultEntry(ownerPeerId, contentHash, { coinId, offset: 0, length: size, mime, ref: fileId|manifestId })`
   - Never fetch new bytes — migration is index-only; bytes stay wherever they already live (chunks store / torrent store).
3. Guardrails:
   - Runs once per session, guarded by a `sessionStorage` flag `vault-migration-v1-done`.
   - Skips silently if no wallet coins are available to allocate (surfaces a "Mine a SWARM coin to enroll" hint in the empty state).
   - Wrapped in try/catch per item so a single failure doesn't abort the batch.

Triggered on `TorrentSwarmPanel` mount, after the first `loadFiles` + `loadPersistedTorrents` complete.

### Files touched

- `src/components/p2p/dashboard/TorrentSwarmPanel.tsx` — replace the block from `{/* TorrentSwarm overlay ... */}` (lines ~400–426) with a new `<PeerVaultsSection />` local component. Everything else is unchanged.
- `src/lib/blockchain/vaultMigration.ts` — new, ~80 lines.
- No new DB store, no new gossip topic, no changes to existing vault code.

### Acceptance

1. Bottom of Content Distribution reads **Peer Vaults**; heading `Network Created Content` is gone.
2. With no vaults, shows exactly `No peer vaults created.`
3. With vaults, each peer row shows `Coins Used: N  Media Files: M` and expands to a scrollable content feed rendered from `vault.index`.
4. After first load with completed files/torrents present, one vault appears containing those items; refresh does not re-run migration (session flag).
5. Media entries render/play from vault bytes; no torrent dial visible in devtools for already-migrated items.
6. Typecheck clean; existing torrent, chunk, gossip test suites unchanged.
