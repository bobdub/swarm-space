# Plan: stabilize the ground and add real volcano pressure release

## What will be fixed
- Stop the visible floor/world shaking.
- Add actual volcano world objects tied to tectonic seams.
- Keep mantle pressure release deep in the system without leaking motion into the walkable surface.

## Findings
- There is currently no real volcano feature in the world. `lavaMantle.ts` talks about venting through volcano sites, but there is no `volcano` nature kind, no volcano seeding, and no volcano renderer.
- A separate visual shake source already exists in `SurfaceApartmentV2.tsx`: it animates scale and tilt every frame from curvature/drift, which can make the floor look unstable even when physics is correct.
- The debug/session data shows the body altitude and floor gap are still oscillating slightly, so this is not only a cosmetic issue.

## Implementation steps
1. Remove artificial floor wobble from world structures
- Strip the pulsing/tilting animation from `SurfaceApartmentV2.tsx` so buildings stop acting like soft tissue.
- Review nearby Earth-surface props for similar read-only motion that can be mistaken for ground instability.

2. Make mantle venting truly surface-isolated
- Refactor `lavaMantle.ts` so pressure release is computed from fixed tectonic vent sites rather than as a broad dynamic-band modulation.
- Keep the vent effect confined to deep mantle cells under convergent seams, with zero contribution in crust/surface bands.
- Replace any remaining periodic radial variation that can leak into the sampled surface force with a steadier accumulation/release profile.

3. Add real volcano world features
- Extend the nature catalog with a `volcano` kind.
- Add deterministic volcano seeding near convergent plate boundaries using the same tectonic data used for mountains.
- Render volcano geometry in `NatureLayer.tsx` so users can actually see where pressure is being released.

4. Strengthen stability diagnostics and regression tests
- Add tests that verify repeated mantle updates do not cause measurable surface jitter at `BODY_SHELL_RADIUS` over many reassert cycles.
- Add a regression test that checks the radial acceleration near the walking shell remains effectively flat while venting is active.
- Add a test for volcano seeding so vents only appear at convergent boundaries and remain deterministic.

5. Tighten debug visibility
- Expand the physics debug overlay to expose surface jitter magnitude and vent/volcano proximity so future shake reports can be localized quickly.

## Files likely involved
- `src/lib/brain/lavaMantle.ts`
- `src/lib/brain/tectonics.ts`
- `src/lib/brain/nature/natureCatalog.ts`
- `src/lib/brain/nature/mountainSeed.ts` or new volcano seeding module
- `src/components/brain/nature/NatureLayer.tsx`
- `src/components/brain/SurfaceApartmentV2.tsx`
- `src/lib/brain/__tests__/lavaMantle.test.ts`
- `src/lib/brain/__tests__/uqrcPhysics.test.ts`

## Technical details
- Volcanoes will be data-driven from `boundaryInfo(normal)` and seeded only on convergent seams.
- Surface stability will be protected by keeping vent modulation below the crust lock band and by testing for near-zero temporal drift at the avatar shell.
- Visual props must remain read-only consumers of physics; no prop animation should mimic terrain displacement unless it is explicitly intentional and isolated from the floor.

## Expected result
- The ground feels still under the avatar.
- Volcanoes exist as visible tectonic features instead of only being implied in comments.
- Mantle pressure release remains part of the world model without reintroducing clipping or shake.