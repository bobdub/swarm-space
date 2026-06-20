# Land Plots — Walk-to-Claim Plan

Users in Builder Mode can toggle **Plot** to enter a walking survey state. A trail draws behind them; when the trail loops back to its start, the Builder Bar reopens with a SWARM cost and a **Confirm** action. Confirmed plots become owner-only build zones.

## UX flow

1. In `BrainBuilderBar`, add a **Plot** toggle button next to the Lab tab (icon: `LandPlot` from lucide).
2. Toggling Plot ON:
   - Closes/hides the builder bar (`builder.mode` stays `'build'` but a new `plotting: true` flag suppresses the bar and prefab ghost).
   - Joystick / movement re-enabled so user can walk.
   - A `PlotSurveyOverlay` renders on the ground showing the trail polyline + start marker.
3. Walking:
   - Sample player Earth-local position every ~0.25 m of travel, push to `trail[]`.
   - When the latest segment crosses within `CLOSE_RADIUS = WALL_PITCH` of `trail[0]` and trail length ≥ 4 samples, the loop is closed.
4. On close:
   - Compute axis-aligned bounding box of `trail` in the lattice-origin tangent frame.
   - Snap min/max to `WALL_PITCH` cells → integer cell rect `(cx0,cz0)-(cx1,cz1)`.
   - Cost: `boxes = ceil(width_cells / 1) * ceil(depth_cells / 1)` where one "box" = one `WALL_PITCH`×`WALL_PITCH` cell. `priceSwarm = boxes * 3`.
   - Builder bar reopens in **Confirm Plot** mode: shows dimensions, box count, cost, and balance.
   - Confirm button is disabled if balance < cost, showing "Need X more SWARM".
   - Cancel discards the trail.
5. On confirm: deduct SWARM, persist plot, render claimed area outline tinted by owner color. Plotting toggles back off; Builder Mode resumes.

## Ownership & overlap

- Plots stored per universe namespace in localStorage (`brain-plots-v1[:ns]`), each:
  `{ id, ownerId, cellRect, anchorId: WORLD_GRID_ORIGIN_ANCHOR, priceSwarm, claimedAt }`.
- Overlap rule (**Allow only your own**): during survey, every new trail sample is checked against existing plots. If it enters a cell owned by **another peer**, the trail flashes red and the offending samples are rejected (trail can't extend there). Entering your own plot is fine and the resulting bbox may merge with / extend over it.
- Builder Mode placement gate: `placeBlock` and the ghost resolver consult `getPlotAt(cell)`; if a plot exists and `ownerId !== selfId`, placement is blocked with a "Owned plot" toast. Cells with no plot remain free-for-all (existing behavior).

## SWARM integration

- Read balance from existing wallet store (whichever module `useWallet`-style hook exposes SWARM). Confirm uses the same debit path the Walled Posts / unlock flow already uses; new helper `chargeSwarm(amount, reason: 'land-plot', meta)`.
- No new chain logic — plot claim is a local + P2P-broadcast event (mirrors how pieces sync today). Charge is recorded locally; the existing economics layer reconciles.

## Landmarks (stub)

- Add `unlocksLandmarks: true` flag on plot record. A new **Landmarks** prefab section in `BrainBuilderBar` shows only when the user stands inside one of their own plots. Initial catalog ships empty with a "Coming soon" tile — actual landmark prefabs deferred per user note ("Future build").

## Files

**New**
- `src/lib/world/landPlots.ts` — types, localStorage IO, `getPlotAt(cell)`, `claimPlot`, `cellRectFromTrail`, `priceForRect`, P2P broadcast hook, subscribe.
- `src/lib/brain/usePlotSurvey.ts` — trail sampling, closure detection, overlap rejection, derived `cellRect`/`price`.
- `src/components/world/PlotSurveyOverlay.tsx` — three.js line for the active trail + start beacon.
- `src/components/world/LandPlotsOverlay.tsx` — renders all claimed plot footprints (tinted outline; own plots highlighted).
- `src/components/brain/builder/PlotConfirmPanel.tsx` — replaces the bar's tile area while a closed survey is pending confirm.

**Edited**
- `src/lib/brain/useBrainBuilder.ts` — add `plotting`, `setPlotting`, `pendingPlot`, `setPendingPlot`; extend `BUILDER_MODE_EVENT` detail with `plotting` so the scene knows to keep the joystick alive.
- `src/components/brain/builder/BrainBuilderBar.tsx` — Plot toggle button; when `pendingPlot` exists, render `PlotConfirmPanel` instead of tiles; hide whole bar while `plotting && !pendingPlot`.
- `src/components/brain/BrainUniverseScene.tsx` — mount `PlotSurveyOverlay` (when plotting) and `LandPlotsOverlay` (always in Builder Mode); re-enable joystick when `plotting` is true even though `mode==='build'`.
- `src/lib/brain/builderBlockEngine.ts` (or its placement resolver) — consult `getPlotAt` and refuse foreign-owned cells.

## Pricing math (technical)

```
cellSize   = WALL_PITCH                       // 2.5 m, "one box"
bbox       = aabb(trail)                      // tangent coords
snapped    = { x0: floor(bbox.x0/cellSize)*cellSize,
               x1: ceil (bbox.x1/cellSize)*cellSize,
               z0: floor(bbox.z0/cellSize)*cellSize,
               z1: ceil (bbox.z1/cellSize)*cellSize }
boxes      = ((snapped.x1-snapped.x0)/cellSize) * ((snapped.z1-snapped.z0)/cellSize)
priceSwarm = boxes * 3
```

## Out of scope

- Selling / transferring / abandoning plots.
- Non-rectangular plots (user chose AABB).
- Landmark catalog content.
- Chain-backed plot deed; this version is local + P2P gossip, same trust model as pieces.

## Verification

1. Enter Builder Mode → toggle Plot → bar hides, joystick returns, trail draws.
2. Walk a small square back to start → bar reopens with `boxes` and `priceSwarm` matching the formula.
3. With insufficient SWARM, Confirm shows "Need X more SWARM" and is disabled.
4. Confirm with funds → SWARM deducted, plot outline visible, plotting toggles off.
5. Switch to another peer (or simulated `selfId`) → placing a wall inside that plot is blocked with toast; placing outside still works.
6. Re-enter Plot mode and try to walk into a foreign plot → trail rejects those samples.
