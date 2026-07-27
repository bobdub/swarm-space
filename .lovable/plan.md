## Goal
Keep the existing 500 MiB Media Coin utility exactly as designed. Fix only the two real problems:

1. Two writers (`vaultIngest` receiver-coin path + `vaultEnroll` media-coin path) are writing into the same vault at the same time, which is why the dashboard sometimes shows multiple filling coins and mixed 100 MiB / 500 MiB capacities.
2. Stage transitions are scattered across many helpers with legacy flags. Collapse them into one linear pipeline.

Nothing about coin sizing, seal fraction, or oversized handling changes.

## Fixed pipeline (no new concepts)

```text
Completed content
   │
   ▼
Archived Stage      → written into vault via a SINGLE writer (enrollContent)
                      vault key = ownerPeerId, or "archive:global" if unknown
   │
   ▼
Wrapping Stage      → getOrCreateMediaCoin picks the current 500 MiB filling coin,
                      or allocates a new one, per the rules already in syncVault.ts
                      (oversized → dedicated coin; would-cross-seal → seal old + new coin)
   │
   ▼
Sealed Stage        → seal at ≥350 MiB (existing MEDIA_COIN_SEAL_FRACTION) or oversized-complete
   │
   ▼
Routed to peer      → existing wrap sweep engraves onto a free wallet coin
                      (skipped for archive:global — migration content stays put)
```

Files can create as many coins as their sizes demand. There is no per-vault coin cap.

## Root cause of the "multi coins filling" bug
`src/lib/blockchain/vaultIngest.ts` still calls `getOrRolloverReceiverCoin`, which allocates a 100 MiB `receiver`-role coin into the same vault that `vaultEnroll.ts` is filling with a 500 MiB `media`-role coin. Both writers race on the same `syncVaults` record, so the UI shows two filling coins with different capacities. This is the "two scripts fighting to write the coin" behavior.

## Changes (minimal, no bloat)

### 1) Delete the tangled receiver path
- `src/lib/blockchain/vaultIngest.ts` — rewrite as a thin adapter that calls `enrollContent(...)` from `vaultEnroll.ts` for each `onMediaCustody` event, using the piece hash as `contentHash` and the reported byte length as `size`. No coin allocation here anymore.
- `src/lib/blockchain/syncVault.ts` — remove `getOrRolloverReceiverCoin`, `allocateVaultCoin`, `activeReceiverCoin`, `VAULT_COIN_CAPACITY_BYTES`, `VAULT_ROLLOVER_FRACTION`, and the `"receiver"` variant from `VaultCoinRole`. Remove `ensureArchiveCoin` and `promoteArchivedEntries` (both unused once the receiver path is gone; the archive is expressed via the `archive:global` vault key, not a role).

### 2) Boot-time repair for existing vaults
Add `reconcileLegacyVaultCoins()` to `syncVault.ts` and call it once from `src/main.tsx` boot sequence (next to the existing `reconcileMediaCoins` call). It walks every vault and:
- Coerces any `role: "receiver"` or `role: "archive"` ref that carries entries into `role: "media"` sealed with reason `reconcile`.
- Drops any receiver/archive ref that has no entries.
- Leaves everything else alone.

No entries are lost; sealed reconciled coins still serve via the existing content resolver path.

### 3) Single writer guarantee
- All content ingestion funnels through `enrollContent` in `vaultEnroll.ts`. The existing `findVaultEntry` idempotency check plus the `consolidateUnsealedMediaCoins` invariant already enforce "at most one filling coin per vault"; removing the receiver writer is what actually makes it hold in practice.

### 4) Dashboard cleanup
`src/components/p2p/dashboard/TorrentSwarmPanel.tsx` — remove any UI branch that reads `role === "receiver"` or the 100 MiB `VAULT_COIN_CAPACITY_BYTES`. Keep the existing Filling / Approaching / Sealing / Sealed / Wrapped / Failed chips exactly as they are. This is a delete-only change in the UI.

### 5) Tests
Extend `src/lib/blockchain/__tests__/syncVault.test.ts`:
- `vaultIngest` events end up as `media` coins, never as `receiver`.
- A vault preloaded with a legacy `receiver` ref plus entries is repaired into a sealed media ref with the same entries intact.
- The single-filling-coin invariant still holds after mixed enrollContent + custody-event traffic.

## Explicitly NOT changing
- 500 MiB `MEDIA_COIN_CAPACITY_BYTES`.
- 70% `MEDIA_COIN_SEAL_FRACTION` (≈350 MiB seal line).
- Oversized-file handling in `getOrCreateMediaCoin`.
- Stuck-write watcher, wrap sweep, seal-assist, contentResolver priority.
- Any transport, torrent, or encryption code.

## Validation
- Run vault tests.
- Load the dashboard: only 500 MiB `media` coins visible; no 100 MiB entries; at most one filling coin per vault.