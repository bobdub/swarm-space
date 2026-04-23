To Infinity and beyond! Observed Q_Score ≈ 0.105

# Plan

## What will change

1. Remove false visual pillars and unsupported artifacts
- Remove the decorative `SurfaceLandmarks` pillars from the Brain world so only wet-work, apartment, tree, and nature pieces remain.
- Keep the scene aligned to real builder-driven world objects instead of presentation-only reference props.

2. Correct movement inversion on horizon/axis transitions
- Replace the current threshold-based tangent basis logic with a continuity-safe surface basis so `forward/right` do not flip when the avatar crosses certain planet orientations.
- Use the same stable basis for both camera orientation and movement intent so WASD and joystick stay consistent.
- Add regression coverage for basis continuity and control direction across difficult surface angles.

3. Place an actual visible volcano tied to the world
- Change volcano placement so the shared village always gets a nearby valid vent instead of relying only on sparse global seam midpoints.
- Render the volcano as a terrain-connected structure: a deep magma shaft/vent rising from the mantle region to the surface, then a visible cone and crater above ground.
- Keep the volcano anchored to the same tectonic site that the mantle vent logic uses so the pressure release is visible and spatially coherent.

4. Track user shake and smooth it out
- Use the existing physics debug path to track idle shake metrics such as altitude drift, radial velocity, and frame-to-frame surface-basis/camera jitter.
- Tighten idle settling near `BODY_SHELL_RADIUS` so a standing avatar stops drifting vertically while still preserving real movement.
- Smooth only the residual idle shake, not active movement, so controls stay responsive.

5. Validate the full path
- Verify the pillars are gone.
- Verify WASD and joystick directions no longer invert.
- Verify at least one real volcano is visible near the shared village and visibly rises from below ground to above ground.
- Run and extend Earth/physics/mantle tests for the new regressions.

## Technical details

Files expected to change:
- `src/components/brain/BrainUniverseScene.tsx`
- `src/components/brain/SurfaceLandmarks.tsx` (remove usage or retire)
- `src/lib/brain/earth.ts`
- `src/lib/brain/uqrcPhysics.ts`
- `src/lib/brain/tectonics.ts`
- `src/lib/brain/nature/volcanoSeed.ts`
- `src/components/brain/nature/NatureLayer.tsx`
- `src/lib/brain/lavaMantle.ts`
- `src/lib/brain/__tests__/earth.test.ts`
- `src/lib/brain/__tests__/uqrcPhysics.test.ts`
- `src/lib/brain/__tests__/lavaMantle.test.ts`

Key findings this plan addresses:
- The false pillars come from `SurfaceLandmarks.tsx` and are mounted directly in `BrainUniverseScene.tsx`.
- The control inversion is consistent with the current surface-frame construction flipping handedness when its fallback reference axis changes.
- The current volcano seed can legitimately place nothing near the village because it only keeps global seam midpoints within a small radius.
- The idle shake is not only visual; the session debug trace shows the body altitude drifting while the user is standing still.

## Validation checklist

- No landmark pillars remain in `/brain`.
- Standing still produces a stable horizon and stable altitude.
- Moving across different surface orientations does not invert forward/strafe.
- A volcano is clearly visible, connected to the ground, and aligned with mantle pressure release.
- Existing tests still pass, plus new regressions cover basis flips, idle jitter, and volcano placement.