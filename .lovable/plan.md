# Stop /brain misroutes and P2P auto-connect races at the source

## What's actually wrong (verified in code)

1. **`src/pages/Index.tsx`** has two stacked redirect effects plus a `requestAnimationFrame` safety net. They fire on different ticks, so on stricter schedulers (Chrome cold start, Brave) the first one runs before `useAuth` resolves and the rAF only fixes `/` and `/index` — any other deep link (`/profile`, `/explore`) is left alone.
2. **`src/components/auth/AuthGuard.tsx`** preserves `location.from`. A logged-out deep-link to `/profile` → `/auth?from=/profile` → after login lands on `/profile`, never `/brain`. There is no canonical "home" rewrite.
3. **`src/pages/Auth.tsx`** post-login redirect uses `redirectTo = fromPath || "/"`. `/` then bounces to `/brain` only via Index's effects — same race as #1.
4. **`src/hooks/useAuth.ts`** exposes `{ user, isLoading }` but no shared "ready" signal. Every consumer reimplements its own gating, and `initialUser` from localStorage can be stale during the IndexedDB restore window.
5. **`src/hooks/useP2P.ts` `maybeEnable` (lines 995–1039)** runs once on mount and bails when `getCurrentUser()` is null. Recovery depends on the `user-login` event from `attemptSessionRestore` (auth.ts:184/194). If `useP2P` mounts *after* restore resolves (slow lazy chunk, HMR), the event is missed and P2P stays off until the user toggles. The module-level `sessionEnabled` guard then blocks any later kick.
6. The `BrainUniverse` route is lazy — its chunk download adds another window where redirects can be observed mid-flight.

These are real ordering bugs, not flake. Patch-on-patch (rAFs, extra effects, `sessionEnabled` resets) papers over them but does not remove the races.

## The fix: one gate, one router decision, one P2P trigger

Introduce a small `authReady` primitive and route everything through it. No more per-page rAFs, no more "is the user there yet?" guesses.

### 1. New `useAuthReady` hook (`src/hooks/useAuthReady.ts`)
- Wraps `attemptSessionRestore` once at app boot, exposes `{ user, isReady }` where `isReady` flips true exactly once after restore (success or failure).
- Backed by a module-level promise so every consumer subscribes to the same resolution — no duplicate restores, no listener-attached-too-late races.
- Re-exports the same shape `useAuth` returns today, so callsites can swap incrementally.

### 2. `AuthGate` provider in `src/App.tsx`
- Wraps `<Routes>` and renders the global spinner until `isReady`.
- Guarantees `AuthGuard`, `Index`, `Auth`, and `useP2P` all see the same resolved auth state on first render — eliminates the "AuthGuard spinner → wrong route" path.

### 3. Canonical home routing
- Add `getCanonicalHome(user)` helper returning `/brain` for logged-in users, `/` for guests.
- `Index.tsx`: replace both effects + the rAF block with a single `<Navigate to={getCanonicalHome(user)} replace />` rendered after `isReady`. Delete the rAF safety net.
- `Auth.tsx`: after login, navigate to `fromPath ?? getCanonicalHome(user)`. If `fromPath === "/"`, treat it as "no preference" and use the canonical home.
- `AuthGuard.tsx`: when redirecting back from `/auth`, only preserve `from` for non-root deep links; `/` collapses to canonical home.

### 4. Deterministic P2P auto-connect
In `src/hooks/useP2P.ts`:
- Replace the on-mount `maybeEnable` + `user-login` listener with a `useEffect` keyed on `useAuthReady().user?.id`. It runs only after auth is ready and re-evaluates if the user identity changes (login/logout/account switch).
- Remove the module-level `sessionEnabled` flag's role as a startup guard; keep it only as an in-flight dedupe inside `enableP2P` (already covered by `isConnectingRef`).
- Add a single `enableLockRef` promise so concurrent callers await the same `enableP2P()` instead of racing the `p2pManager` reassignment block (lines 587–608).
- Drop the `void enableP2P()` swarm-off recovery branch — it's now handled by the `userId`-keyed effect plus the existing phase listener.

### 5. Lazy-chunk preloading for `/brain`
- In `App.tsx`, when `useAuthReady` resolves with a user, fire `import("./pages/BrainUniverse")` immediately (fire-and-forget) so the chunk is warm before navigation. Eliminates the visible "Suspense fallback → wrong page" flash some browsers exhibit.

### 6. Tests
- Extend `src/hooks/__tests__/useNodeDashboard.test.ts` style harness with `useAuthReady.test.ts`: cold start with empty localStorage + IndexedDB-restored user resolves to `isReady=true` exactly once and emits one `user-login`.
- Add `src/pages/__tests__/IndexRedirect.test.tsx`: logged-in render → single `<Navigate to="/brain">`, no intermediate `/profile`.
- Add `src/hooks/__tests__/useP2P.autoConnect.test.ts`: with `connectionState.enabled=true`, P2P enables exactly once after auth resolves, and not at all when the user is null.

## Files touched

- New: `src/hooks/useAuthReady.ts`, `src/lib/routing/canonicalHome.ts`
- Edit: `src/App.tsx`, `src/pages/Index.tsx`, `src/pages/Auth.tsx`, `src/components/auth/AuthGuard.tsx`, `src/hooks/useAuth.ts` (delegate to `useAuthReady`), `src/hooks/useP2P.ts` (lines 995–1039 + dedupe lock)
- Tests: three new files above

## Out of scope

- No changes to `P2PManager`, swarm/builder standalone engines, or the rendezvous mesh — the fix is purely in the React boot/gate layer.
- No new persisted preferences; existing `connectionState` and `p2p-user-controls` keep their meanings.

## Memory note

After implementation, save a `mem://architecture/auth-ready-gate` memory describing the single-gate pattern so future work doesn't reintroduce per-page rAF redirects.
