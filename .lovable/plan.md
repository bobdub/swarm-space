<final-text>
## Fix remaining boot race: wrong landing page and missed P2P connect

### What will change
1. **Make `/index` canonical instead of orphaned**
   - Add an explicit `/index` route alias that behaves exactly like `/`.
   - This ensures users currently landing on `/index` still pass through the canonical-home redirect to `/brain`.

2. **Finish the auth-gate migration**
   - Refactor `src/pages/Auth.tsx` to use `useAuthReady` instead of `useAuth`.
   - Remove the last split-brain auth timing where Auth page navigation can resolve on a different tick than `Index`, `AuthGuard`, and `useP2P`.
   - Keep `resolvePostAuthTarget()` as the only post-login routing decision.

3. **Make P2P auto-enable react to connection state, not just auth**
   - In `useP2P.ts`, subscribe to the unified `p2p-connection-state` store.
   - Re-run auto-enable when either:
     - auth becomes ready, or
     - `connectionState.enabled/mode` changes after restore.
   - This closes the current gap where Auth restore flips `enabled: true` after the auth-ready effect already bailed.

4. **Remove competing boot paths**
   - Stop `main.tsx` from auto-starting SWARM/TestMode independently of the auth gate.
   - Route all network bring-up through the same guarded path in `useP2P`, so there is exactly one owner of startup.
   - Keep `main.tsx` for passive boot tasks only.

5. **Add restart/recovery guards for missed or stale sessions**
   - If auth resolves to a user and connection state says enabled, but the mesh is still `off/failed` after boot, trigger one deterministic recovery enable.
   - Preserve the existing `inflightEnable` lock so retries cannot race each other.

6. **Validate with focused regression coverage**
   - Add tests for:
     - `/index` + logged-in user redirects to `/brain`
     - Auth restore updates connection state and still triggers P2P enable
     - connection-state changes after auth-ready cause auto-connect
     - no duplicate enable when multiple triggers fire together

### Expected result
- Browsers that currently open on `/index` will land on `/brain`, not `/profile`.
- Restored users will reliably start P2P even when auth and connection preference resolve in different order.
- Startup logic will stop depending on tiny timing patches and scheduler luck.

### Technical details
Affected files:
- `src/App.tsx`
- `src/pages/Index.tsx`
- `src/pages/Auth.tsx`
- `src/hooks/useP2P.ts`
- `src/main.tsx`
- `src/lib/p2p/connectionState.ts`
- tests around auth/P2P boot

Root causes confirmed:
- `/index` is treated as canonical in helpers, but no actual `/index` route exists.
- `Auth.tsx` still uses `useAuth`, while the rest of the boot flow uses `useAuthReady`.
- `useP2P` only retries on auth readiness, not on later `connectionState` updates.
- `main.tsx` still performs eager standalone auto-start outside the unified auth/P2P gate.
</final-text>