To Infinity and beyond!, Q_Score(u) ≈ 0.033

## Goal
Make Media Coin sealing reliable for large files, especially files at or above the 500 MiB coin capacity, without losing access to completed media.

## Confirmed current behavior from code
- Oversized files already get a dedicated Media Coin sized to the file, then `vaultEnroll.ts` calls `sealMediaCoin()` after `recordVaultEntry()` completes.
- `sealMediaCoin()` is only a metadata flip: it marks the vault coin `sealed` and `sealedAt`; it does not require remaining byte capacity.
- Serving from Media Coins is blocked until `coin.sealed === true`; while not sealed, `contentResolver.ts` falls back to the existing chunk/torrent path.
- The wrap step later consumes a free wallet coin, but that is separate from the vault seal state.

## Likely issue to fix
The jam is probably not “no room left inside the oversized media coin,” because sealing itself does not add bytes. The safer fix is to harden the seal lifecycle so a completed oversized write cannot remain indefinitely in `writing`/unsealed state, and so wrap can handle large sealed coins without pretending the wrapper coin must have 500 MiB of spare metadata room.

## Plan
1. **Add explicit seal intent metadata**
   - Extend Media Coin refs with lightweight fields such as `sealRequestedAt`, `sealReason`, and `sealAssistedByCoinId`.
   - Use these only for state tracking and UI diagnostics; do not change file bytes.

2. **Make completed oversized writes force-sealable**
   - After a file entry is recorded successfully, if `size >= MEDIA_COIN_CAPACITY_BYTES`, call a stronger seal helper that:
     - verifies the entry exists on the coin,
     - marks phase as `sealed`,
     - sets `sealed = true`,
     - records the seal reason as `oversized-complete`.
   - This matches your “if media/file is done and sealing is still stuck, count it as sealed” idea, but only after successful record completion.

3. **Add jam recovery for already-completed writes**
   - Update the stuck-watch logic so if an unsealed Media Coin is stuck but already has completed vault entries, it soft-seals it instead of immediately failing/requeueing.
   - Only use fail-and-requeue when there are no completed entries or the entry is still awaiting sync.
   - This protects access to completed large files.

4. **Add optional seal-assist coin logic for wrap pressure**
   - During wrap sweep, if a sealed Media Coin is too large or otherwise cannot be represented by one free wallet coin, allow an additional free wallet coin to be attached as a `sealer`/assist marker.
   - The assist coin is marked `kind: "media"` and excluded from spend/market just like the primary wrapper.
   - This implements your “tack on another coin that is the sealer” idea at the wrap layer, where extra SWARM coins actually matter.

5. **Keep serving fallback intact**
   - Do not interrupt torrent/chunk serving during sealing, recovery, or wrap attempts.
   - Once a completed coin is sealed, Media Coin serving becomes authoritative as already designed.

6. **Update vault UI state labels only if needed**
   - Show large completed coins as `Sealed` instead of leaving them visually stuck in `Sealing`.
   - If seal-assist was used, show a small `Seal assist` note in the coin details.

## Validation
- Run targeted checks for the blockchain/vault modules.
- Manually reason/test the 1 GiB path: allocate dedicated 1 GiB coin → record entry → force seal → resolver serves from coin if bytes exist, otherwise falls back to chunk/torrent.
- Verify normal under-500 MiB behavior still seals only between engravings and still uses one active filling coin per vault.