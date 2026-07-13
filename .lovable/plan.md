## Goal

Stop the avatar from walking through the bar walls at `/brain`, without changing the walls, the physics field, or anything else. Add a small, isolated avatar-scale collision layer that operates outside the UQRC field.

## Why the walls don't collide today

- `SurfaceBar.tsx` registers each wall segment as a `BuilderBlock` with `basin: SEG_BASIN = 1.4 m` via `physics.pinSupportBasin`.
- `pinSupportBasin` stamps its bowl into the UQRC field. Field resolution is `FIELD3D_N = 24` cells over `WORLD_SIZE = 12 750 m` — one cell is ~530 m. A 1.4 m basin quantises to a single cell, so all wall segments of a bar collapse into the same cell and provide no pedestrian-scale barrier.
- Fix cannot come from tightening basins: the field grid is far too coarse for wall-scale geometry, and changing it would touch physics globally (out of scope).

The fix is a dedicated avatar-vs-AABB pass that runs alongside physics but does not modify the field, other bodies, or any existing collision math.

## What changes

Everything is additive. Existing files are edited in only two well-scoped spots.

### 1. New file: `src/lib/brain/wallColliders.ts`

A tiny singleton registry of axis-aligned wall boxes expressed in **Earth-local village coordinates** (the same `rightOffset` / `forwardOffset` / `upOffset` frame every `BuilderBlock` already uses).

Public API:

```ts
export type WallColliderId = string;
export interface WallColliderSpec {
  id: WallColliderId;
  anchorPeerId: string;
  // Center in village-local coords (matches BuilderBlock offsets)
  rightOffset: number;
  forwardOffset: number;
  upOffset: number;
  // Half-extents along local right / up / forward axes
  halfRight: number;
  halfUp: number;
  halfForward: number;
}
export function addWallCollider(spec: WallColliderSpec): void;
export function removeWallCollider(id: WallColliderId): void;
export function listWallColliders(): readonly WallColliderSpec[];
```

Implementation is a plain `Map<string, WallColliderSpec>`; no physics coupling, no field writes.

### 2. New file: `src/components/brain/WallCollisionTicker.tsx`

A `null`-rendering component mounted once inside `<Canvas>` in `BrainUniverseScene.tsx`. Runs one `useFrame` **after** `physics.step` each tick and resolves collisions for the local avatar only.

Per frame:

1. `body = physics.getBody(selfId)`; skip if missing.
2. Convert `body.pos` (world) → village-local coords using the same helpers `SurfaceBar` / `BuilderBlockView` already use:
   - `pose = getEarthPose()`
   - `lf   = getEarthLocalSiteFrame(anchorPeerId)`
   - `fwdW = earthLocalToWorld(lf.forward, pose) - pose.center`
   - `rgtW = earthLocalToWorld(lf.right,   pose) - pose.center`
   - `upW  = normalise(body.pos - pose.center)` (radial up at the avatar)
   - Re-orthonormalise `{right, up, forward}` (matches `BuilderBlockView` exactly).
   - Project `body.pos - pose.center` onto `{right, up, forward}` to get `(rL, uL, fL)`.
3. Treat the avatar as a vertical capsule with `AVATAR_R = 0.35 m` and `AVATAR_H = 1.7 m`, centred at `(rL, uL, fL)`.
4. For each `WallColliderSpec` with the same `anchorPeerId`:
   - Compute the closest point on the wall AABB to the avatar centre in local coords.
   - If the horizontal separation < `AVATAR_R` **and** vertical overlap exists, compute the minimum-translation vector (MTV) in the horizontal (`right`, `forward`) plane only — walls never push you vertically.
   - Sum MTVs (resolve heaviest penetration first for stability).
5. If the MTV is non-zero:
   - Apply it to local coords: `rL += mtv.r; fL += mtv.f`.
   - Convert local → world using the same basis (`world = pose.center + rL·right + uL·up + fL·forward`) and write to `body.pos`.
   - Kill the wall-normal component of `body.vel` (in world) so the avatar slides along the wall instead of accumulating force into it. Tangential velocity is preserved.

