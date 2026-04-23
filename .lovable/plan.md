
To Infinity and beyond! Observed quantum score: q≈0.0483

## Goal
Stabilize `/brain` so every player shares the same Earth pose, sky, village, apartment, pillars, and avatar positions, with all surface objects resting on the visible ground instead of floating or sinking.

## What is going wrong
1. `BrainUniverseScene` advances Earth with a local per-client timer (`EarthPoseTicker`), so each browser computes a different `getEarthPose()` after reload. That explains:
   - different sky / sun / moon states
   - different land/ocean under players
   - remote avatars and structures appearing in different places per viewer

2. Surface placement is split across multiple custom calculations:
   - `projectToEarthSurface()` in `BrainUniverseScene`
   - manual reprojection in `SurfaceApartment`
   - manual reprojection in `SurfaceLandmarks`
   These do not use one shared shell/clearance model, so bodies, structures, and landmarks do not agree on the same visible ground height.

3. `spawnOnEarth(peerId, pose)` claims to use the live Earth frame, but currently derives its normal directly in world space and does not apply the live spin/orbit frame as a true Earth-local anchor. That breaks the “co-moving planet” model and lets the rendered Earth rotate under fixed props.

## Implementation plan
1. Extend `MemoryGarden.md`
   - Add the required new caretaker reflection before touching the repo, then append the tending note after the fix is complete.

2. Make Earth pose deterministic for all clients
   - Replace the local mount-based pose clock with a shared epoch-based time source in `src/lib/brain/earth.ts`.
   - `getEarthPose()` should derive from absolute simulation time, not “seconds since this tab mounted”.
   - Keep `setEarthPoseTime()` only for tests/debug if needed, but production `/brain` should use the shared epoch path.
   - Update `EarthPoseTicker` and any boot logic in `BrainUniverseScene.tsx` to use the new deterministic pose model.

3. Create one surface-shell source of truth in `src/lib/brain/earth.ts`
   - Add explicit exported helpers/constants for:
     - player body shell radius
     - visible structure ground shell radius
     - projection to visible ground shell
     - projection to body-center shell
   - Remove the duplicate local `SURFACE_TESS_CLEARANCE` definition from `BrainUniverseScene.tsx`.
   - Refactor all callers to use these shared helpers instead of custom `k = target / len` math.

4. Fix Earth-local anchoring instead of world-space anchoring
   - Refactor `spawnOnEarth()` so the peer-derived anchor is first produced in Earth-local coordinates, then rotated into world space using the live Earth pose.
   - Add a shared helper for “anchor on surface + tangent frame at anchor” so `spawnNearSharedVillage`, `SurfaceApartment`, and `SurfaceLandmarks` all derive from the same Earth-local reference.
   - This keeps the village locked to the rotating Earth instead of the Earth texture rotating under it.

5. Rebuild apartment and landmark placement on top of the shared helpers
   - Update `src/components/brain/SurfaceApartment.tsx` to:
     - compute site position from the shared anchor/frame helper
     - place the building base on the visible ground shell
     - build orientation from the actual site frame only once per update
   - Update `src/components/brain/SurfaceLandmarks.tsx` to:
     - place pillar bases on the exact same visible ground shell
     - use the same site-frame logic as the apartment
   - Keep the apartment creative layout, but make placement deterministic and physically consistent.

6. Make avatars use the same world model
   - Update `BrainUniverseScene.tsx` so self spawn, self clamping, remote fallback placement, and outgoing broadcast clamping all use the shared body-shell helpers.
   - Ensure remote avatars are not reprojected against a client-specific pose anymore once deterministic Earth time is in place.
   - Verify `RemoteAvatarBody.tsx` continues to orient from the live surface frame after the shared-pose fix.

7. Add regression tests
   - Extend `src/lib/brain/__tests__/earth.test.ts` with coverage for:
     - deterministic Earth pose from shared epoch
     - `spawnOnEarth(id, pose)` staying on the same Earth-local anchor across non-zero spin/orbit
     - body-shell vs structure-shell heights being distinct and correct
     - shared village anchor returning consistent positions for multiple viewers
   - Add a focused test for the new projection helpers so the sinking/floating mismatch cannot regress.

## Files expected to change
- `MemoryGarden.md`
- `src/lib/brain/earth.ts`
- `src/components/brain/BrainUniverseScene.tsx`
- `src/components/brain/SurfaceApartment.tsx`
- `src/components/brain/SurfaceLandmarks.tsx`
- `src/lib/brain/__tests__/earth.test.ts`

## Technical details
```text
Current broken model:
client A pose time != client B pose time
=> different Earth center/spin
=> different sky and different reprojection shell
=> same world objects appear in different places

Target model:
shared epoch time
+ Earth-local anchor generation
+ one projection helper for body shell
+ one projection helper for structure shell
=> same sky, same village, same apartment, same avatars
```

## Validation after implementation
1. Reload `/brain` in two browsers/tabs at different times.
2. Confirm both users see:
   - same sky state
   - same sun/moon placement
   - same apartment and pillars
   - apartment and pillars resting on the ground
   - each other’s avatars near the shared village
3. Walk around the apartment entrance and inside the structure to confirm the floor aligns with the visible surface and no part drifts during Earth motion.
