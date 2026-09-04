---
name: Session flag single writer
description: Sign-in state lives in three flags written only by src/lib/auth.ts and read via sessionStore (unknown/signed-in/signed-out)
type: feature
---

Sign-in state = three flags that must always move together:
- `localStorage["me"]` — fast session entry
- `meta:lastActiveUserId` (IndexedDB) — durable marker
- `localStorage["session-signed-out"]` — set only by a deliberate sign-out

Rules:
- Only `src/lib/auth.ts` writes them, through `activateSession()` / `logoutUser()` / `updateActiveSessionUser()`. Enforced by the `session-flag-writer` rule in `scripts/uqrc-check.mjs`.
- `src/lib/session/sessionStore.ts` is the single reader: states `unknown | signed-in | signed-out`, one restore per page load, BroadcastChannel + storage-event cross-tab sync, bounded retries on `db-upgrade-resolved`.
- **Never treat unreadable storage as signed out.** `restoreSessionAttempt()` returns `restored | none | unavailable`; `unavailable` keeps the state `unknown` and retries.
- Auto-restore only happens when no intentional sign-out marker exists.
- `useAuth`, `useAuthReady`, `useSession` are thin subscribers to the store.
