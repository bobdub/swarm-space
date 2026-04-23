

To Infinity and beyond! Observed quantum score: q≈0.0512

## Goal
Clean up `SurfaceApartment.tsx` and mark it as the canonical mostly-stable reference for future builder items, with the two known bugs documented in code and memory. Confirmed: the apartment no longer drifts; the remaining visible artifact is the Earth "breathing" up/down through the static floor (no collider yet).

## Changes

1. **`src/components/brain/SurfaceApartment.tsx`**
   - Replace top-of-file comment with a "Reference Structure" docblock:
     - Status: Mostly stable (no drift, locked to physics body + Earth-local site frame).
     - Known bug 1 — Scale/sizing not calibrated to avatar metrics.
     - Known bug 2 — No collider; Earth orbit/spin "breathes" through the floor.
     - Usage: Template for future builder-placed items (UQRC physics body + shared Earth-local site frame + render reads physics state).
   - Add inline `// KNOWN BUG:` markers at the scale constants and at the per-frame reprojection that lacks a collider.
   - Trim leftover debug scaffolding from the stabilization passes:
     - Remove one-off `console.*` traces.
     - Slim `apartmentTrackerState` to only the fields the `?debug=physics` HUD reads.
     - Drop unused imports (`STRUCTURE_SHELL_RADIUS`, `BODY_SHELL_RADIUS`, `earthLocalToWorld`, `EARTH_RADIUS`, `VISIBLE_GROUND_RADIUS` if no longer referenced).

2. **`src/components/brain/BrainUniverseScene.tsx`**
   - In the `?debug=physics` HUD, relabel the apartment row to `Apartment (reference, no collision)` so the known limitation is visible during QA.
   - No logic change.

3. **`MemoryGarden.md`**
   - Append a short caretaker reflection: apartment promoted to reference example; sizing and Earth-breath collision are the two open seams.

4. **`.lovable/memory/features/virtual-hub-builder.md`**
   - Add a "Reference structure" section pointing future builder items at `SurfaceApartment.tsx` as the working pattern.
   - List the two known bugs explicitly (scale not avatar-calibrated; no collider; Earth-breath drift).

5. **New memory: `mem://features/brain-apartment-reference`**
   - type: `feature`
   - Summary: apartment is the canonical mostly-stable structure example; future builder pieces should mirror its physics+render contract; known bugs (scale, no collision/Earth breathing) remain open.
   - Update `mem://index.md` to reference it (preserve all existing entries).

## Out of scope (deferred)
- Avatar-calibrated scale tuning.
- Adding a collider / canceling Earth-breath drift.
- Any change to `uqrcPhysics.ts`, `earth.ts`, or landmarks.

## Validation
- `/brain` renders the apartment in the same place and orientation, no drift.
- `?debug=physics` HUD shows live floor-vs-feet delta and the new "no collision" label.
- No new console noise; previous debug log spam removed.
- Memory index and builder memory file list the apartment as the reference and call out both known bugs.

