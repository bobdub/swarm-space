# Builder Mode v2 — Grid, Snap, Plots, Costs

Lessons from `SurfaceBar` (canonical hand-built reference) drive this plan:
- Walls were hand-laid as N segments along an axis with `SEG_LEN = 2.5 m` and `SEG_BASIN = 1.4 m`. That tile pitch becomes the global build grid.
- Counter/stools/sign read well only because positions were rationally aligned (`COUNTER_FORWARD`, `STOOL_FORWARD`, mirrored stool spans). Users won't get that for free — they need a visible grid + snap.
- The doorway is just an "absent segment", proving wall segments must be addressable per-cell so users can omit/replace one to cut openings.
- Furniture and walls live in the same engine (`getBuilderBlockEngine().placeBlock`), so the same grid/snap rules govern structural and decorative pieces.

---

## 1. World Grid

`src/lib/world/buildGrid.ts` (new):
- `CELL = 1.0 m` (xz), `WALL_PITCH = 2.5 m` (matches `SurfaceBar.SEG_LEN`), `Y_STEP = 0.5 m`.
- Pure fns: `snapToCell(localXZ)`, `snapYaw(rad, step=π/2)`, `snapY(up, kind)`.
- All math in the **Earth-local tangent frame** (same frame `placementController.deriveLocalFrame` / `registerLocalSiteFrame` already use), so the grid follows curvature — never world XYZ.

`src/components/world/BuildGridOverlay.tsx` (new):
- Rendered only when `useBrainBuilder().mode === 'build'`.
- Shader-based grid plane pinned to the player's current Earth-local frame, fades with distance (~40 m radius).
- Inside a plot: grid opaque + plot-color tinted. Outside any plot: faint white grid (free-build zone).

## 2. Snap System

`src/lib/world/snapResolver.ts` (new) — layered resolver replacing "floats wherever cursor lands":

1. **Edge-snap to existing piece** (wall→wall side, wall→foundation top, roof→wall top) via connector points declared on each prefab. Threshold 0.4 m (same as `HubBuildLayer`/`snapping.ts`).
   - Add `connectors: { id, kind: 'wall-edge'|'floor-edge'|'roof-edge'|'stud-top', localOffset, normal }[]` to `PrefabSpec` in `prefabHouseCatalog.ts`.
2. **Foundation-snap**: walls drop onto nearest foundation top edge, auto-aligned to its axis.
3. **Grid-snap fallback**: `snapToCell` + `snapYaw` from §1.
4. **Free** only when user holds the no-snap modifier (Shift / mobile long-press) **or** Free-Build toggle is ON (see §2a).

Reuses + extends `src/lib/virtualHub/snapping.ts` (already does edge-midpoint snap) as the algorithm.

Ghost preview: `PlacementInteractor` already raycasts Earth. Add translucent ghost prefab that updates each frame using the resolver — green when snapped to a connector, amber on grid, red when invalid (outside plot / overlapping).

### 2a. Free-Build toggle (desktop-prominent)

`useBrainBuilder` gains `freeBuild: boolean` + `setFreeBuild(next)`, emitted on the `brain-builder-mode` event.

`BrainBuilderBar` adds a top-row toggle alongside the magnetic Snap switch:

- Label: **Free Build** with a `Move3D`/`Sparkles`-style icon.
- Desktop: prominent labeled button next to Snap (`md:`+ shows "Free Build · Shift" hint).
- Mobile: compact icon-only toggle in the same row.
- When ON: snap resolver short-circuits to grid only — connector/foundation snaps skipped.
- When OFF: holding Shift (desktop) or long-press during drag (mobile) temporarily disables snap for that placement.
- Visual: bar gains a subtle amber outline while Free Build is active so users remember it's on.

The same toggle is mirrored in `src/components/virtualHub/BuilderBar.tsx` for the Virtual Hub builder, so behavior is identical in both surfaces.

## 3. Plots

`src/lib/world/plotsStore.ts` + `src/components/world/PlotOverlay.tsx` (new):

