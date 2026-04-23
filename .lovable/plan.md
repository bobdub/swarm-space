
# Plan — Wet-work only, camera-relative controls, real volcano, damp idle shake

## Restated intent (so I do not misread again)

- **Wet-work IS the world.** The trunk + roots + ribs + chambers habitat ("the tree that grew into an apartment") is the *only* valid surface structure and must be visible at spawn.
- **Remove non-wet-work artifacts only:** the decorative pillars (`SurfaceLandmarks`), the legacy `SurfaceApartment`, and the unused `SurfaceApartmentV2`. Decorative free-floating orbs that are not part of a wet-work block must also go.
- **Do NOT remove `WetWorkHabitat`, `SurfaceTree`, `NatureLayer`, or `BuilderBlockEngine`.** These are wet-work / builder-driven and stay.
- Fix controls inverting when the camera is yawed.
- A real volcano must be visible from spawn, with a magma shaft from below ground rising into a cone above ground.
- Idle shake must be measured and damped without numbing real movement.

## What changes

### 1. Remove non-wet-work artifacts (and only those)

In `src/components/brain/BrainUniverseScene.tsx`:
- Stop importing and mounting `SurfaceApartment` and `SurfaceLandmarks`.
- Remove the `apartmentTrackerState` import + any reads (it is only used because the legacy apartment is mounted; the village anchor stays as `SHARED_VILLAGE_ANCHOR_ID`).
- Keep `WetWorkHabitat`, `SurfaceTree`, `NatureLayer`, `EarthBody`, `AtmosphereSky`, `RemoteAvatarBody`.

Retire (delete) the now-unused files so they cannot be remounted later:
- `src/components/brain/SurfaceApartment.tsx`
- `src/components/brain/SurfaceApartmentV2.tsx`
- `src/components/brain/SurfaceLandmarks.tsx`

Keep `WetWorkHabitat.tsx` exactly as is for this pass; if any *non-wet-work* decorative orbs exist inside it (the chamber currently uses a translucent membrane sphere — that IS a wet-work chamber, not a decorative orb), they stay. The "orbs" the user is complaining about are the landmark spheres in `SurfaceLandmarks.tsx`, which we are deleting.

### 2. Make controls camera-relative so spinning never inverts WASD

Root cause: in `BrainUniverseScene.tsx` `useFrame`, the camera is built as `basisQuat × yaw × pitch`, but the intent sent to physics uses the *unrotated* basis (`fwdN`, `rightN`). After yawing 180°, "W" still pushes along the village-derived forward, which now reads as "backward" relative to where you're looking.

Fix in `BrainUniverseScene.tsx`:
- Build a yawed basis on the tangent plane each frame:
  - `fwdCam = cos(yaw) * fwdN + sin(yaw) * rightN`
  - `rightCam = cos(yaw) * rightN - sin(yaw) * fwdN`
  - Renormalize both, re-orthogonalize against `upN`.
- Send `basis: { up: upN, forward: fwdCam, right: rightCam }` to `physics.setIntent`.
- Keep the camera quaternion calc unchanged — only the *intent basis* becomes camera-relative.

This is a continuity-safe rotation in the tangent plane (no thresholds, no handedness flip), so WASD and joystick agree with the camera at every yaw and at every latitude.

### 3. Place a real, visible volcano tied to the world

