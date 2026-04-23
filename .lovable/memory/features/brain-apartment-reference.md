---
name: Brain Apartment Reference Structure
description: SurfaceApartment.tsx is the canonical mostly-stable example for builder-placed items in the Brain Universe — register UQRC physics 'piece' body + read pose in render. Open known bugs: scale not avatar-calibrated, no collider so Earth-breath ground passes through the floor.
type: feature
---

`src/components/brain/SurfaceApartment.tsx` is the canonical reference for any future builder-placed structure on Earth's surface in `/brain`.

**Contract (mirror this for every new structure):**
1. Register a `'piece'` body with `getBrainPhysics()` on mount; pin a curvature basin via `physics.pinPiece`; clean up on unmount.
2. Build initial pose from the SHARED `getEarthLocalSiteFrame(anchorPeerId)` — never from `selfId` — so every viewer sees it in the same world-space spot.
3. In `useFrame`, READ the body pose from physics (`getBody`) and reproject onto `FEET_SHELL_RADIUS` so it co-moves with Earth's orbit/spin.
4. Derive orientation from the live radial up vector + the spawn tangent frame, re-orthonormalized each tick. Never store an Euler.
5. Render is a READ-ONLY consumer of physics state.

**Status: Mostly stable** — no drift; pose locked to physics body + Earth-local site frame.

**Known bugs (open, intentionally not silently fixed):**
- **Scale not avatar-calibrated.** Wall, door, room dimensions are hand-tuned magic numbers, not derived from `BODY_CENTER_HEIGHT` or shared humanoid metrics.
- **No collider; Earth-breath through floor.** The apartment is pinned to the feet shell, but the visible ground shell breathes up/down with orbit phase, so the ground passes through the static floor slab. Fix requires a collider that follows the live ground shell, not just the body.

HUD: `?debug=physics` shows the apartment row labeled `(reference, no collision)`.

See `docs/VIRTUAL_HUB.md` and `mem://features/virtual-hub-builder`.