- A **plot** = rectangle in Earth-local frame: `{ id, ownerId, anchorId, originLocalXZ, sizeCells: [w,d], collaborators: string[] }`.
- Persistence: IDB `swarm-world-plots` + BroadcastChannel `swarm:world:plots` (mirror `worldPlacementsStore` pattern; local-protect against peer overwrite).
- Builder Bar gets a "Plot land" tool: drag two corners on the grid → preview area + SWARM cost → confirm.
- Cost: `PLOT_COST_SWARM = cells × PLOT_RATE`. Charged via existing `coin.bus` / wallet bridge.
- Placement rule (enforced in `placementController.placePrefabAtHit`):
  - If a plot covers the hit cell → only owner or `collaborators` may place.
  - If no plot covers the cell → free-build allowed for anyone (still grid + snap, modulated by §2a).
- Collaborators field reserved (UI button stub) — invite flow deferred.

## 4. Resource Costs for Pieces

`src/lib/world/buildCosts.ts` (new):
- Each `Prefab` already declares `constituents` (real elements). Map element counts → required resource units in the user's in-world inventory (`harvestedInventory.ts`).
- `canAfford(prefabId, actorId)` and `chargeFor(prefabId, actorId)` helpers.
- Builder bar shows red border on unaffordable prefabs; `placePrefabAtHit` aborts and toasts on shortfall.
- Removing a piece refunds 50% (configurable) — aligns with `world.mutation` labour-credit bus.

## 5. SurfaceBar Lessons Folded In

- **Cell-addressable wall runs**: a "wall" placed at a grid cell is a single `WALL_PITCH` segment with its own basin (matches `SurfaceBar`'s `stripX/stripZ`). Doorways = omit one cell.
- **Per-segment basins**: keep `pinSupportBasin` per cell, not per wall-run, so collision stays sharp at corners.
- **Furniture on same grid**: counters/stools/tables snap to a `CELL/2` sub-grid so users can recreate the bar without magic numbers.
- **Anchor frame is the only truth**: all snapping, plotting, and grid math happen in Earth-local coords from `getEarthLocalSiteFrame(anchorPeerId)` — never world XYZ — so plots stay glued to Earth through spin/orbit, just like the bar walls do.

---

## File-by-file

```text
src/lib/world/buildGrid.ts                  [new]
src/lib/world/snapResolver.ts               [new]
src/lib/world/plotsStore.ts                 [new]
src/lib/world/buildCosts.ts                 [new]
src/lib/brain/prefabHouseCatalog.ts         [edit] add connectors[]
src/lib/brain/useBrainBuilder.ts            [edit] freeBuild state + event
src/lib/world/placementController.ts        [edit] snapResolver + plot gate + cost charge
src/components/world/BuildGridOverlay.tsx   [new]
src/components/world/PlotOverlay.tsx        [new]
src/components/world/PlacementGhost.tsx     [new]
src/components/brain/builder/BuilderBar.tsx [edit] Free-Build toggle + Plot tool + affordability
src/components/virtualHub/BuilderBar.tsx    [edit] mirror Free-Build toggle
src/components/brain/SurfaceBar.tsx         [edit] rebuild from new wall-cell prefab as parity test
```

## Order of work

1. `buildGrid.ts` + `BuildGridOverlay` (visual grid alone, no behavior change).
2. Connector metadata on prefabs + `snapResolver` + `PlacementGhost`.
3. Free-Build toggle in both Builder Bars (§2a) + Shift/long-press modifier.
4. Wall-cell prefab refactor; rebuild `SurfaceBar` from it as regression test.
5. `plotsStore` + `PlotOverlay` + placement gate.
6. `buildCosts` wired to `harvestedInventory` + wallet bridge for SWARM plot charges.
7. Collaborator invite UI stub (deferred functionality).

## Out of scope (explicit)

- Multiplayer collaborator approval flow — only stored field + UI stub.
- Vertical stacking beyond `Y_STEP` snap (stairs, multi-floor).
- Refund economics tuning beyond 50% default.
