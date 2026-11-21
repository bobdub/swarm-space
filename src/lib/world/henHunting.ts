/**
 * henHunting — a knife swing near a free-range hen catches her.
 *
 * The hen's walk is shared without sending anything (`brain/land/chickens`).
 * A catch is recorded as one `hen-caught` nature event, which every peer
 * hears, so the hen vanishes for everyone and comes back for everyone
 * `HEN_RESPAWN_MS` later. The Food goes to the hunter only, like fruit,
 * honey and fish.
 */
import {
  EARTH_RADIUS,
  getEarthPose,
  getEarthPoseTime,
  quatRotate,
  worldPosToLocalNormal,
  type Vec3,
} from '@/lib/brain/earth';
import { groundElevationAt } from '@/lib/brain/groundHeight';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import {
  FOOD_PER_HEN,
  HEN_CATCH_REACH_M,
  HEN_EVENT_ANCHOR,
  HEN_RESPAWN_MS,
  nearestCatchableHen,
} from '@/lib/brain/land/chickens';
import { recordHarvestForResource } from '@/lib/remix/harvestedInventory';
import { recordNatureEvent } from '@/lib/world/natureEventsStore';
import { emitImpactFx, emitSwingFx } from '@/lib/world/swingFxBus';
import { swingSuccess } from '@/lib/world/swingFeedback';

/** Only a knife hunts hens. */
export function huntsHens(toolPrefabId: string): boolean {
  return toolPrefabId.startsWith('tool_knife');
}

/**
 * If a hen is within reach of the player, catch her: record the shared
 * event, pay out Food and show the strike. Returns false (and does
 * nothing) when no hen is close enough, so the swing goes on as usual.
 */
export function tryCatchNearbyHen(toolPrefabId: string, selfId?: string, now = Date.now()): boolean {
  if (!selfId || !huntsHens(toolPrefabId)) return false;
  const body = getBrainPhysics().getBody(selfId);
  if (!body) return false;
  const pose = getEarthPose();
  const selfN = worldPosToLocalNormal(body.pos, pose);
  // Standing on a boat or a roof doesn't reach a hen on the ground.
  const r = Math.hypot(body.pos[0] - pose.center[0], body.pos[1] - pose.center[1], body.pos[2] - pose.center[2]);
  if (r - EARTH_RADIUS - groundElevationAt(selfN) > 2.5) return false;
  const found = nearestCatchableHen(selfN, getEarthPoseTime(), now, HEN_CATCH_REACH_M);
  if (!found) return false;

  recordNatureEvent('hen-caught', found.hen.id, HEN_EVENT_ANCHOR, 0, 0, now);
  recordHarvestForResource('food', FOOD_PER_HEN);

  const n = found.pose.n;
  const lift = EARTH_RADIUS + groundElevationAt(n) + 0.3;
  const rot = quatRotate(pose.spinQuat, [n[0] * lift, n[1] * lift, n[2] * lift]);
  const point: Vec3 = [pose.center[0] + rot[0], pose.center[1] + rot[1], pose.center[2] + rot[2]];
  const up = quatRotate(pose.spinQuat, n);
  const prefab = getPrefab(toolPrefabId);
  const color = prefab?.color ?? '#b8b2a7';
  emitSwingFx({ variant: 'swing', point, up, color, radius: 1.1, intensity: 0.4 });
  emitImpactFx({ point, up, color: '#f4efe4', radius: 0.9, intensity: 0.4, label: 'caught', success: true, material: 'flora' });
  const mins = Math.round(HEN_RESPAWN_MS / 60_000);
  swingSuccess(
    toolPrefabId,
    prefab?.label ?? 'Stone Knife',
    `Caught a chicken · +${FOOD_PER_HEN} Food. Another hen will join the flock in ${mins} minutes.`,
  );
  return true;
}
