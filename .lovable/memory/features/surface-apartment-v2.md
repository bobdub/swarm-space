---
name: SurfaceApartmentV2 (walkable interior)
description: Larger walkable apartment (16×12×2.7 m, 4 rooms + hallway) mounted next to v1 for A/B testing. Swap and remove v1 after user approval.
type: feature
---

`src/components/brain/SurfaceApartmentV2.tsx` is the next-generation apartment.

**Layout:** 16 m × 12 m footprint, 2.7 m ceilings. Central east-west hallway
(`z ∈ [-1.0, 1.0]`) with four rooms: living (SW), kitchen (SE), bedroom (NW),
bathroom (NE). Front door faces -z (south); back door faces +z (north).

**Walls are real openings, not invisible cuts.** A `WallSegments` helper
takes a `WallRun` describing one continuous wall and an array of
`gaps = [{ start, end, lintelHeight, sillHeight }]`, then renders solid
segments around each gap plus the lintel/sill above and below. Doors get
no sill; windows get both lintel and sill. Players can walk through gaps
because the apartment has no collider (same as v1).

**Physics contract** matches `SurfaceApartment` v1 verbatim — single
`'piece'` body, `pinPiece(worldPos, 1.0)`, render reads pose every frame
from physics, re-projects to `FEET_SHELL_RADIUS`, derives orientation
from `getEarthLocalSiteFrame(anchorPeerId)`. Anchored at
`FORWARD_OFFSET = 45 m`, `RIGHT_OFFSET = 30 m` so it doesn't overlap v1
during A/B testing.

**How to apply:** When the user approves V2, swap the two import lines
in `BrainUniverseScene.tsx` (remove `<SurfaceApartment .../>`, drop
`RIGHT_OFFSET` to 0 in V2 if you want it to take v1's spot, then delete
`SurfaceApartment.tsx` and its `apartmentTrackerState` consumers).

**Known limitation:** still no collider — same as v1. Earth-shell
"breathing" can pass through the floor. Future work, not blocking.
