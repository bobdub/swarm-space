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

/** Ownership gate for a world-space point. */
export function canBuildAtWorldPoint(point: Vec3, actorId: string): PlotPermission {
  const t = worldPointToTangent(point);
  if (!t) return { ok: true };
  return canBuildAtTangent(t.tx, t.tz, actorId, { isDev: isDev(actorId) });
}
