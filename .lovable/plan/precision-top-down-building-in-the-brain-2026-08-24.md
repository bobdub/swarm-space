# Precision Top-Down Building in the Brain

Goal: make top-down building feel deliberate — the camera and the ghost move slowly and predictably, items glide cell to cell instead of jumping, a desktop click drops the item where the ghost sits, walls can stack, and foundations/owned land pull items in magnetically without killing fine movement.

## 1. Slow, damped control in top-down mode

- Look/drag sensitivity is cut while Top view is on (roughly one third of normal), so a mouse sweep pans the overhead camera a short, controllable distance instead of whipping across the world.
- The camera boom also eases into and out of top view rather than snapping.

## 2. Ghost glides across cells instead of jetting

- The ghost's position is smoothed: the raw pointer target updates instantly, but the visible ghost eases toward it each frame, so it slides from one grid box to the next.
- A small hysteresis is added around cell boundaries: the ghost only re-snaps to a new cell once the pointer has moved clearly past the boundary, killing the flicker between two neighbouring cells.
- In Free Build (snap off) the same easing applies without quantising, giving slow continuous movement.

## 3. Desktop click-to-place once the ghost exists

- On mouse, hovering the build surface produces the ghost immediately; a single left click commits it at the ghost's current cell.
- The click only commits when the pointer did not drag (existing slop check), and never when the click lands on the rotate/cancel chip.
- Touch keeps its current behaviour: drag to position, tap the checkmark (or a clean tap) to confirm.

## 4. Wall stacking

- Placements gain a vertical level: an item can sit on top of the item already occupying that cell.
- When the ghost hovers a cell that already holds a wall, it auto-lifts to rest on top of the tallest piece in that cell, showing the stacked position before you commit.
- Manual level control is added to the ghost chip (up/down arrows, plus PageUp/PageDown on desktop) so you can force a level or drop back to the ground.
- The level is persisted with the placement and gossiped to peers, so stacks appear the same for everyone and survive reload.

## 5. Magnetic foundations and owned land

- While the ghost is within range of a foundation edge, an existing placed piece's edge, or the boundary of a purchased land plot, it is pulled onto that alignment (edge-to-edge, flush corners) with a short attraction distance.
- Inside a foundation or an owned plot the pull is to the plot's own cell lattice, so items line up with the parcel rather than the global grid, while still allowing the slow sub-cell movement from item 2 when Free Build is on.
- A subtle highlight marks the alignment the ghost has locked onto, so it is clear why it snapped.

## Technical notes

- `src/lib/brain/builderCameraStore.ts`: expose a look-sensitivity multiplier derived from top view; `BrainUniverseScene.tsx` pointer/touch handlers and `PhysicsCameraRig` multiply drag deltas by it, and the top-view boom lift/back distance is lerped instead of assigned.
- `src/components/world/AssetCaster.tsx`: keep `targetLocalDirRef` (raw snap result) and `localDirRef` (rendered), easing between them in `useFrame`; add boundary hysteresis inside `snapLocalDirToGrid`; add `pointermove` hover on mouse (already present) plus commit on non-drag `pointerup`; add level state and ghost lift by `level * pieceHeight`.
- `src/lib/world/assetCaster.ts`: add `level` to `PendingCast` with `setCastLevel`, and pass it through `confirmCast`.
- `src/lib/world/placementController.ts` + `worldPlacementsStore.ts`: add `upOffset` (metres) to `PlaceAtHitInput` / `PlacedHandle` / `PlacementRecord`, forwarded to `getBuilderBlockEngine().placeBlock` (the engine already supports `upOffset`) and included in the record diff and P2P gossip payload; default `0` so existing records are unchanged.
- New helper in `src/lib/world/buildGrid.ts`: `snapWithHysteresis(value, step, prevSnapped, slack)` and `stackHeightAt(cell)` reading the placement store for occupied cells.
- `src/lib/world/landPlots.ts`: add `plotLatticeSnap(tx, tz, plot)` used by the magnet path when the point falls inside an owned rect.
- No changes to plot pricing, claim flow, physics integration, or the sculpting tools.

## Verification

Playwright in the live preview: enter the Brain, open builder mode, toggle Top view, drag to confirm the slower camera, arm a wall and screenshot the ghost easing between cells, click to place, place a second wall on the same cell and screenshot the stack, then place near a foundation edge and confirm the magnetic alignment.
