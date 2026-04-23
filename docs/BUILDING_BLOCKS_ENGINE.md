# Building Blocks Engine

> Status: **Reference / Design** — labels the gameBuilder bridge that lets the
> Virtual Hub Builder catalog place real UQRC bodies on Earth in `/brain`.
> Companion to `BRAIN_UNIVERSE.md` and `VIRTUAL_HUB.md`.

The Building Blocks Engine is **not** a parallel game engine. The game engine
already exists — it is `UqrcPhysics` (`src/lib/brain/uqrcPhysics.ts`). The
Building Blocks Engine is the thin **bridge layer** that turns Virtual Hub
Builder pieces (Sims-style construction made of real chemical compounds) into
first-class citizens of the Brain Universe: real `'piece'` bodies, real field
pins, real Earth-local poses.

## Why "building blocks"

Every placeable item is a *block* in two senses at once:

1. **Construction block** — a wall, floor, prop, or prefab from
   `src/lib/builder/builderCatalog.ts`.
2. **Curvature block** — a UQRC body that pins the field at its world position
   (`physics.pinPiece`), with basin depth derived from the compound's molar
   mass in `compoundCatalog.ts`.

Both senses share one source of truth. The physics engine moves the bodies;
the builder catalog gives them meaning, dimensions, and matter.

## Reference contract (per piece)

Every Building Block follows the **SurfaceApartment contract** verbatim
(`src/components/brain/SurfaceApartment.tsx`):

- Pose stored in **Earth-local lat/lon + local yaw**, never in world XYZ — so
  pieces co-rotate with Earth automatically through
  `getEarthLocalSiteFrame(anchorPeerId)`.
- On mount: build world pose → `physics.addBody({ kind: 'piece', meta })` →
  `physics.pinPiece(worldPos, basinFromMass)`.
- On every frame: read `physics.getBody(bodyId)`, reproject onto
  `FEET_SHELL_RADIUS`, derive orientation from live radial up + spawn tangent
  frame (re-orthonormalized).
- On unmount: `physics.unpin(pin)` + `physics.removeBody`.

Inherited known bugs (tracked, not yet fixed — see SurfaceApartment):

- **No collider.** Earth's ground shell still "breathes" through the floor.
  Fix belongs in `earth.ts` and applies to all blocks at once.
- **Scale not avatar-calibrated.** Catalog dims are hand-tuned.

## Layer map

```text
              Player in /brain
                    │
        Build mode toggle
                    │
        ┌───────────▼────────────┐
        │  Building Blocks Engine│   ← reads catalog + compounds
        │  (gameBuilder bridge)  │   ← reads Earth-local site frame
        └───────────┬────────────┘   ← reads UqrcPhysics (truth)
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
  UqrcPhysics               BrainBuildStore
  - addBody('piece')        - per-user pieces[]
  - pinPiece(world, basin)  - throttled IDB (2.5s)
  - unpin / removeBody      - peer broadcast (stub)
        │
        ▼
  <BrainBuildPiece/>  one per block, SurfaceApartment contract
```

## Out of scope (deferred)

- Collider / Earth-breath fix (single follow-up across all pieces).
- Avatar-calibrated scale.
- P2P sync wire-up (BroadcastChannel + Gun.js relay hooks present, not wired).
- Permissions inside `/brain` — first version is per-user store; collaborative
  build stays inside Virtual Hubs where membership lives in `projects.ts`.
- Combat / quests / stats — UQRC already supplies the field/forces.

## See also

- `docs/BRAIN_UNIVERSE.md` — the universe these blocks live in.
- `docs/VIRTUAL_HUB.md` — the catalog and Sims-style builder they come from.
- `src/components/brain/SurfaceApartment.tsx` — the per-piece reference.
- `src/lib/brain/uqrcPhysics.ts` — the actual game engine.
