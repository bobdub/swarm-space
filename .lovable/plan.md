## Visual Plate / Ground Drift Fix

### Problem

The player is now physically pinned to the surface (Q_Score ≈ 0.024, mantle restoring force confirmed). What still *looks* wrong is that the **ground texture slides underfoot** as Earth spins. Players read this as "I'm sinking / clipping through the floor."

### Root Cause

`src/components/brain/EarthBody.tsx` samples its near-camera ground detail (grass micro-noise, dirt blotches, stripe pattern) from `vWorldPos` — the **post-rotation world position** of each fragment. Earth itself spins via `ref.current.rotation.y = pose.spinAngle`, so the same patch of dirt receives a *different* `vWorldPos` every frame. The pattern slides while the geometry stays put, creating the illusion of a moving floor.

The actual tectonic plate data (`src/lib/brain/tectonics.ts`) is **static** — plates have a `drift` vector but it is never integrated against time. So this is purely a shader-coordinate-frame bug, not a tectonics simulation bug.

### Fix

Sample the near-camera ground noise in **Earth-local** space (the unrotated `position` attribute) instead of world space. Lighting and the atmosphere rim continue to use world-space vectors so the sun stays in the right place.

### Technical Changes

**`src/components/brain/EarthBody.tsx`**

1. Add a new varying `vLocalPos` in the vertex shader, set to the raw `position` attribute (Earth-local, pre-spin).
2. In the fragment shader, replace `vWorldPos` with `vLocalPos` inside the `nearMix > 0.001` block for:
   - `micro1/micro2/micro3` noise inputs
   - the `stripes` sin pattern
   - the `oceanRipple` modulation
3. Keep `vWorldPos` for the sun `lightDir`, the camera-distance calculation, the view-direction rim, and shadow lookups.

Result: the painted ground is locked to the sphere's local frame and rotates *with* the geometry. From the player's POV, the dirt under their feet is stationary while the sun arcs overhead — exactly what "standing on a spinning planet" should look like.

### Out of Scope

- Animating tectonic plate drift over time (still a future feature; current `tectonics.ts` is intentionally static data).
- Adding a collider mesh to `SurfaceApartmentV2` (separate known limitation).
- `FieldFloor` curvature plate — only used in the lobby/non-Earth contexts; not on the surface walk path.

### Verification

- Run `npm test` — existing physics tests (`uqrcPhysics.test.ts`, `lightspeed.test.ts`, `earth.test.ts`) must still pass; this change is shader-only.
- In preview: stand still on Earth, watch the grass — it should no longer slide. Walking should now visibly translate the player relative to the texture.
- Confirm the lit hemisphere still tracks the Sun (sanity check that we didn't accidentally rotate `lightDir` into local space).
