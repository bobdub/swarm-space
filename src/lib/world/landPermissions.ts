/**
 * landPermissions — world-space façade over the land-plot gate.
 *
 * Every world mutation (place, move, delete, decorate, sculpt, dig)
 * routes its hit point through `canBuildAtWorldPoint` so ownership is
 * enforced in exactly one place instead of being re-derived per call
 * site. Fails OPEN on math errors — a broken frame must never brick
 * building.
 */
import {
  getEarthPose,
  getEarthLocalSiteFrame,
  worldDisplacementToEarthLocal,
  type Vec3,
} from '@/lib/brain/earth';
import { WORLD_GRID_ORIGIN_ANCHOR } from '@/lib/world/buildGrid';
import { canBuildAtTangent, type LandPlot } from '@/lib/world/landPlots';
import { isDev } from '@/lib/world/devRoles';
import { EARTH_RADIUS } from '@/lib/brain/earth';
import { sampleSurfaceLift } from '@/lib/brain/surfaceProfile';

export interface PlotPermission {
  ok: boolean;
  reason?: string;
  plot?: LandPlot;
}

/** Project a world point into the lattice-origin tangent frame. */
export function worldPointToTangent(point: Vec3): { tx: number; tz: number } | null {
  try {
    const pose = getEarthPose();
    const disp: Vec3 = [
      point[0] - pose.center[0],
      point[1] - pose.center[1],
      point[2] - pose.center[2],
    ];
    const local = worldDisplacementToEarthLocal(disp, pose);
    const ref = getEarthLocalSiteFrame(WORLD_GRID_ORIGIN_ANCHOR);
    const tx = local[0] * ref.right[0] + local[1] * ref.right[1] + local[2] * ref.right[2];
    const tz = local[0] * ref.forward[0] + local[1] * ref.forward[1] + local[2] * ref.forward[2];
    if (!Number.isFinite(tx) || !Number.isFinite(tz)) return null;
    return { tx, tz };
  } catch {
    return null;
  }
}

/**
 * Inverse of `worldPointToTangent`: the Earth-local point on the visible
 * ground (plus `extraLift` m) whose tangent coordinates are (tx, tz).
 * Anything drawn on the land grid goes through this so the block a
 * player sees is exactly the block that ownership and permission use,
 * however far from the lattice origin it is.
 */
export function tangentToSurfaceLocal(
  tx: number,
  tz: number,
  extraLift = 0,
  ref: { normal: Vec3; right: Vec3; forward: Vec3 } = getEarthLocalSiteFrame(WORLD_GRID_ORIGIN_ANCHOR),
): Vec3 {
  let r = EARTH_RADIUS;
  let un: Vec3 = ref.normal;
  // The radius depends on the terrain at the point, so settle it twice.
  for (let i = 0; i < 3; i++) {
    const a = Math.max(-1, Math.min(1, tx / r));
    const b = Math.max(-1, Math.min(1, tz / r));
    const c = Math.sqrt(Math.max(0, 1 - a * a - b * b));
    un = [
      ref.normal[0] * c + ref.right[0] * a + ref.forward[0] * b,
      ref.normal[1] * c + ref.right[1] * a + ref.forward[1] * b,
      ref.normal[2] * c + ref.right[2] * a + ref.forward[2] * b,
    ];
    r = EARTH_RADIUS + sampleSurfaceLift(un) + extraLift;
  }
  return [un[0] * r, un[1] * r, un[2] * r];
}

/** Ownership gate for a world-space point. */
export function canBuildAtWorldPoint(point: Vec3, actorId: string): PlotPermission {
  const t = worldPointToTangent(point);
  if (!t) return { ok: true };
  return canBuildAtTangent(t.tx, t.tz, actorId, { isDev: isDev(actorId) });
}
