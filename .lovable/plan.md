## Bug

On Chrome (and sometimes Firefox), the SWARM toggle on `/brain` and the Node Dashboard gets stuck on "Attempting to establish connectivity…" — the peer counter never starts. Disabling and re-enabling does not recover. On Firefox the same code path actually works, which points to a state/lifecycle race rather than a transport failure.

## Root causes

1. **`useP2P.disable()` does not stop the SWARM engine.** In `src/hooks/useP2P.ts` (lines 888–949) `disable()` only stops `p2pManager`. In SWARM mode `p2pManager` is `null`, so the swarm singleton (`getSwarmMeshStandalone()`) keeps running with its old phase (`connecting` / `reconnecting` / `online`) and timers. The UI flips `isEnabled = false` while the engine is still alive.

2. **`useP2P.enableP2P()` cannot recover a wedged SWARM.** Lines 661–665 only call `sm.start()` when phase is `'off'` or `'failed'`. After a fake "disable" (see #1) the phase is still `'connecting'`/`'reconnecting'`, so re-enable becomes a no-op — the UI shows enabled, the engine is frozen, the counter never moves.

3. **`StandaloneSwarmMesh.start()` itself early-returns on `'connecting'`.** `src/lib/p2p/swarmMesh.standalone.ts` line 1468:
   `if (this.phase === 'connecting' || this.phase === 'online' || this.initInProgress) return;`
   So even an explicit `start()` cannot un-wedge it without a prior `stop()`.

4. **`isConnecting` is cleared synchronously after kicking SWARM** (lines 670–671), before signaling actually completes. The "Attempting…" message is then driven entirely by `swarmPhase === 'connecting'`, which is the very state that gets stuck.

5. **NodeDashboard double-drives the engines.** `handleToggleNetwork` (`src/pages/NodeDashboard.tsx` lines 63–77) calls both `enable()` and `sm.start()`, racing the new force-restart. On disable it calls `sm.stop()` itself — that masked bug #1 on Firefox (where signaling reconnects fast) and exposes it on Chrome (where PeerJS Cloud reconnect is slower).

6. **`/brain` boot misses SWARM auto-start in Chrome.** `src/main.tsx` schedules auto-start via `requestIdleCallback`. Chrome aggressively defers idle callbacks for backgrounded / freshly-loaded heavy routes; the 1500 ms timeout is not always honored when the tab is hidden during onboarding/redirect. Firefox fires sooner, hiding the bug.

## Fix

### A. `src/hooks/useP2P.ts`
- In `disable()`: always stop the standalone engines regardless of `p2pManager`:
  ```
  getSwarmMeshStandalone().stop();
  getStandaloneBuilderMode().stop();
  getTestMode().stop();
  ```
- In `enableP2P()` SWARM branch: if phase is `'connecting'` or `'reconnecting'`, call `sm.stop()` first, then `await sm.start()`.
- Subscribe once to `sm.onPhaseChange` and keep `isConnecting = true` until phase is `'online'` or `'failed'`. Mirror SWARM peer counts into `stats.connectedPeers` on every phase tick so the counter actually moves.
- In the `maybeEnable` effect: if `connState.enabled === true` AND `connState.mode === 'swarm'` AND `getSwarmMeshStandalone().getPhase() === 'off'`, kick `enableP2P()` even when `sessionEnabled` is already true. This covers HMR and route remounts where the swarm singleton was stopped but the hook thinks it's still active.

### B. `src/lib/p2p/swarmMesh.standalone.ts`
- `start()`: replace the blanket early-return with:
  - `'online'` → return.
  - `'connecting'`/`'reconnecting'` AND `!initInProgress` → treat as wedged: clear timers, `destroyPeer()`, set phase to `'off'`, then continue the normal start.
  - Keep the `initInProgress` guard so two genuinely concurrent starts remain safe.

### C. `src/pages/NodeDashboard.tsx`
- `handleToggleNetwork` and `handleGoOffline`: drop the manual `tm.stop()/sm.stop()/bm.stop()` and the manual `sm.start()` — let `useP2P`'s `enable()`/`disable()` be the only driver. This removes the Chrome race.

### D. `src/main.tsx`
- For the SWARM auto-start branch, replace `requestIdleCallback(..., {timeout:1500})` with a plain `setTimeout(..., 0)` (still after first paint, but no idle gating). Keep idle scheduling for the non-critical bridges (blockchain init, manifest backfill, health bridge, entity voice). This makes Chrome reliably boot SWARM on direct loads of `/brain`.

## Verification

- Chrome on `/brain`: hard reload → swarm goes `off → connecting → online`, peer count increments within a few seconds.
- Chrome / Firefox: toggle off then on from Node Dashboard while a wedge exists → swarm visibly returns to `connecting` then `online`; "Attempting…" message clears as soon as phase resolves.
- Offline-first new account: first enable click kicks SWARM cleanly; subsequent disables fully tear down the engine (no background PeerJS dial errors after disable in console).

## Files touched

- `src/hooks/useP2P.ts`
- `src/lib/p2p/swarmMesh.standalone.ts`
- `src/pages/NodeDashboard.tsx`
- `src/main.tsx`

No changes to `connectionState` schema or storage.
