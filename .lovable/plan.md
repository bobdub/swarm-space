# `/brain` P2P Connect Bug — Corrected Plan

## You were right

P2P connection is owned by the **GlobalCell** (Gun.js presence registry on `swarm-space/presence`) and **SwarmMesh** (PeerJS signaling). Neither layer cares about the route. Route-based RoomDiscovery is a secondary overlay only — not the reason peers find each other. My previous plan targeted the wrong layer.

## Re-diagnosis

The mesh works fine on `/brain` *once it's warm* (your console logs show active `Brain.spawn remote` traffic from `peer-8e2dc9a4…`). The failure window is **fresh load + cold caches + `/brain` mounted immediately**. Symptoms match a **main-thread starvation** pattern, not a discovery-channel bug.

### Evidence

1. **`main.tsx` boot sequence** is asymmetric:
   - SwarmMesh: `setTimeout(0)` → starts immediately, races first paint.
   - GlobalCell: `requestIdleCallback(timeout: 1500)` → deferred, may not fire until idle.
   - When `/brain` mounts, the WebGL scene + physics + neural ticks dominate the main thread → `requestIdleCallback` is delayed → **GlobalCell starts late** → no presence beacons → SwarmMesh finishes `cascadeConnect()` against an empty peer library and gives up its first attempt.

2. **`SwarmMesh.connectSignaling()` (line 1684–1714)** seeds its library from `getGlobalCell().getKnownPeers()` *at the moment it goes online*. If GlobalCell hasn't started, `getKnownPeers()` returns `[]` and the cascade has nothing to dial. The mesh then waits for either:
   - a Gun.js presence beacon (could take 5–30 s for cold relay handshake), or
   - the next `cascadeConnect` retry (slower path).

3. **GlobalCell's own announce** is gated on `mesh.phase === 'online'` (line 372). So if GlobalCell starts *after* mesh online, fine — but its Gun relay handshake (`gun-manhattan.herokuapp.com` etc.) competes with the WebGL frame budget. Heroku free relays handshake in ~2–8 s normally, **much longer when the main thread is saturated** by the Brain scene.

4. **Why "exit, then connect within seconds"**: leaving `/brain` unmounts the WebGL scene → main thread frees → Gun.js relay handshake completes → presence beacons flow → `recordPresence` → emit → mesh dials.

5. **Why "re-enter `/brain` without refresh works"**: PeerJS WebSocket + Gun.js relay sockets are already established and warm; mounting the heavy scene can't undo them.

6. **Why "refresh on `/brain` fails again"**: cold restart while heavy scene loads → same starvation.

## Fix

Three small, targeted changes. No route logic touched.

### 1. Move GlobalCell out of `requestIdleCallback`, start it eagerly with the mesh

In `src/main.tsx`, change the GlobalCell start from idle-deferred to the same `setTimeout(0)` block that owns the mesh auto-start. They are peers in the discovery system; one should not wait for the other.

```text
setTimeout(0):
  ├─ SwarmMesh.autoStart()
  └─ GlobalCell.start()   ← moved here from scheduleIdle()
```

Net cost: zero — GlobalCell's heavy work is already async (Gun import + relay handshake). We only move *scheduling*, not execution weight.

### 2. Make `SwarmMesh.connectSignaling()` await the GlobalCell briefly before cascading

After `setPhase('online')` and `subscribeGlobalCell()`, replace the immediate `setTimeout(() => cascadeConnect(), 500)` with a small await loop:

- For up to 3 s, poll `getGlobalCell().getKnownPeers().length`.
- As soon as ≥1 peer is known, run `cascadeConnect()` immediately.
- If 3 s elapse with zero, run `cascadeConnect()` anyway (current behavior preserved as fallback).

This costs nothing on warm restarts (peers are known instantly) and recovers the cold-start case where Gun's relay handshake is just a beat behind the mesh.

### 3. Re-trigger cascade on first GlobalCell discovery if mesh is online but isolated

In `SwarmMesh.subscribeGlobalCell()`'s BroadcastChannel handler (around line 580), when a `'discovered'` event arrives and `connectedPeers === 0`, call `cascadeConnect()` immediately instead of relying on the next periodic retry. Today the discovered peer is added to the library but the cascade may not re-run for tens of seconds.

## Files

- `src/main.tsx` — move GlobalCell start out of `scheduleIdle()`.
- `src/lib/p2p/swarmMesh.standalone.ts` — two edits inside `connectSignaling()` and `subscribeGlobalCell()`.

## Out of scope

- Route-hashed RoomDiscovery — leaves it untouched. It's a same-page bonus channel, not the primary connector.
- Brain WebGL scene — not the cause; just the load that exposes the timing bug.
- Gun relay endpoints — no change.

## Expected behavior after fix

- Fresh login auto-entering `/brain`: mesh comes online, waits ≤3 s for GlobalCell, dials immediately when first beacon arrives. Connect time should match `/explore` (a few seconds).
- Refresh on `/brain`: same path. No cold-start penalty from idle deferral.
- Other routes: unchanged (already worked).
