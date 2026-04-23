
## Plan: Physics-correct Earth stabilization + real Wet Work habitat

### What will be corrected
The current implementation is still bypassing the engine in four places:

- `src/lib/brain/uqrcPhysics.ts` hard-clamps self/avatars to `BODY_SHELL_RADIUS` every tick.
- `src/components/brain/builder/BuilderBlockView.tsx` rewrites block positions onto `FEET_SHELL_RADIUS` every frame.
- `src/components/brain/BrainUniverseScene.tsx` repeatedly reprojects spawn, remote peers, broadcast state, and camera eye radius.
- `src/components/brain/SurfaceApartmentV2.tsx` is only a single pinned structure with visual wobble; it is not grown matter and not a physics-born organism.

That is why pressure reads across the ground instead of descending into the core, and why users can still clip into the core: the field is being overridden after the fact.

## Phase 4A — Remove post-hoc shell cheating and restore field ownership

### Files to edit
- `src/lib/brain/uqrcPhysics.ts`
- `src/components/brain/builder/BuilderBlockView.tsx`
- `src/components/brain/BrainUniverseScene.tsx`
- `src/lib/brain/earth.ts`

### Changes
1. Remove recurring shell re-projection from physics and render layers:
   - delete the per-tick humanoid hard clamp in `uqrcPhysics.ts`
   - delete per-frame block body writes in `BuilderBlockView.tsx`
   - delete the boot timer, remote reproject loop, and broadcast reproject in `BrainUniverseScene.tsx`

2. Keep only one-time spawn safety:
   - a single initial spawn projection is allowed at boot to avoid starting inside Earth
   - after boot, the field alone owns radial placement

3. Replace shell enforcement with a true field attractor:
   - move Earth surface support into the unified Earth pin profile instead of body/camera code
   - keep render and camera read-only

## Phase 4B — Rebuild the Earth radial profile so pressure terminates below the crust

### Files to edit
- `src/lib/brain/lavaMantle.ts`
- `src/lib/brain/earthCore.ts`
- `src/lib/brain/tectonics.ts`
- `src/lib/brain/__tests__/lavaMantle.test.ts`
- add `src/lib/brain/__tests__/earthSurfaceStability.test.ts`

### Changes
1. Convert the mantle writer into a true layered Earth profile with one writer per cell:
   - core sink band
   - dynamic mantle pressure band
   - static crust lock band
   - time-invariant outer surface band

2. Constrain dynamics to the interior:
   - `coreBreath(t)` and plate bias will fade fully to zero before the crust band
   - no plate modulation at the visible ground
   - no temporal modulation in the crust/support region

3. Route pressure inward instead of sideways:
   - pressure terms become radial-only in the mantle/core bands
   - convergent/divergent plate influence only changes deep mantle depth, never surface tangential bias

4. Keep UQRC compliance:
   - only `pinTemplate` writes
   - no new force constants
   - no visual-layer decisions
   - no body-pos edits outside the integrator

### Expected result
The surface becomes quiet because the outer support band is static, while the living motion remains below it and resolves toward the core.

## Phase 4C — Fix camera/core clipping by aligning observer shell to the solved body, not a visual patch

### Files to edit
- `src/components/brain/BrainUniverseScene.tsx`
- `src/components/brain/EarthBody.tsx`

### Changes
1. Make the camera follow the solved body position only.
2. Remove the current radial eye rescue that hides deeper physics mistakes.
3. Compute the eye from body position + local outward normal only.
4. Add a boot-time observer guard:
   - if the spawned body is invalid before the first stable tick, correct once
   - after that, no camera/body shell forcing
5. Keep `EarthBody` front-face culling only as a render safeguard, not as the actual fix.

### Expected result
Users no longer dip into the core because the body itself remains in the correct field basin, so the camera never needs to be “rescued” every frame.

## Phase 4D — Replace fake Wet Work with a grown habitat that emerges like a tree

### Files to create
- `src/lib/brain/wetWorkGrowth.ts`
- `src/lib/brain/wetWorkSeed.ts`
- `src/components/brain/WetWorkHabitat.tsx`
- `src/lib/brain/__tests__/wetWorkGrowth.test.ts`

### Files to edit
- `src/components/brain/BrainUniverseScene.tsx`
- `src/lib/brain/builderBlockEngine.ts`
- optionally `src/lib/brain/nature/natureCatalog.ts` if the habitat is treated as a species class

### Changes
1. Delete the current single-body apartment approach as the final solution.
2. Replace it with a growth graph:
   - root seed on the ground
   - trunk spine
   - branching ribs
   - chamber buds
   - connected interior hollows

3. Grow the habitat through the engine, not by visual deformation:
   - each major chamber/rib/root becomes a real builder block with mass + basin
   - growth state is stored in block metadata and advanced through `upgradeBlock`
   - layout is derived from field readings and anchor geometry, not hard-coded rooms

4. Make it actually “tree-formed apartment”:
   - central trunk as the load-bearing spine
   - roots spread into the ground
   - chambers grown off branch ribs
   - corridors become living branch tunnels
   - the interior is explorable because the open spaces are defined by the grown arrangement, not box walls

5. Use physics signals for growth decisions:
   - calm crust + deep-core coherence = expansion
   - convergent stress = denser ribs / thicker roots
   - `coreBreath(t)` can drive slow growth timing, not visible floor wobble

### Expected result
Wet Work becomes an organism that formed habitation through the physics system, rather than a static apartment wearing organic cosmetics.

## Phase 4E — Replace the current test structure after verification

### Files to edit
- `src/components/brain/BrainUniverseScene.tsx`
- `.lovable/plan.md`

### Changes
1. Remove the A/B test mount of `SurfaceApartmentV2`.
2. Mount the new `WetWorkHabitat` at the shared village anchor.
3. Keep the old apartment only until the new habitat is validated.
4. Update the plan file to mark:
   - Earth stabilization complete
   - observer clipping fixed
   - Wet Work converted from structure to organism

## Technical details
```text
Current failure mode:
field pressure changes
→ body/camera/blocks are reprojected to shells anyway
→ radial motion is suppressed
→ remaining visible effect becomes sideways/tangential drift
→ core clipping is hidden, not solved

Target model:
unified Earth pin writer
→ static crust support band
→ dynamic mantle below it
→ core sink below that
→ body integrates from field only
→ camera follows body only
→ Wet Work grows as many real field-coupled bodies
```

## Validation checklist
- Surface no longer visibly “breathes” to a standing observer
- Plate stress reads below the crust, not as lateral ground sliding
- No user or camera clip into the core during spawn, walk, or idle
- No per-frame reproject writes remain in render code
- Wet Work is no longer one rigid decorative mesh; it is a multi-part grown habitat driven through the builder/physics engine
