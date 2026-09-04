# Fix session and local data flags falling out of sync

You reported being signed out without ever signing out. The account data itself is almost certainly still on the device — what breaks is the set of small flags that say "this is who is signed in", and the fact that several parts of the app each decide that answer independently.

## What is actually going on

Confirmed by reading the code:

- Sign-in state lives in three places that can disagree: the quick `me` entry in browser storage, a `lastActiveUserId` marker in the local database, and the account records themselves.
- Two separate pieces of the app (`useAuth` and `useAuthReady`) each run their own restore attempt and keep their own copy of the answer. `useAuthReady` caches the result for the whole page and never re-checks when another tab signs in or out.
- If the local database can't be opened at that exact moment (it is currently at version 27 and can be blocked while another tab holds it open), the restore silently returns "nobody" — which the app treats as *signed out* rather than *not known yet*. There is no retry once the database frees up.
- Signing out removes `me` but deliberately keeps `lastActiveUserId`, so a later boot can silently sign you back in. There is no stored flag distinguishing "signed out on purpose" from "flag lost".
- If the `lastActiveUserId` marker is lost and more than one account exists on the device, restore gives up entirely and you appear signed out with no way back except manual account restore.

## The fix

1. **One session source of truth.** A single session store owns the answer and reports three states: `unknown`, `signed-in`, `signed-out`. `useAuth`, `useAuthReady` and `useAuthGate` all read from it instead of each doing their own restore. Nothing renders a "signed out" experience while the state is still `unknown`.

2. **Never mistake "database busy" for "signed out".** If the local database is blocked or errors during restore, the state stays `unknown` and the app retries when the database becomes available (it already broadcasts a blocked/ready signal). A short "restoring your session…" state replaces the wrongly-signed-out screen.

3. **An explicit sign-out flag.** Signing out records an intentional sign-out marker; every sign-in path clears it. Automatic restore only happens when that marker is absent — so a lost flag restores you, and a real sign-out stays signed out.

4. **Cross-tab agreement.** Sign-in and sign-out are broadcast between tabs and windows, so every open tab flips at the same time instead of holding a stale cached answer.

5. **Recovery instead of a dead end.** When the marker is missing but accounts exist on the device, offer a "choose your account" prompt rather than showing a signed-out app.

6. **A session health readout.** A small diagnostics panel in Settings shows which flags are present (quick session entry, last-active marker, number of local accounts, database status) so this is checkable next time instead of guessed at.

7. **Consistency check.** Extend the existing UQRC consistency script with session invariants: exactly one writer for the session flags, no path that writes `me` without also writing the last-active marker, and no path that clears one without the other. This catches future drift automatically.

## Technical notes

- New `src/lib/auth/sessionStore.ts`: holds `SessionState = 'unknown' | 'signed-in' | 'signed-out'`, a single `ensureRestore()` behind a module promise, a `BroadcastChannel('swarm-session')` plus `storage` event bridge, and listeners for `db-upgrade-blocked` / database-ready to schedule bounded retries with backoff.
- `attemptSessionRestore` in `src/lib/auth.ts` returns a discriminated result (`{ status: 'restored' | 'none' | 'unavailable' }`) instead of `UserMeta | null`, so callers can tell "no account" from "couldn't read".
- `logoutUser` writes `meta:signedOutAt`; `createLocalAccount`, `restoreLocalAccount`, `importAccountBackup` and the recovery paths all clear it and write `lastActiveUserId` through one shared helper.
- `useAuth` and `useAuthReady` become thin subscribers to the session store; `useAuthReady.__resetAuthReadyForTests` keeps working.
- Tests: restore under a blocked database stays `unknown` then resolves on retry; intentional sign-out is not auto-restored; cross-tab sign-out propagates; multi-account with missing marker yields a picker rather than signed-out.
- No changes to keys, encryption, or the network/mesh flags.
