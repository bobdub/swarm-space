## Goal

Make Media Coins the authoritative source-of-truth for content verification and serving, with:

1. **Offline-safe creation** — sealed archive coins can be built from purely local, already-verified content.
2. **Stuck-write recovery** — stalled engraves are sealed as immutable "failed archives" and retried on a fresh coin.
3. **Zero-interruption serving** — torrents remain the fallback until a coin is `complete`, then serving flips to the coin.
4. **Viewer-first presentation** — completed media always renders in its typed viewer, never as a raw archive blob.

Nothing in this plan touches WebRTC, mesh transport, mining, or the existing wallet coin lifecycle.

---

## Behavior rules

### Media Coin lifecycle states (new, tracked on `VaultCoinRef`)

```text
filling  →  encrypting  →  writing  →  sealed  →  wrapped        (happy path)
                    ↘  stalled  →  sealed(failed=true)             (stuck path)
```

- `filling` — active receiver; still accepting entries.
- `encrypting` / `writing` — sealed threshold hit, engrave in progress.
- `sealed` — immutable, ready for wrap sweep.
- `wrapped` — engraved onto a wallet coin (existing state).
- `failed=true` — sealed but incomplete; excluded from serving, retained for audit.

### Migration (existing content → coin)

1. **Pre-check stuck state.** Before enrolling anything, scan for coins in `encrypting`/`writing` whose `lastProgressAt` is older than `STUCK_WRITE_MS` (2 min). Run `resyncStalled()` first — one retry pass to complete recent stalls before allocating new coins.
2. **Enroll** via existing `enrollContent` (unchanged happy path).
3. **Torrent stays authoritative** for that content until the coin reports `sealed && !failed` and the underlying bytes verify against the manifest.
4. **Flip on completion.** `vaultLookup.resolveFromVaults` becomes the primary read path for any hash whose coin is `sealed && !failed` (currently exists but is unused; wire it into the content bridge).
5. **Peer-associated placement.** If `ownerPeerId` is known at seal time, entries move to `archive:<peer>` on wrap (existing logic). Global archive keeps its `Archived` badge.

### Offline creation

- Enrollment already runs against local IndexedDB — no P2P calls in `syncVault.ts`/`vaultEnroll.ts`. We only need to **stop gating** offline runs and add reconnect announcement.
- Add `mediaCoinReconnectSync.ts`: listens for `p2p-online` / network status events and, on transition offline→online, calls `announceLocalCoins()` and `runWrapSweep()`.
- If a hash referenced by an entry is missing from local storage, mark the entry `awaitingSync: true` and skip seal until bytes arrive (guards against sealing an empty shell).

### Stuck-write detection & recovery (new `mediaCoinStuckWatch.ts`)

- Every 30 s, scan `filling`/`encrypting`/`writing` coins. For each:
  - Track `lastProgressAt` (bump on every `recordVaultEntry` or engrave step).
  - If `now - lastProgressAt > STUCK_WRITE_MS` (2 min) AND `fillBytes > 0` AND coin is not `sealed`:
    1. Mark `sealed = true, failed = true, sealedAt = now`.
    2. Detach the affected entries from this coin (`stalledFromCoinId` breadcrumb kept for audit).
    3. Requeue each detached entry through `enrollContent` from scratch — never resume mid-percentage.
    4. Emit `media-coin-stalled` bus event for UI toast.
- Failed coins never wrap and never serve; wrap sweep and lookup filter `failed`.

### Content serving priority (new `contentResolver.ts` — thin façade)

```text
1. Media Coin (sealed && !failed && verified)   → serve via vaultLookup
2. Torrent / file transfer                       → existing path
3. Peer sync request                             → existing path
4. Retry coin creation                           → enqueue enrollContent
```

- Callers that currently bypass vaults (image/video/audio players in `WallPostBillboard.tsx`, blog hero, feed media) switch to `resolveContent(hash, { mime })` which returns `{ bytes, mime, source }`.
- Presentation rule: if `mime` starts with `image/`, `video/`, `audio/`, or is a supported embed, mount the typed viewer with the resolved bytes/blob URL. Only fall back to a raw-download button when no viewer matches.

### Guards / invariants (extend existing)

- `attemptWrapMediaCoin` refuses `failed` coins.
- `listSealedMediaCoins` filters `failed`.
- `resolveFromVaults` refuses entries whose coin is `failed` or not yet `sealed && verified`.
- `coinWrap.ts`, `coinMarket.ts`, `labMint.ts` already exclude `kind === "media"`; verify the `failed` bit doesn't leak into wallet views either.

