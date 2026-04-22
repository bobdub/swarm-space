

## Final spawn polish: always start in daylight, remove dead interior code

You're not actually broken — physics, controls, drift suppression, Moon, and the camera rig all work. The remaining issue is purely **where on the globe you spawn**. The Fibonacci-sphere slot is deterministic per peer-id but blind to where the Sun is, so ~50% of users spawn on Earth's night side and see "space" (black sky, faint Moon light only) instead of a sunlit park.

This plan biases spawn to the daylight hemisphere and removes the obsolete hollow-Earth/street code that's no longer wired into the scene.

### 1. Daylight-biased spawn — `src/lib/brain/earth.ts`

`spawnOnEarth(peerId, pose)` currently picks any of 4096 Fibonacci slots. Change it to:

1. Read the Sun's world position (the same constant the scene uses, e.g. `[60, 40, 30]` — export it as `SUN_POSITION` from `earth.ts` so scene + spawn agree).
2. Compute the **subsolar direction** in Earth-local coords:
   `sunDirLocal = invSpinQuat ⋅ normalize(SUN_POSITION − pose.center)`.
3. Use the peer-id hash to pick an angle θ around the subsolar axis and a small zenith offset φ ∈ [10°, 60°] from it (so you spawn roughly mid-morning to mid-afternoon, never at the pole or terminator).
4. Build the local surface point from (θ, φ) on the unit sphere, then place body center at `(EARTH_RADIUS + HUMAN_HEIGHT/2) · point`. Same world-space rotation step as today.

Effect: every new user spawns somewhere on the lit half of the planet, sees blue-tinted ground, sky, horizon. Walking still carries you anywhere — including into night, which is now an *exploration* (with the Moon you just added) rather than a confusing first impression.

### 2. Shared sun constant — `src/lib/brain/earth.ts` + `BrainUniverseScene.tsx` + `EarthBody.tsx`

Today the Sun's position is duplicated as a literal in the scene (`<pointLight position={[60,40,30]}>`) and re-passed as a `uSunPos` uniform. Export one constant:

```ts
export const SUN_POSITION: Vec3 = [60, 40, 30];
```

…and import it in both the scene (light position) and the spawn logic. One source of truth so daylight bias never drifts from the actual light.

### 3. Cleanup of dead hollow-Earth code

These were left behind when we moved from interior cavity → exterior walker. They no longer affect rendering but clutter the codebase and confuse future work:

**Delete:**
- `src/components/brain/StreetMesh.tsx` (no longer rendered).
- `src/lib/brain/street.ts` (only consumed by StreetMesh and the obsolete test).
- `src/lib/brain/__tests__/street.test.ts` (tests a removed surface).

**Trim from `src/lib/brain/earth.ts`:**
- `spawnOnStreet(...)` and the entire "INTERIOR (hollow-Earth) frame" section comment.
- `getInteriorSurfaceFrame(...)`.

**Trim from `src/lib/brain/uqrcPhysics.ts`:**
- The `interior = b.meta?.attachedTo === 'earth-interior'` branch in the body integrator clamp (lines ~422–445). Keep only the exterior `clampToEarthSurface` path.
- Remove `'earth-interior'` from the `isSurfaceHumanoid` check (drift suppression now applies only to `'earth-surface'`).

**Trim from `src/components/brain/RemoteAvatarBody.tsx`:**
- The `interior` prop / `getInteriorSurfaceFrame` branch — always use `getSurfaceFrame`.
- Update the one caller in `BrainUniverseScene.tsx` (line ~361) accordingly.

**Trim from `src/components/brain/BrainUniverseScene.tsx`:**
- The `const interior = body.meta?.attachedTo === 'earth-interior';` line and the prop it threads into `<RemoteAvatarBody/>`.

### 4. Tests

- **Update** `src/lib/brain/__tests__/earth.test.ts`:
  - Existing exterior-spawn case stays.
  - New case: for 50 random peer-ids, spawn position dotted with the (world-space, un-spun) sun direction is `> 0.3` — i.e. always on the lit side, with margin from the terminator.
- **Delete** `src/lib/brain/__tests__/street.test.ts`.

### Files touched

- **EDIT** `src/lib/brain/earth.ts` — add `SUN_POSITION`, rewrite `spawnOnEarth` with daylight bias, remove interior helpers (`spawnOnStreet`, `getInteriorSurfaceFrame`, comment block).
- **EDIT** `src/lib/brain/uqrcPhysics.ts` — drop interior clamp branch & `'earth-interior'` references.
- **EDIT** `src/components/brain/BrainUniverseScene.tsx` — import `SUN_POSITION`, use it for the `<pointLight>`, remove `interior` plumbing.
- **EDIT** `src/components/brain/EarthBody.tsx` — import `SUN_POSITION` for `uSunPos` (still passed via uniform; just sourced from the shared constant).
- **EDIT** `src/components/brain/RemoteAvatarBody.tsx` — drop interior branch.
- **EDIT** `src/lib/brain/__tests__/earth.test.ts` — add daylight-bias test.
- **DELETE** `src/components/brain/StreetMesh.tsx`, `src/lib/brain/street.ts`, `src/lib/brain/__tests__/street.test.ts`.

### What you'll experience

- Refresh on `/brain`: you spawn on a sunlit patch — blue sky, lit ground, horizon, Earth curving away. Never the dark side as a first view.
- Walk far enough (or just turn around) and you'll cross the terminator into night, where the Moon you just added becomes the dominant light. That transition is now a feature, not a bug.
- Codebase no longer carries the hollow-Earth cavity helpers — one Earth, one surface, one source of truth for the Sun.

### Out of scope (next, when ready)

- Atmosphere scattering shader for a sunset/sunrise gradient at the terminator.
- Time-of-day controls (let user fast-forward through day/night).
- Surface objects (a "store down the street" — actual buildings/landmarks placed on the planet).