No integration, no forces added to the physics step — this is a post-integration position correction on the local avatar body only. Remote avatars, NPCs, furniture, and every non-`self` body are untouched.

### 3. `src/components/brain/SurfaceBar.tsx` — register/unregister colliders

In the existing `useEffect` that already calls `engine.placeBlock` for every wall segment, add a paired `addWallCollider` call, and add the matching `removeWallCollider` calls to the existing cleanup. Extents come from the numbers already in the file:

- `halfRight   = seg.axis === 'x' ? seg.length / 2 : WALL_T / 2`
- `halfForward = seg.axis === 'z' ? seg.length / 2 : WALL_T / 2`
- `halfUp      = WALL_H / 2`
- `upOffset    = WALL_H / 2` (walls sit on ground, extend up to `WALL_H`)
- `rightOffset / forwardOffset` = `rightOffset + seg.rightOffset`, `forwardOffset + seg.forwardOffset` (same numbers already passed to `engine.placeBlock`).

The doorway is already a gap in `buildSegments()` (south wall skips `[-DOOR_HALF, +DOOR_HALF]`), so no doorway logic is needed — walking through the door keeps working automatically. Roof, sign, sconces, counter, stools, tables: **not** registered — they were not part of the request. Only the four wall runs (with doorway) get colliders.

### 4. `src/components/brain/BrainUniverseScene.tsx` — mount the ticker

Add `<WallCollisionTicker />` once inside `<Canvas>`, next to the other `null`-rendering tickers. Nothing else in this file changes.

## Why this is guaranteed not to break anything

- No changes to `uqrcPhysics.ts`, `field3D.ts`, `builderBlockEngine.ts`, `earth.ts`, or any `BuilderBlock` behaviour. The UQRC field, basins, causal-collide operator, and body integrator run exactly as they do today.
- No changes to any wall geometry, doorway, roof, furniture, sconces, sign, or the BarLightSwitch on the wall — `SurfaceBar` only gains one `addWallCollider` per segment inside the same `useEffect` that already loops over segments, plus a matching cleanup line.
- Uses the exact frame math already proven in `BuilderBlockView.tsx` (radial up, tangent right/forward from `getEarthLocalSiteFrame`, re-orthonormalise) so the collider frame matches where the walls actually render.
- Only the `self` body is touched; NPCs, remote avatars, and physics-owned bodies are ignored.
- Doorway is preserved because it's already absent from `buildSegments()`.
- If `WallCollisionTicker` fails to find the body, or if no colliders are registered (e.g. bar unmounted), it is a no-op.

## Files touched

- **Add** `src/lib/brain/wallColliders.ts`
- **Add** `src/components/brain/WallCollisionTicker.tsx`
- **Edit** `src/components/brain/SurfaceBar.tsx` — one `addWallCollider` inside the existing placement loop, one `removeWallCollider` inside the existing cleanup loop.
- **Edit** `src/components/brain/BrainUniverseScene.tsx` — add `<WallCollisionTicker />` once inside `<Canvas>`.

## Out of scope (explicitly not changed)

- Field resolution, basins, causal-collide.
- Roof / sign / sconces / counter / stools / tables / BarLightSwitch.
- Apartment, WetWorkHabitat, NPCs, remote avatars.
- Doorway geometry (already correct).
- Movement speed, WASD/joystick handling, sprint/bolt behaviour.

## Verification steps after build

1. `tsgo` on the 4 touched files.
2. In `/brain`, walk into each of the four walls of the bar from inside and outside — avatar stops at the wall and slides along it.
3. Walk through the south doorway — passes through unobstructed.
4. Camera and yaw feel identical to before; no jitter when brushing the wall (velocity's wall-normal component is zeroed, tangential preserved).
5. Remote avatars, NPCs, and furniture behaviour unchanged.
