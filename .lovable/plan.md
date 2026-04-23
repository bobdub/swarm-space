
## Plan: replace static pinning with Earth-grown local field support

### What will change
The current surface system is not behaving like physics because builder content is still treated as a static defect:

- `src/lib/brain/uqrcPhysics.ts` skips `kind === 'piece'` during integration.
- `src/lib/brain/builderBlockEngine.ts` places a body once, then calls `physics.pinPiece(...)`.
- `src/components/brain/SurfaceApartment.tsx` does the same manual static placement.
- `src/components/brain/builder/BuilderBlockView.tsx` assumes the pin is what keeps the block in place.

That is not “grown into the local geometric field.” It is a one-cell constraint.

The fix is to make surface support come from a **co-moving Earth-local field volume**, not from a pinned point.

### Implementation
1. **Remove single-cell surface pinning as the placement model**
   - Replace `pinPiece()` usage for trees, apartments, and Wet Work nodes with a new Earth-local support writer that stamps a small volumetric basin aligned to:
     - local normal
     - local forward
     - local right
   - The support volume will be regenerated from the live Earth pose, so support moves with the planet instead of staying behind in stale world coordinates.

2. **Make builder blocks Earth-local first-class objects**
   - Extend `BuilderBlock` data in `src/lib/brain/builderBlockEngine.ts` so the authoritative state is:
     - anchor site
     - tangent offsets
     - yaw
     - support shape / footprint / height
   - The engine will derive the current world transform each update from `getEarthLocalSiteFrame()` and `earthLocalToWorld()`.
   - The engine will own the support-field write and cleanup for every block.

3. **Replace “piece = excluded from physics” with supported passive bodies**
   - Update `src/lib/brain/uqrcPhysics.ts` so surface structures are no longer treated as frozen non-physics objects.
   - Add a surface-supported body path:
     - receives field response
     - can settle into the local basin
     - does not require per-frame shell projection
   - Static architecture can still be heavily damped, but it must be stabilized by the field, not by a constraint cell.

4. **Grow support from local geometry, not world coordinates**
   - Add a support-field writer in the brain physics layer that can stamp:
     - trunk-like support for trees
     - slab / footprint support for apartments
     - distributed node support for Wet Work
   - Each support stamp will be built in Earth-local coordinates, then transformed into the live world frame every update.
   - This makes the surface field the reason objects remain grounded.

5. **Unify apartment/tree/Wet Work onto the same model**
   - Refactor:
     - `src/components/brain/SurfaceApartment.tsx`
     - `src/components/brain/SurfaceTree.tsx`
     - `src/components/brain/WetWorkHabitat.tsx`
     - `src/lib/brain/wetWorkGrowth.ts`
   - These components should become thin renderers over builder blocks.
   - No component should directly create a fake static body plus a pin.

6. **Make render fully read-only**
   - Keep `BuilderBlockView.tsx` as display-only, but update its contract/comments to reflect the new ownership:
     - field support defines equilibrium
     - body pose comes from physics
     - render never projects to shell or depends on “pin holds it here”

7. **Bring humanoids under the same surface-support logic**
   - Keep self/avatar falling behavior tied to the Earth field, not to special-case projection after spawn.
   - Review `BrainUniverseScene.tsx` spawn/update paths so local and remote humanoids are placed into the same Earth-supported regime rather than being repeatedly reset onto a shell.
   - This avoids having one physics model for players and another fake one for structures.

### Files to change
- `src/lib/brain/uqrcPhysics.ts`
- `src/lib/brain/builderBlockEngine.ts`
- `src/lib/brain/lavaMantle.ts`
- `src/components/brain/builder/BuilderBlockView.tsx`
- `src/components/brain/SurfaceApartment.tsx`
- `src/components/brain/SurfaceTree.tsx`
- `src/components/brain/WetWorkHabitat.tsx`
- `src/lib/brain/wetWorkGrowth.ts`
- `src/components/brain/BrainUniverseScene.tsx`

### Technical details
```text
Current model:
place world position once
→ write single-cell pin
→ skip structure body in integrator
→ Earth moves
→ support and object are not true local-field growth
→ floating / drifting / fake stability
```

```text
Target model:
store Earth-local anchor + local shape
→ regenerate support basin in live Earth frame
→ body samples that field and settles into it
→ no shell clamp
→ no single-point pin as the reason it stays put
→ trees, apartment, Wet Work all remain attached because the local field exists there
```

### Validation checklist
- A tree remains attached because its local support field co-moves with Earth, not because a static pin cell exists
- Apartments do not drift away when Earth rotates/orbits
- Wet Work is a distributed habitat whose nodes each have Earth-local field support
- A body spawned above the ground falls into the support basin and lands
- No builder content relies on `pinPiece()` as its stabilization mechanism
- No render component performs hidden reprojection or fake positional correction
