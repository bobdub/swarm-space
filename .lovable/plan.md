

## Spawn user inside Earth on a UQRC street

Right now `spawnOnEarth` places the body on the *outer shell* of Earth at altitude `EARTH_RADIUS + HUMAN_HEIGHT/2`. The clamp in `uqrcPhysics` keeps them pinned to that shell. The user wants to be **inside** Earth, standing on a small patch of land with a street, where the street itself is a real UQRC-attached object that inherits Earth's rotation and gravity.

Three pieces: a street as a UQRC particle patch, an attachment binding it to Earth's frame, and a spawn point on the street's surface inside the planet's interior shell.

### 1. Street as a UQRC particle patch

**New file: `src/lib/brain/street.ts`**
- `STREET_LENGTH = 12`, `STREET_WIDTH = 3`, `LAND_RADIUS = 6` (a small disc of land around the street).
- Define `StreetPatch = { center: Vec3, normal: Vec3, tangent: Vec3, particles: StreetParticle[] }`.
  - `center` is a point **on the inner shell** of Earth at `EARTH_RADIUS - LAND_THICKNESS` (default `LAND_THICKNESS = 0.5`), so the patch sits just inside the crust.
  - `normal` is the outward radial vector from Earth center (pointing toward the planet's interior cavity, i.e. *up* for someone standing on the street).
  - `tangent` is an arbitrary orthogonal axis on the patch plane → street direction.
- `buildStreet(pose)` seeds the patch by sampling a uniform grid of points inside `LAND_RADIUS` and registering each as a UQRC pin via `pin3D(field, pos, mass)` so the field "knows" the land exists. Mass = small constant per cell, summing to `STREET_TOTAL_MASS`. This is the same mechanism the rest of the brain uses to make matter visible to the field — no special-case rendering geometry without UQRC backing.
- Export `getStreetPose()` so render and physics share one source of truth, and `projectToStreet(pos)` to clamp arbitrary positions onto the patch surface.

### 2. Attach street to universe (rotation + gravity + user mass)

**Edit `src/lib/brain/earth.ts`**
- Add `EARTH_INTERIOR = true` mode helpers:
  - `getInteriorSurfaceFrame(pos, pose)` — returns `{ up, forward, right }` where `up` is the **inward** radial (toward Earth center inverted to the cavity surface), so a person standing inside Earth has their feet on the inner shell and their head pointing toward the core's hollow.
  - `INTERIOR_RADIUS = EARTH_RADIUS - LAND_THICKNESS` and `INTERIOR_HEAD = INTERIOR_RADIUS - HUMAN_HEIGHT` (head is closer to the core than the feet).
- Add `applyEarthFrame(particle, pose, dt)` that rotates a particle's position around Earth's spin axis by `pose.angularVelocity * dt`. This is what physically attaches the street to the planet's frame.

**Edit `src/lib/brain/uqrcPhysics.ts`**
- On each tick, before the integrator runs, call `applyEarthFrame()` for every street particle and for any body whose `meta.attachedTo === 'earth-interior'`. This gives the street + the user Earth's rotational motion automatically.
- Replace the surface clamp for `kind: 'self'` and `kind: 'avatar'` when `meta.attachedTo === 'earth-interior'`:
  - Clamp radial distance from Earth center to `[INTERIOR_HEAD, INTERIOR_RADIUS]` (shell of thickness `HUMAN_HEIGHT`, inside the planet).
  - Gravity for interior bodies points **outward** from Earth center (the inner shell pulls inward = body sits "down" on the cavity wall). Magnitude derived from Earth's total mass via the existing `pose.mass` field, scaled the same way the exterior attractor uses.
  - Add user mass back into the field via the existing `pin3D` path so the user perturbs the field they stand on (UQRC consistency).
- Keep tangential velocity untouched so the user can walk along the street.

### 3. Spawn the user onto the street

**Edit `src/lib/brain/earth.ts`**
- New `spawnOnStreet(id, pose, street)`:
  - Position = `street.center + street.normal * (HUMAN_HEIGHT / 2)` (body center, feet on street surface, head toward Earth's hollow core).
  - Velocity = zero (rotation is added by `applyEarthFrame` next tick).
  - Returns a body init with `meta.attachedTo = 'earth-interior'`, `meta.streetAnchor = street.center`.

**Edit `src/pages/BrainUniverse.tsx`**
- Boot order:
  1. `physics.restore(snap)` (existing).
  2. `updateEarthPin(field, pose)` (existing exterior basin).
  3. **New:** `const street = buildStreet(pose); registerStreetParticles(field, street);` — this UQRC-seeds the patch.
  4. **Replace** `physics.addBody({ kind: 'self', pos: spawnOnEarth(id, pose) })` with `physics.addBody({ ...spawnOnStreet(id, pose, street) })`.
  5. Stash `street` in a ref so the render layer can draw it.
- Camera (`PhysicsCameraRig`):
  - When the local body has `meta.attachedTo === 'earth-interior'`, use `getInteriorSurfaceFrame(pos, pose)` instead of `getSurfaceFrame`. Eye is at `pos + up * 0.3` (up here points toward the cavity's center). Look along the street's tangent by default. Horizon curves *upward* on either side because we are inside a sphere — that's correct and intentional.
- Render:
  - New `<StreetMesh street={streetRef.current} />` child of the existing Earth group: a thin grey strip (`STREET_LENGTH × STREET_WIDTH`) plus a softer green disc (`LAND_RADIUS`) under it, both oriented by the street's `(normal, tangent)` frame and positioned at `street.center`. Drawn on the **inside** of the Earth shell, so it renders only when the camera is interior (use `THREE.BackSide` material or just rely on it being hidden by the Earth shell when viewed from outside).
  - Make the existing Earth shell material `side: THREE.DoubleSide` (or render a separate inner shell) so the user can see the inside walls.

### 4. Remote avatars on the same street

- When `meta.attachedTo === 'earth-interior'` is set on remote-avatar bodies too, the same interior clamp and `getInteriorSurfaceFrame` apply, so peers spawn on the same street and stand correctly relative to it.
- Place each remote in a small ring around `street.center` along the street tangent (offset by `i * 1.2m`), still inside the patch radius.
- `RemoteAvatarBody` already accepts a `pose`-derived frame; switch its quaternion math to use `getInteriorSurfaceFrame` when the body's `meta.attachedTo === 'earth-interior'`.

### Files touched

- `src/lib/brain/street.ts` — **new**: street patch as UQRC particles.
- `src/lib/brain/earth.ts` — interior frame helpers, `spawnOnStreet`, `applyEarthFrame`.
- `src/lib/brain/uqrcPhysics.ts` — apply earth frame each tick, interior gravity + clamp, user mass back into field.
- `src/pages/BrainUniverse.tsx` — boot order, `StreetMesh`, interior camera frame, double-sided Earth shell.
- `src/components/brain/RemoteAvatarBody.tsx` — interior orientation when attached.
- `src/lib/brain/__tests__/earth.test.ts` — tests: street particles registered as pins, interior clamp keeps body inside `[INTERIOR_HEAD, INTERIOR_RADIUS]`, `applyEarthFrame` rotates a sample particle by the expected angle over `dt`, spawn position lies on the street patch.

### Acceptance

```text
1. After /brain entry, the user spawns INSIDE Earth, feet on a small grey street, head pointing toward the planet's hollow core.
2. The street is a flat strip of land sitting on the inner shell, surrounded by a soft green land disc; both are visible from inside.
3. The street's particles are real UQRC pins — calling field debug shows mass at the street cells.
4. As Earth rotates (pose.angularVelocity), the street and the user rotate together with the planet's frame; the user does not slide off.
5. Gravity inside Earth pulls the body outward against the inner shell (interior clamp); WASD / joystick moves tangentially along the street.
6. Remote peers entering the room spawn on the same street (offset ring along the tangent) and stand upright relative to the inner surface.
7. Camera horizon curves slightly upward on the sides, consistent with being inside a sphere — confirming the interior frame is in effect.
8. No regressions to exterior earth tests; new street + interior tests pass.
```