---

## Technical changes

### 1. `src/lib/blockchain/syncVault.ts`
- Extend `VaultCoinRef` with `phase?: "filling" | "encrypting" | "writing" | "sealed"`, `failed?: boolean`, `lastProgressAt?: string`, `stalledFromCoinId?: string`.
- Extend `VaultIndexEntry` with `awaitingSync?: boolean`.
- `recordVaultEntry` bumps `lastProgressAt` on the target coin.
- New helpers: `markCoinPhase(peerId, coinId, phase)`, `markCoinFailed(peerId, coinId)`, `detachEntriesFromCoin(peerId, coinId): VaultIndexEntry[]`.

### 2. `src/lib/blockchain/mediaCoinStuckWatch.ts` (new)
- 30 s interval + `visibilitychange` kicker.
- `STUCK_WRITE_MS = 120_000`.
- Uses `listVaults` → filter unsealed → apply rule → seal-failed + requeue.
- Exports `startStuckWatch()`.

### 3. `src/lib/blockchain/mediaCoinReconnectSync.ts` (new)
- Subscribes to existing `p2p-connection-state` bus.
- On offline→online: broadcast local sealed-coin manifests + trigger `runWrapSweep`.
- No-op if already online at boot.

### 4. `src/lib/blockchain/contentResolver.ts` (new)
- `resolveContent(hash, hint?) → { bytes, mime, source: "coin" | "torrent" | "peer" | "pending" }`.
- Order: `resolveFromVaults` → existing torrent/file lookup (`getChunk` / `fileTransfers`) → peer request → pending.
- Skips coin path when phase !== `sealed` or `failed`.

### 5. `src/lib/blockchain/vaultLookup.ts`
- Add coin-state gate: return `null` when the entry's coin is `failed` or not yet `sealed`.

### 6. `src/lib/blockchain/vaultEnroll.ts`
- Call `resyncStalled()` (from stuck watch) as first step.
- Set `phase: "filling"` on new coin; bump `lastProgressAt`.

### 7. `src/lib/blockchain/mediaCoinWrapSweep.ts`
- Filter out `failed` coins in `listSealedMediaCoins` consumer.

### 8. UI — `src/components/p2p/dashboard/TorrentSwarmPanel.tsx`
- New chips: `Encrypting`, `Writing`, `Failed archive`, `Awaiting sync`.
- Grouped "Failed archives" collapsible section under Completed.
- Toast on `media-coin-stalled` event with "View coin" link.

### 9. Viewer routing — surgical, presentation-only
- `src/components/world/WallPostBillboard.tsx`, `BlogPostCard`, feed media components: switch content reads to `resolveContent`. Keep existing viewer components; just feed them the resolved bytes/blob URL. Raw-archive fallback only when `mime` is unknown.

### 10. Boot wiring — `src/main.tsx`
- Add `startStuckWatch()` and `startReconnectSync()` next to `startWrapSweep()`.

### 11. Tests
- `mediaCoinStuckWatch.test.ts` — stalled coin gets sealed+failed, entries requeue onto a fresh coin.
- `contentResolver.test.ts` — priority order (coin > torrent > peer > pending), failed coin is skipped.
- Extend `syncVault.test.ts` — `awaitingSync` blocks seal, `lastProgressAt` bumped on record.

---

## Files touched

- Modify: `syncVault.ts`, `vaultEnroll.ts`, `vaultLookup.ts`, `mediaCoinWrapSweep.ts`, `TorrentSwarmPanel.tsx`, `WallPostBillboard.tsx`, `main.tsx`, plus 2–3 media-consuming feed/blog components.
- Add: `mediaCoinStuckWatch.ts`, `mediaCoinReconnectSync.ts`, `contentResolver.ts`, tests.

## Not touched

Mesh transport, WebRTC, mining, wallet math, existing torrent chunker, encryption pipeline, creator vault, walled posts.

## Acceptance

1. Offline: enrolling a locally-complete file produces a `sealed` media coin without a live P2P connection.
2. A coin whose `writing` phase stalls >2 min is sealed as `failed`, its entries requeue on a new coin, and torrent serving is uninterrupted throughout.
3. Once a coin reports `sealed && !failed`, subsequent reads for that hash come from the vault path; torrent stays as fallback only.
4. Media whose MIME maps to a known viewer never renders as a raw archive download.
5. Failed coins never appear in wrap sweep, market, wallet, or serving; they remain visible in the panel under "Failed archives".
6. On reconnect after offline creation, new local coins are announced and the wrap sweep runs.
