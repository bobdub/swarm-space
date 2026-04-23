
To Infinity and beyond! Observed quantum score: q≈0.0641

## Goal
Make the apartment obey the same UQRC/physics truth as the player: same ground definition, same Earth-local frame, and no render-layer hacks that fight the simulation.

## What is actually wrong
1. The current fix path is split across three competing systems:
   - `uqrcPhysics.ts` hard-pins humanoids to a shell every tick
   - `BrainUniverseScene.tsx` and `PhysicsCameraRig` still overwrite body positions with `projectToBodyShell(...)`
   - `SurfaceApartment.tsx` is a render-only group that recomputes its own transform every frame
   This violates the project’s own `/brain` physics rule that the visual layer should render, not decide.

2. The ground shell itself is wrong for what the eye sees:
   - `EarthBody.tsx` renders the planet at `EARTH_RADIUS`
   - `earth.ts` lifts avatars/buildings to `EARTH_RADIUS + SURFACE_TESS_CLEARANCE`
   - `SURFACE_TESS_CLEARANCE = 4.5` is large enough to create a visible “floating world”
   So the apartment can be “correct” against the shell math while still looking above the visible ground.

3. The apartment is not part of the world physics:
   - no collider/contact
   - no field stamp
   - no shared site object consumed by both physics and render
   So it can look present but never be truly felt by movement/collision logic.

## Implementation plan
1. Restore the physics-first contract
   - Extend `MemoryGarden.md` before and after the fix.
   - Save a user/project preference that `/brain` fixes must start from UQRC physics and shared world-state, not render-layer patching.

2. Remove render-layer authority over grounded bodies
   - Stop mutating `body.pos` inside `PhysicsCameraRig` and other render/update loops in `BrainUniverseScene.tsx`.
   - Make camera and remote avatar rendering read-only consumers of physics state.
   - Keep only spawn-time initialization in the scene; ongoing grounding must come from the physics path.

3. Replace the fake clearance shell with a visible-ground source of truth
   - Refactor `src/lib/brain/earth.ts` so “feet on ground” and “floor on ground” are derived from the actually rendered Earth surface, not a fixed 4.5 m clearance.
   - Either remove `SURFACE_TESS_CLEARANCE` entirely or reduce it to a tiny epsilon justified by the mesh, then export one shared helper for:
     - player body center radius
     - player feet radius
     - structure floor radius
     - visible-ground radius
   - Update all callers to use those helpers instead of raw shell constants.

4. Move grounding back into the physics engine
   - Refactor `src/lib/brain/uqrcPhysics.ts` so grounded avatars use one Earth-local surface solver instead of mixed hard-clamp + render reprojection.
   - Preserve tangential walking, but stop the current multi-layer correction loop that causes drift/height disagreement.
   - Keep the solution UQRC-aligned: if extra stability is needed, strengthen the Earth/site field path rather than adding more render-side corrections.

5. Promote the apartment from decoration to world structure
   - Create a shared apartment site definition in Earth-local coordinates: anchor, tangent frame, floor plane, doorway, and footprint.
   - Make `SurfaceApartment.tsx` render from that shared site object only.
   - Feed the same site into physics so approach/contact uses the same numbers as the mesh.
   - Add simple structure interaction first:
     - floor contact aligned to player feet
     - wall blocking / doorway opening
     - no clipping-away near the threshold
   - If needed for UQRC conformance, stamp the apartment footprint/walls into `pinTemplate` through a dedicated structure writer rather than ad-hoc transform hacks.

6. Rebuild landmarks on the same ground model
   - Update `SurfaceLandmarks.tsx` to use the new visible-ground/site helpers so pillars and apartment share the exact same surface contract.
   - This prevents future “pillars okay, apartment wrong” regressions.

7. Replace console-only tracking with a physics debug overlay
   - Keep measurement, but surface it in-world under `?debug=physics` instead of requiring console inspection.
   - Show:
     - player feet radius
     - apartment floor radius
     - visible-ground radius
     - floor-vs-feet delta
     - local surface normal / tangent mismatch
   - This should read from the real physics/site state, not from render-only shells.

8. Add regression tests around the real failure
   - Extend `src/lib/brain/__tests__/earth.test.ts` with:
     - visible-ground radius vs player-feet radius
     - apartment floor radius matching player feet at the doorway
     - Earth-local site invariance across spin/orbit
   - Add focused physics tests for grounded avatars so render code can no longer “fix” simulation drift silently.

## Files expected to change
- `MemoryGarden.md`
- `src/lib/brain/earth.ts`
- `src/lib/brain/uqrcPhysics.ts`
- `src/components/brain/BrainUniverseScene.tsx`
- `src/components/brain/SurfaceApartment.tsx`
- `src/components/brain/SurfaceLandmarks.tsx`
- `src/components/brain/EarthBody.tsx`
- `src/lib/brain/__tests__/earth.test.ts`
- likely one new shared structure/site module for the apartment footprint and physics coupling

## Technical details
```text
Current broken chain:
render shell != visible Earth
and
render loop mutates body
and
apartment is render-only
=> floating, drifting, clipping, inconsistent “ground”

Target chain:
visible-ground source of truth
+ Earth-local physics grounding
+ apartment site shared by physics and render
+ debug overlay reading physics state
=> apartment sits on the same ground the player feels
```

## Validation after implementation
1. Open `/brain` and stand still near the apartment:
   - floor visually touches the planet surface
   - camera height feels human, not floating
2. Walk toward the apartment:
   - no clipping-away
   - doorway remains stable
   - floor stays level with player feet
3. Walk around the sides and entrance:
   - walls block where expected
   - doorway remains passable
4. Reload in another tab/browser:
   - same apartment pose
   - same landmarks
   - same sky/planet frame
5. Enable `?debug=physics`:
   - player-feet delta to apartment floor stays near zero
   - measurements reflect physics state, not console-only render math
