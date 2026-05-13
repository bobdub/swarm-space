/**
 * placementController — Phase 5 World Tools.
 *
 * Converts a world-space pointer hit on Earth into an Earth-local site
 * frame, registers a synthetic anchor id, then routes through the
 * existing `BuilderBlockEngine` so all downstream invariants (UQRC body,
 * support basin, tick re-stamping) stay intact. Emits a `world.mutation`
 * scaffold-bus event so labour credit + sub-Q telemetry flow through the
 * shared bus exactly as sculpting does.
 */
import {
  EARTH_RADIUS,
  getEarthPose,
  registerLocalSiteFrame,
  quatRotate,
  type Vec3,
} from '@/lib/brain/earth';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';
import { emitWorldMutation } from '@/lib/world/world.bus';

export interface PlaceAtHitInput {
  hitPoint: Vec3;       // world-space click on Earth
  prefabId: string;     // catalog id (built-in or minted)
  actorId: string;      // local peer id
  yaw?: number;
  /** Stable id; if omitted, derived from prefab + grid-snapped hit. */
  placementId?: string;
}

function gridKey(p: Vec3, step = 0.25): string {
  return [p[0], p[1], p[2]]
    .map((v) => Math.round(v / step))
    .join(',');
}

/** Derive an Earth-local frame at a world hit and register a synthetic anchor. */
export function frameForHit(hitPoint: Vec3, anchorId: string): void {
  const pose = getEarthPose();
  const dx = hitPoint[0] - pose.center[0];
  const dy = hitPoint[1] - pose.center[1];
  const dz = hitPoint[2] - pose.center[2];
  const r = Math.hypot(dx, dy, dz) || 1;
  // Un-spin to Earth-local space.
  const localUnit = quatRotate(pose.invSpinQuat, [dx / r, dy / r, dz / r]);
  const normal: Vec3 = [localUnit[0], localUnit[1], localUnit[2]];
  const ref: Vec3 = Math.abs(normal[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  let rx = ref[1] * normal[2] - ref[2] * normal[1];
  let ry = ref[2] * normal[0] - ref[0] * normal[2];
  let rz = ref[0] * normal[1] - ref[1] * normal[0];
  const rn = Math.hypot(rx, ry, rz) || 1;
  rx /= rn; ry /= rn; rz /= rn;
  const fx = normal[1] * rz - normal[2] * ry;
  const fy = normal[2] * rx - normal[0] * rz;
  const fz = normal[0] * ry - normal[1] * rx;
  registerLocalSiteFrame(anchorId, normal, [fx, fy, fz], [rx, ry, rz]);
}

export interface PlacedHandle {
  placementId: string;
  anchorId: string;
  prefabId: string;
  actorId: string;
  hitPoint: Vec3;
  yaw: number;
  createdAt: number;
}

/**
 * Place a prefab at a world hit point. Caller is responsible for
 * persisting/gossiping the returned handle (see worldPlacementsStore).
 */
export function placePrefabAtHit(input: PlaceAtHitInput): PlacedHandle | null {
  const prefab = getPrefab(input.prefabId);
  if (!prefab) {
    console.warn('[placement] unknown prefab', input.prefabId);
    return null;
  }
  const placementId =
    input.placementId ?? `place:${input.prefabId}:${gridKey(input.hitPoint)}:${Date.now().toString(36)}`;
  const anchorId = `anchor:${placementId}`;
  frameForHit(input.hitPoint, anchorId);

  const block = getBuilderBlockEngine().placeBlock({
    id: placementId,
    kind: prefab.id,
    anchorPeerId: anchorId,
    rightOffset: 0,
    forwardOffset: 0,
    yaw: input.yaw ?? 0,
    mass: prefab.mass,
    basin: prefab.basin,
    meta: { prefabId: prefab.id, placedBy: input.actorId, hitPoint: input.hitPoint },
  });

  // Labour weight for placement is small but non-zero — credits the
  // placer through coin.bus' world.mutation subscription.
  emitWorldMutation({
    actorId: input.actorId,
    targetKey: block.bodyId,
    effectiveCut: 0,
    resistance: 0,
    laborWeight: Math.max(0.01, prefab.mass * 0.01),
  });

  return {
    placementId,
    anchorId,
    prefabId: input.prefabId,
    actorId: input.actorId,
    hitPoint: input.hitPoint,
    yaw: input.yaw ?? 0,
    createdAt: Date.now(),
  };
}