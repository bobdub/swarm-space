The user is signed in and their username is still displayed, but after a reload their Creator Token is prompting for redeploy and their avatar is missing. This means the localStorage `me` record is intact (identity survived) but the IndexedDB records for the creator token and avatar chunks are not readable or were not restored. The plan is to diagnose the exact storage state, harden the chain/token recovery path, make avatar loading resilient, and give the user a reliable backup/restore path so this cannot happen again.

## 1. Diagnose the current storage state

Add a non-destructive **Storage Diagnostics** panel reachable from Settings → Legal & Docs / Storage (or a temporary `/storage-diag` route) that reports:

- localStorage keys present, including `me`, `__swarm_chain_snapshot`, and `p2p-connection-state`.
- IndexedDB `imagination-db` store counts for: `meta`, `blockchain`, `profileTokens`, `creatorVaults`, `profileTokenHoldings`, `manifests`, `chunks`, `tokenBalances`, `users`.
- Whether the current signed-in user has a row in `users`, `profileTokens`, and `creatorVaults`.
- Whether the chain contains a `profile_token_deploy` or `creator_token_deploy` transaction for the current user.
- Whether the avatar manifest referenced by `me.profile.avatarRef` exists and has chunks.
- Any IndexedDB open/version errors encountered while reading.

This panel will tell us whether the data is truly gone or whether the app is reading from the wrong place after the DB_VERSION 25 upgrade.

## 2. Harden chain persistence and snapshot recovery

- Make `SwarmChain._syncFlush()` write the snapshot only after confirming the chain is non-empty, and keep the previous snapshot as `__swarm_chain_snapshot_prev` for one extra reload of safety.
- In `loadChain`, if the snapshot is corrupt/empty, fall back to the previous snapshot before falling back to IndexedDB.
- Ensure `addTransaction` is followed by a synchronous-best-effort snapshot write on `beforeunload`/`visibilitychange` so a reload immediately after deploy does not lose the pending deploy tx.
- Add a `validateChainState` guard before replacing IndexedDB chain state with a snapshot so an empty snapshot can never overwrite a non-empty chain.

## 3. Improve creator token recovery

- Change `TokenRecoveryBoot` to run immediately when auth resolves (remove the 2.5 s delay) so recovery happens before any UI queries the token store.
- Extend `recoverCreatorTokenFromChain` to scan both mined blocks and pending transactions for `profile_token_deploy`/`creator_token_deploy`.
- If the deploy tx is found but the vault/holdings rebuild fails, still restore the token record so the UI does not show "Deploy".
- Add a manual **Restore Creator Token** button in Wallet → Creator that re-runs the recovery scan and shows the result (found / not found / no chain data).
- If the chain is empty and no snapshot exists, show a clear message: "No local chain or backup found — the token cannot be restored automatically." with an import-backup call to action.

## 4. Fix avatar loading and chunk recovery

- In `Avatar.tsx`, cap the number of P2P retry attempts to 2 and suppress the repeated warning log storm when chunks are unavailable.
- If the avatar manifest exists but chunks are missing, render the fallback initials and show a small "avatar missing" indicator on the profile so the user knows they need to re-upload, not that the app is broken.
- Add a **Re-upload avatar** flow in Profile/Settings that overwrites the old `avatarRef` with a new upload and updates `me.profile.avatarRef` in localStorage and the `users` IndexedDB row atomically.

## 5. Add full-state export and restore

- Create `src/lib/backup/exportFullState.ts` that bundles into a single JSON file: identity (`me`, wrapped key), chain state, all blockchain stores (`tokenBalances`, `profileTokens`, `creatorVaults`, `profileTokenHoldings`, `coinListings`, `participantListings`, `miningSessions`, `rewardPool`, `tokenUnlockStates`), plus all `manifests` and `chunks` referenced by the user or avatar.
- Add `src/lib/backup/importFullState.ts` that restores the bundle into a fresh IndexedDB/localStorage, with validation and a confirmation toast.
- Wire the export/import into Settings → Storage as **Export full backup** and **Restore from backup**.
- Add a one-time prompt after a successful deploy/token creation encouraging the user to export a backup.

## 6. Verify with UQRC and security checks

After implementation:
- Run `scripts/uqrc-check.mjs` to confirm no new contradictions or hidden dependencies are introduced.
- Run a basic security scan and address only new findings introduced by this plan.
- Use the live preview to confirm the diagnostic panel renders, the recovery button runs without errors, and avatar fallback/re-upload works.

## Outcome

The user will be able to see exactly what local data exists, trigger a manual token restore if the chain still holds the deploy transaction, re-upload a missing avatar, and export/restore a complete backup so tokens and avatars survive reloads and browser changes.