In `src/lib/brain/nature/volcanoSeed.ts`:
- Always seed exactly one *guaranteed* volcano within ~40–60 m of the village anchor on the first call (deterministic offset along the village's local `forward`), in addition to any tectonic-driven sites elsewhere. This guarantees first-spawn visibility.
- Tag the seed with `magmaDepth` (e.g. 12 m below `FEET_SHELL_RADIUS`) and `coneHeight` (e.g. 9 m above) so the renderer can draw both halves.

In `src/components/brain/nature/NatureLayer.tsx` volcano renderer:
- Draw three connected pieces in one group, all anchored to the same surface point:
  1. **Magma shaft** — a tall thin cylinder extending from `-magmaDepth` to `0` along the local up, glowing emissive orange, rendered with `depthWrite: false` for the underground portion so it reads through the ground.
  2. **Cone** — a `coneGeometry` from `0` to `+coneHeight`, basaltic dark material.
  3. **Crater + glow** — a small ring at the cone tip with an emissive disc.
- No animations on the volcano (static — see §4 about idle shake).

In `src/lib/brain/lavaMantle.ts`:
- Confirm the spatial vent sink already added in the previous pass aligns with the volcano sites returned by `getVolcanoSites()`. If the seed adds a guaranteed village-side site, expose it through the same `getVolcanoSites()` so the mantle vent and the visible cone share one source of truth.

### 4. Track and smooth idle shake

In `src/lib/brain/uqrcPhysics.ts`:
- Add a small idle telemetry block (debug only): on each tick when `intentMag < 0.05`, record `radialDelta = |rMag − BODY_SHELL_RADIUS|`, `vRad`, and frame-to-frame `Δup` of the smoothed basis. Expose via `getIdleJitter()` for the debug HUD.
- Tighten the idle radial dead-band already added: when `intentMag < 0.05` AND `|dr| < 0.25 m` AND `|vRad| < 0.05 m/s`, **snap** `rMag = BODY_SHELL_RADIUS` and zero `vRad` (hard pin). Outside the dead-band, keep the existing critical damping. This kills the residual sawtooth without affecting active movement (any intent above the threshold immediately releases the pin).

In `BrainUniverseScene.tsx`:
- Increase the basis lerp toward the live frame slightly when `intentMag < 0.05` so the camera up doesn't micro-roll while standing still, but keep it loose during movement.

### 5. Tests

- `src/lib/brain/__tests__/uqrcPhysics.test.ts`: add cases that
  - assert idle hard-pin engages within N ticks of zero intent at the shell, and
  - assert that with non-zero intent the radial pin releases.
- `src/lib/brain/__tests__/earth.test.ts`: add a regression that yaws the camera through a full 360° and asserts the camera-relative intent forward ⋅ camera forward stays > 0.99 (no inversion).
- `src/lib/brain/__tests__/lavaMantle.test.ts`: assert the guaranteed village-side volcano site appears in `getVolcanoSites()` and the mantle sink at that direction is non-zero.
- New `src/lib/brain/__tests__/volcanoSeed.test.ts`: assert at least one volcano block within 60 m of the village anchor on first seed.

## Files touched

- `src/components/brain/BrainUniverseScene.tsx` (unmount legacy, camera-relative intent, idle lerp tweak)
- `src/components/brain/nature/NatureLayer.tsx` (magma shaft + cone renderer)
- `src/lib/brain/nature/volcanoSeed.ts` (guaranteed village-side volcano, depth/height meta)
- `src/lib/brain/lavaMantle.ts` (single source of truth for vent sites)
- `src/lib/brain/uqrcPhysics.ts` (idle telemetry + hard pin in dead-band)
- Delete: `src/components/brain/SurfaceApartment.tsx`, `src/components/brain/SurfaceApartmentV2.tsx`, `src/components/brain/SurfaceLandmarks.tsx`
- Tests: `uqrcPhysics.test.ts`, `earth.test.ts`, `lavaMantle.test.ts`, new `volcanoSeed.test.ts`

## Validation checklist

- At spawn you see: ground, the wet-work habitat (trunk/roots/ribs/chambers), the small UQRC tree, nature layer, and a volcano with a visible magma shaft going below ground into a cone above ground.
- No pillars, no decorative orbs, no legacy boxy apartment.
- Spinning the camera 360° never inverts WASD or joystick directions.
- Standing still: altitude is flat (no −4.6 ↔ −4.4 sawtooth), horizon does not micro-roll.
- All existing physics/earth/mantle tests pass; new regressions pass.
