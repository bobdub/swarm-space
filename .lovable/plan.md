

## Walk on Earth's outside surface — replace hollow-cavity spawn with exterior ground + sky

### What's wrong today

We spawn **inside** a hollow cavity, on a tiny "street" patch tangent to the inner shell. From there:
- The camera looks at the back-faces of the Earth shell → black sphere.
- Tiny co-rotational residuals on the inner sphere read as "spin/drift."
- The street is a special-case patch with its own coordinate frame, fighting the planet pose.

You don't want a cavity. You want a planet you stand **on**, like a park.

### New model — exterior planet walker

One sphere, one "up." The avatar lives on the **outside** of `EarthBody` at radius `EARTH_RADIUS`. "Up" is always the radial vector from planet center to feet. Movement is along the tangent plane at that point. No street, no cavity, no special frame.

```text
            sky (stars, sun, atmosphere rim)
                       ▲
                       │  up = normalize(pos − planetCenter)
                  ┌────┴────┐
                  │  avatar │   feet at r = EARTH_RADIUS
                  └────┬────┘
                  ╱╱╱╱╱╱╱╱╱╱╱      ← procedural land (already in EarthBody shader)
            ◯ Earth (solid, shaded outside)
```

### Files & changes

1. **`src/lib/brain/earth.ts`**
   - Replace `spawnOnStreet` with `spawnOnEarthSurface(seed)`: pick a lat/lon (deterministic from peer id), compute `pos = planetCenter + up * (EARTH_RADIUS + HUMAN_HEIGHT/2)` so feet sit on the surface. Velocity zero.
   - Export `getSurfaceFrame(pos)` returning `{ up, north, east }` (orthonormal) for movement and camera.
   - Keep `getEarthPose()` (already drives `EarthBody` rotation); the surface frame must co-rotate with the planet's `spinAngle`, so `up` is computed in world space after pose is applied — surface points "stick" to the planet.

2. **`src/lib/brain/uqrcPhysics.ts`**
   - Remove the **interior** clamp that pulls bodies onto `STANDING_RADIUS`.
   - Add an **exterior** clamp: for any body tagged `surface: 'earth'`, project to the sphere of radius `EARTH_RADIUS + HUMAN_HEIGHT/2` around the live planet center, and zero the radial velocity component (gravity-into-surface).
   - Tangential rest bleed (existing) keeps stationary avatars perfectly still — no more drift.
   - Intent vector (WASD) is interpreted in the **tangent plane** using `getSurfaceFrame`, so "forward" is always along the ground regardless of where on the globe you are.

3. **`src/components/brain/BrainUniverseScene.tsx`**
   - Boot anchor uses `spawnOnEarthSurface` instead of `spawnOnStreet`.
   - Camera follows the avatar with `up = surfaceFrame.up` (third-person, slight offset behind+above along `−forward + up`). This single change eliminates the "black sphere" — you're now looking *at* Earth from outside, not at its inner back-faces.
   - Stop rendering `<StreetMesh/>`. Stop the cavity carve / interior shell logic.

4. **`src/components/brain/EarthBody.tsx`**
   - Already procedurally shades land/ocean/ice on the outside. Keep as-is. It becomes the visible park.
   - Add a thin **atmosphere shell** (existing rim glow stays) — this is also the boundary we'll later use for "leave atmosphere → space flight." No flight code now; just leave a `getAtmosphereRadius()` export = `EARTH_RADIUS * 1.08` for future use.

5. **`src/components/brain/StreetMesh.tsx`**
   - Delete usage from the scene. File can stay on disk, unrendered, until we're sure nothing else imports it; or remove the import only.

6. **Tests**
   - `src/lib/brain/__tests__/earth.test.ts`: new case — `spawnOnEarthSurface` returns a position with `‖pos − center‖ ≈ EARTH_RADIUS + HUMAN_HEIGHT/2`.
   - `src/lib/brain/__tests__/street.test.ts`: keep but mark the interior cases skipped (they describe a removed surface).
   - New uqrc test: a body with no intent stays bit-stable on the exterior clamp for 600 ticks.

### What you'll experience

- Spawn places you on a green/blue Earth you can see (no more black sphere).
- WASD walks you tangentially across the surface; the horizon curves correctly because "up" rotates with your position.
- Stand still → no drift, no spin.
- Land "naturally forms" because it's the same procedural shader on `EarthBody` — there's no separate street to mismatch.
- The atmosphere rim is visible above the horizon, ready for future "fly out into space" work.

### Out of scope (next step, when you're ready)

- Flight: lifting `surface` tag off the body, switching clamp to a soft atmosphere drag, and re-enabling galaxy free-flight once `‖pos − center‖ > getAtmosphereRadius()`.
- Procedural trees/rocks: can be sampled from the same noise the shader uses, on the outside surface, later.

