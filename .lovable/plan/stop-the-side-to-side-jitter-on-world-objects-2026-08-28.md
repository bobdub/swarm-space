# Stop the side-to-side jitter on world objects

The vertical shake is gone because the camera now reads a frame-pinned Earth pose and an interpolated, Earth-local body track. Objects did not get that treatment: they are still drawn at the position stamped during the last **physics tick**, while the camera and the ground are drawn at **this frame's** pose. Earth's centre slides along its orbit at ~2.6 m/s, so on every frame that does not contain a tick the object sits ~4 cm sideways of where the world thinks it is — and it snaps back on the next tick. That alternation is the lateral jitter.

## What is confirmed in the code

- `builderBlockEngine.restampAll()` runs once per physics tick and overwrites `body.pos` from `computeWorldPos(block)`, which reads `getEarthPose()` at tick time (`src/lib/brain/builderBlockEngine.ts:110-127`, `:62-92`).
- `BuilderBlockView` renders straight from that tick-stamped `body.pos` each frame (`src/components/brain/builder/BuilderBlockView.tsx:48-87`). Walls, foundations, trees and every builder-placed structure go through this view.
- `HeldToolMesh` positions the held tool from raw `body.pos` (`src/components/world/HeldToolMesh.tsx:53-79`) while the camera uses the interpolated position — so the tool swims relative to the view.
- `BodyLayer` in `BrainUniverseScene.tsx:532-560` drives `piece` meshes from raw `body.pos` as well.
- Layers that already derive from an Earth-local normal plus the frame pose — `NatureLayer`, `CarvedCellsLayer`, `WeatherLayer` — are not affected and need no change.

`computeWorldPos` is a pure function of the block's Earth-local site frame (cached, deterministic) and the Earth pose, so it can be evaluated at render time and will agree exactly with the ground drawn in the same frame.

## Changes

### 1. Render structures from the frame pose, not the tick stamp
- Export the existing `computeWorldPos` from `builderBlockEngine.ts` as `blockWorldPos(block)` (no behaviour change — same math, same lift, same shell).
- `BuilderBlockView` calls `blockWorldPos(block)` inside `useFrame` instead of reading `body.pos`. Physics keeps re-stamping the body and its support basin every tick, so collision, tools and world mutation are untouched — only the pixels move to the frame-coherent pose.
- Same treatment for the `piece` meshes in `BodyLayer`: prefer the block engine's frame-derived position when the body belongs to a block, otherwise fall back to `getBodyRenderPos` (which already remaps the Earth-local track through the frame pose).

### 2. Weld self-attached visuals to the interpolated body
- `HeldToolMesh` reads `getBodyRenderPos(selfId, ...)` rather than `body.pos`, so the tool sits at the exact position the camera was built from.
- Audit the remaining per-frame consumers of `body.pos` that draw geometry (`AssetCaster` ghost, `BuildGridOverlay`, `PlotSurveyOverlay`) and switch the ones that place visible meshes onto the same interpolated read. Ray-casting and gameplay logic keep using authoritative `body.pos`.

### 3. Regression test
- Extend `src/lib/brain/__tests__/groundJitter.test.ts` with a lateral case: step the sim with jittered frame durations, and for each frame measure the **camera-relative** horizontal offset of a placed block. Assert the frame-derived path's frame-to-frame lateral jerk is a small fraction of the tick-stamped path's, and under a fixed millimetre bound.
- Add a check that `blockWorldPos` evaluated at a fixed pose equals the position the engine stamps at that same pose, so the render path can never drift from the physics path.

## Technical notes

- No new forces, no writes to `field.axes`, no change to the integrator or to pin templates — this is purely which pose the renderer samples. The `/brain` rule that visuals are a read-only trace of physics is preserved, and strengthened: the trace is now read at the instant it is drawn.
- Objects remain physically owned by the tick-rate basin stamp; the render-time evaluation is the same function the engine uses, so the two can differ by at most one frame of orbital motion and by construction agree with the ground drawn beside them.
