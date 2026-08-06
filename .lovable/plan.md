# Builder Mode: fluid placement + overhead build camera

Two fixes, both confined to Brain builder mode. Nothing about persistence, snapping math, plots, or project scoping changes.

## 1. Remove the multi-stage pop-up, place fluidly

Today: selecting a prefab arms an invisible sphere with no ghost, a bottom pill says "Click the grid to drop placement", the first click drops the ghost, and only then does a second confirm bar appear. That is the staged pop-up flow.

New flow:
1. Click a prefab in the builder bar -> the translucent ghost appears immediately, snapped to the grid a couple of cells in front of the avatar.
2. Moving the mouse (or dragging on touch) slides the ghost along the grid continuously, no click needed.
3. A single click on the grid commits the placement right there. The small in-world chip above the ghost keeps rotate (left/right) and cancel, plus a checkmark for touch users who want to confirm without a second tap.
4. Escape or the cancel button clears the armed prefab.

The bottom-of-screen cast pill is removed for prefab placement (portal drops keep a minimal cancel affordance so that flow is not broken).

## 2. Build camera: pan and overhead view

Today: in build mode the look overlays are not mounted at all, so the camera cannot pan, and while a placement is armed they are set inert. That is why you can only place in the fixed view.

Changes:
- Mount the look overlays in build mode so drag-to-look pans and tilts normally. Placement clicks still win because the ghost surface handles its own pointer events; the look overlay only reacts to drags that do not land on the placement surface.
- Add a "Top view" chip to the builder toggle row (next to Magnets / Free Build / Plot). When on, the camera pulls up and back above the avatar and looks down at a steep angle, so you see your avatar plus a wide patch of grid. Turning it off returns to first person. The chip is only present in build mode and resets to off when build mode exits.
- In top view, drag-to-look orbits the yaw around the avatar and the pitch clamp widens toward straight down.

## Technical notes

- `src/lib/world/assetCaster.ts`: seed new casts as positioned; keep `isPositioned` for edit/move flows.
- `src/components/world/AssetCaster.tsx`: always seed `localDirRef` from the avatar-forward spawn point on arm; hover `pointermove` updates the ghost without requiring a prior drop; `pointerup` on the shell commits via `confirmCast()` when the pointer did not drag beyond a small threshold (so drag-to-position does not accidentally commit).
- `src/components/brain/BrainUniverseScene.tsx`: drop the `castArmed` bottom pill for `kind === 'prefab'`; render look overlays while `isBuilding`; stop forcing `inert` for prefab casts.
- New `src/lib/brain/builderCameraStore.ts`: tiny subscribable `{ topView: boolean }` store, read by `PhysicsCameraRig` each frame to apply the boom offset (up ~14 m, back ~10 m) and widened pitch clamp; written by the new chip in `BrainBuilderBar.tsx`.
- No changes to `buildGrid.ts` snap math, `placementController.ts`, or the P2P placement bridge.

## Verification

Playwright run in the live preview: enter the Brain, open builder mode, arm a wall, confirm the ghost appears without any pop-up, move the pointer and screenshot the ghost tracking the grid, click to place, then toggle Top view and screenshot the overhead framing with the avatar visible.
