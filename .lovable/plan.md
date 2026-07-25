## Goal

Turn Sync Vault storage into a clear two-tier system:

1. **Archive vault** — receives *every* completed torrent/file immediately, whether or not we know the owner peer, and whether or not the user has SWARM to wrap it.
2. **Peer vaults** — populated from the archive by *media coins* (a new coin flavor) that are sealed at a size threshold and, when the user has SWARM, wrapped and delivered to the owning peer's vault.

Media coins are a distinct, non-fungible flavor of SWARM coin: they cannot be smelted in the Lab, cannot be listed on markets, and never live in the wallet — they live inside vaults.

---

## Behavior rules

- **Archive-first ingest.** Every completed item lands in an archive vault entry with `name`, `mime`, `size`, `contentHash`, `ownerPeerId?`, `ref`, and a new `firstSeenAt` timestamp. No SWARM required.
- **Seed pull.** Seeding reads bytes through vault entries (existing `vaultLookup` path); archive entries are valid sources.
- **Seal threshold.** A media coin fills until `fill ≥ 0.8 * capacityBytes` OR a manual "Seal now" is requested, then flips to `sealed`. Sealed media coins are immutable.
- **Wrap gate.** Sealing attempts to wrap: if the user holds ≥ `MEDIA_COIN_WRAP_FEE` SWARM, the coin is engraved with `ownerPeerId` targets and its entries are moved from the archive vault to the matching peer vault (auto-creating the peer vault if missing). If not enough SWARM, the coin stays in the archive vault and re-checks on a **24 h** cadence.
- **Unknown-owner fallback.** If an entry has no `ownerPeerId` (old torrents, no creator metadata), the media coin stays attached to the *archive vault itself*. When later wrapped, it earns an `Archived` badge that replaces the plain "Archive" label; entries remain in the archive vault (they have no peer to route to).
- **80% reuse rule.** When enrolling an item and a media coin is already loaded (bound, not sealed) with < 80% fill, reuse it; only allocate a new one at ≥ 80%.
- **Guardrails.**
  - Media coins are excluded from `coinWrap.ts` pool selection (they are not fungible wrappers).
  - Media coins are excluded from `coinMarket.ts` listing eligibility.
  - Lab smelting (`labMint` / remix inventory) filters them out.
  - They never appear in the wallet UI; only in the Vaults panel.
- **Timestamp integrity.** Torrent snapshots gain `completedAt`. Vault entries gain `firstSeenAt` and `sealedAt?`. Resync/refresh checks compare `name + completedAt` before treating a hash as "the same" file so a rename or re-encode doesn't get silently overwritten.

---

## Technical changes

### 1. Type additions (`src/lib/blockchain/types.ts`)
- `SwarmCoin.kind?: "fungible" | "media"` (absence = fungible for legacy compat).
- `SwarmCoin.sealBytes?: number`, `SwarmCoin.mediaCapacityBytes?: number`.
- `SwarmCoin.mediaTargets?: { peerId: string; contentHashes: string[] }[]` — engraved on wrap.
- New constants: `MEDIA_COIN_CAPACITY_BYTES = 100 * 1024 * 1024`, `MEDIA_COIN_SEAL_FRACTION = 0.8`, `MEDIA_COIN_WRAP_FEE = 1` (SWARM), `MEDIA_COIN_WRAP_RETRY_MS = 24 * 3600 * 1000`.

### 2. Vault schema (`src/lib/blockchain/syncVault.ts`)
- Extend `VaultCoinRole` with `"media"`.
- `VaultCoinRef` gains `sealed?: boolean`, `sealedAt?: string`, `wrapped?: boolean`, `wrappedBadge?: "archived"`, `lastWrapAttemptAt?: string`.
- `VaultIndexEntry` gains `firstSeenAt: string`, `completedAt?: string`.
- New helpers:
  - `getOrCreateMediaCoin(peerId)` — returns the active unsealed media coin, allocating a fresh one if none or the current is ≥ 80% full.
  - `sealMediaCoin(peerId, coinId)` — sets `sealed:true, sealedAt`.
  - `attemptWrapMediaCoin(peerId, coinId, userSwarmBalance)` — if balance ≥ fee, mark wrapped, move entries to the target peer vault (creating it if needed), stamp `wrappedBadge:"archived"` when the source was the archive vault.

