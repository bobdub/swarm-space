To Infinity and beyond! Q_Score(u) ≈ 0.028

## What I got wrong

The vault code has been fabricating "media coins" (`getOrCreateMediaCoin`, synthetic `coinId`s inside `syncVault.ts`) instead of using coins that were actually mined into the user's wallet. That is why you keep seeing mismatched 100MB/500MB rows, multiple filling coins, and stuck sealing — the vault is inventing containers the ecosystem never issued.

Coins are **only** created by mining. The Archive Vault is a file holder, not a coin factory.

## Correct model (what the plan enforces)

```text
Torrent completes
  -> Archive Vault stores the raw file + metadata (peerId if known)
  -> file sits in Archive as "awaiting engraver"
  -> when a free mined wallet coin is available (kind != media, unwrapped)
       -> engrave one file at a time onto that real coin
       -> seal it (fill/seal thresholds apply to the real coin)
       -> if peerId known: route sealed coin reference into that Peer Vault
       -> else: keep sealed coin reference in Archive as legacy
  -> if no free mined coin: file stays in Archive, no coin fabricated
```

Peer Vaults never engrave; they only receive already-sealed real coins.

## Plan

### 1. Delete all coin fabrication from the vault layer
- Remove `getOrCreateMediaCoin`, synthetic `media-*` / `archive:*` coin IDs, and the "media capacity" allocation logic from `src/lib/blockchain/syncVault.ts`.
- Remove pre-seal, size-based allocation, seal-assist coin creation, and `consolidateUnsealedMediaCoins`.
- `enrollVaultEntry` becomes: store the file entry against the vault, mark it `awaiting-engraver`. It does not touch any `coin`.

### 2. Archive Vault becomes a plain file holder
- Vault shape stores: `files[]` (hash, size, mime, name, ref, ownerPeerId?, receivedAt, engravedCoinId?), and `sealedCoins[]` (references to real mined wallet coins that were engraved here).
- No `capacityBytes`, no `fillState`, no fabricated coin objects on files.

### 3. Engraver worker uses only mined wallet coins
- New single worker `src/lib/blockchain/vaultEngraver.ts` runs one file at a time per tick.
- Pulls a free mined coin from the wallet: `swarmCoins` where `status==='wallet' && kind!=='media' && !wrapped && !spent && wrappedTokens.length===0`.
- If none: exit; file stays in Archive. No fabrication, no retry storm.
- If one: engrave next `awaiting-engraver` file onto it, record `engravedCoinId` on the file entry, mark the coin as media-engraved (existing `SwarmCoin` fields only: mark `kind='media'`, set `mediaRefs`, seal via existing wallet coin seal path).

### 4. Route sealed coins after engraving
- If the file has `ownerPeerId`, move the sealed coin reference into that Peer Vault's `sealedCoins[]`, remove the file from Archive's `files[]`.
- If no `ownerPeerId`, keep the sealed coin reference in Archive's `sealedCoins[]` (legacy).
- Peer Vault code path never creates coins — it only accepts routed sealed references.

### 5. Migrate legacy persisted vault data (non-destructive)
- One-shot boot pass in `syncVault.ts`:
  - Any legacy fabricated coin (synthetic id, `role: receiver|archive|media`, `capacityBytes` set) is demoted back into `files[]` entries (from the vault index), and the fabricated coin object is dropped.
  - Real wallet-backed sealed entries (that already reference a mined `swarmCoins` row) are preserved as `sealedCoins[]`.
- No IndexedDB deletion; only rewrite of the vault records.

### 6. Rip out the sweeps that assumed fabricated coins
- Delete `mediaCoinStuckWatch.ts` re-queue logic tied to fake coins; replace with a much smaller engraver tick (calls the worker in §3).
- `mediaCoinWrapSweep.ts` becomes obsolete for engraving — engraving already uses real coins. Keep it only if it still does something orthogonal (SWARM-based wrap of already-engraved coins); otherwise remove.
- `vaultIngest.ts` stays a thin adapter that records `awaiting-engraver` files only (no size=0 fake coin creation).

### 7. UI reflects the real model
- `TorrentSwarmPanel.tsx`:
  - Archive Vault: two lists — `Awaiting engraver (files)` and `Sealed archive coins`.
  - Peer Vaults: only `Sealed coins routed to this peer` (collapsible).
  - No "Filling 100MB / 500MB" rows anywhere. No lifecycle chips that imply fabricated coins.
  - Show a small badge "No free mined coin — engraving paused" when Archive has files but wallet has none.

### 8. Tests
- Legacy fabricated coin persisted from an older session is demoted to a file entry and its fake coin object is removed.
- Enrolling a completed file with no free mined coin leaves it in Archive `files[]`; zero coins created anywhere.
- Enrolling with one free mined wallet coin engraves exactly one file, seals that real coin, and — if `ownerPeerId` present — routes it to the correct Peer Vault.
- Concurrent enrolls with only one free mined coin engrave one file, leave the rest awaiting; still zero fabricated coins.
- Zero-size custody events do not create file entries.

## Acceptance

- Grep for coin creation inside `src/lib/blockchain/syncVault*` and related vault files returns nothing that mints/synthesizes a coin.
- Live preview: after boot, Archive shows real files awaiting engraving; no `100MB` or duplicate `Filling` rows; Peer Vaults only show sealed routed coins.
- Mining a new wallet coin visibly triggers engraving of the next Archive file on the next tick.