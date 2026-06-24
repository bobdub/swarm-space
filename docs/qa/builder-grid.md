# QA — Builder Grid & Snap

## Pre-conditions
- Logged-in user, on `/brain`.
- Lab/walkthrough overlays dismissed.
- Browser console open to watch for `[builder]` warnings.

## Steps

1. **Open Builder Mode** — tap the build icon in the bottom bar. Confirm:
   - Joystick suppresses (run pill hidden).
   - `BuildGridOverlay` renders **above the ground**, not anchored to the bar prefab.
   - Grid lines align to world origin (rotate avatar around the bar; grid does not slide with you).
   - Toggle row shows **Magnets**, **Free Build**, and **Plot** chips. All three visible on a 360 px viewport.
2. **Drop a single wall** — arm Walls → tap a grid cell. Confirm:
   - Wall snaps to the cell centre (cell pitch = `WALL_PITCH` = 2.5 m).
   - Wall is parallel to nearest cardinal axis.
3. **Drop a second wall** adjacent. Confirm:
   - Wall snaps coplanar to the first (shares an edge or runs parallel).
   - Four walls placed around one cell fully enclose a single grid box.
   - No phantom Z-offset.
4. **Toggle Free Build** — confirm grid greys out and snap is bypassed.
5. **Toggle Magnets** off, then on — grid restores to full-strength.
6. **Toggle Plot** — chip turns amber; walk a loop. Pending plot dialog quotes `boxes × 3 SWARM`.
7. **Exit Builder Mode** — grid overlay disappears; joystick restored.

## Screenshot checklist
- Grid floating above ground at world origin.
- Two walls snapped coplanar.
- Free Build state with grid dimmed.

## Known boundaries
- Grid is rendered relative to `WORLD_GRID_ORIGIN_ANCHOR`, never to a prefab. Regression: if a prefab is the anchor, file a P1.
- Snap pitch = `WALL_PITCH` = `CELL` = `PLOT_CELL` (2.5 m). Any drift between these constants is a bug.