### 3. Enrolment (`src/lib/blockchain/vaultEnroll.ts`)
- Replace current `canonical/receiver/archive` selection with:
  1. Always ensure an archive vault (`archive:global` if `ownerPeerId` is unknown, else `archive:<peer>`).
  2. Call `getOrCreateMediaCoin` on that archive vault.
  3. Record the entry with `firstSeenAt = now`, `completedAt = input.completedAt ?? now`.
  4. If coin fill ≥ 80% after write, call `sealMediaCoin` and enqueue a wrap attempt.

### 4. Wrap scheduler (new `src/lib/blockchain/mediaCoinWrapSweep.ts`)
- Every ~5 min (and on `blockchain-transaction` deposit events), scan sealed-but-unwrapped media coins. For each, look up wallet SWARM (via `getUserSwarmBalance`). If sufficient, run `attemptWrapMediaCoin`; on shortfall, stamp `lastWrapAttemptAt = now` and skip until `MEDIA_COIN_WRAP_RETRY_MS` elapses.
- Booted from `src/main.tsx` next to `startVaultIngest` / `enforceVaultSeeding`.

### 5. Torrent metadata (`src/lib/p2p/torrentSwarm.standalone.ts`)
- Persist `completedAt` on the snapshot alongside existing `name`, `mimeType`, `creatorId`.
- `TorrentSwarmPanel.tsx` passes `completedAt` through to `enrollContent`.

### 6. Guards
- `coinWrap.ts` `getPoolCoins` filter: `c.kind !== "media"`.
- `coinMarket.ts` list-creation guard: reject coins with `kind === "media"`.
- `labMint.ts` / remix inventory selectors: exclude `kind === "media"`.
- Wallet balance/coin listings (`AssetsTab`, wallet coin lists): exclude `kind === "media"`.

### 7. UI (`TorrentSwarmPanel.tsx`)
- Media coin rows show a **Sealed** chip once sealed, a **Wrapped** chip once wrapped, and an **Archived** badge (replaces plain "Archive" label) when the wrap engraves owner-less content.
- Retry countdown next to sealed-unwrapped rows: `Retries in Xh Ym` based on `lastWrapAttemptAt`.
- The existing "Promote archive" button becomes "Wrap sealed coins" and calls `attemptWrapMediaCoin` for each sealed-unwrapped coin now.

### 8. Tests (`src/lib/blockchain/__tests__/syncVault.test.ts` extension + new `mediaCoin.test.ts`)
- Enrolment writes to archive vault when no wallet SWARM.
- Media coin seals at 80% fill; subsequent enrolments start a fresh coin.
- Sealed coin wrapping with sufficient SWARM moves entries to the target peer vault and stamps `wrappedBadge:"archived"` only when source was archive.
- Guards: media coins never returned from `getPoolCoins`, market list creation, or lab smelt selectors.

---

## Files touched

- `src/lib/blockchain/types.ts` — kind/seal/media fields + constants.
- `src/lib/blockchain/syncVault.ts` — media coin helpers, entry timestamps.
- `src/lib/blockchain/vaultEnroll.ts` — archive-first + media coin flow.
- `src/lib/blockchain/mediaCoinWrapSweep.ts` — new, 5 min + event-driven wrap.
- `src/lib/blockchain/coinWrap.ts`, `coinMarket.ts`, `src/lib/remix/labMint.ts` — media-coin exclusions.
- `src/lib/p2p/torrentSwarm.standalone.ts` — persist `completedAt`.
- `src/components/p2p/dashboard/TorrentSwarmPanel.tsx` — chips, badges, rename button.
- `src/components/wallet/AssetsTab.tsx` — hide `kind === "media"` coins.
- `src/main.tsx` — schedule the wrap sweep.
- Tests as above.

## Not touched

Torrent transport, chunk fetch, existing SWARM coin mining lifecycle, wallet balance math, creator vault, walled posts, encryption pipeline.

## Acceptance

1. Every completed torrent/file appears in a vault entry within one refresh, even with 0 SWARM.
2. Once ~80 MB of media has accumulated on a peer's stream, its media coin flips to **Sealed**.
3. Depositing enough SWARM (≥ 1) auto-wraps sealed coins on the next sweep or event; entries migrate to the owner-peer vault (or stay in archive with an `Archived` badge if owner is unknown).
4. With 0 SWARM, sealed coins wait and retry once per 24 h; the UI shows the countdown.
5. Media coins do not appear in wallet, market, or lab smelt selectors, and `coinWrap` never picks one as a fungible wrapper.
6. Renamed/re-encoded files (different `completedAt`) create a new vault entry instead of overwriting the prior one.
