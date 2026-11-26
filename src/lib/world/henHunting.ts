/**
 * henHunting — a knife swing near a free-range hen catches her.
 *
 * The hen's walk is shared without sending anything (`brain/land/chickens`).
 * A catch is recorded as one `hen-caught` nature event, which every peer
 * hears, so the bird vanishes for everyone; a hen of the flock then lays an
 * egg that hatches and grows into a replacement (see `chickens.ts`). The Food (or Egg) goes to the hunter only, like fruit,
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
  EGG_LAY_MS,
  NEST_REACH_M,
  nearestNestEgg,
  HEN_CATCH_REACH_M,
  HEN_EVENT_ANCHOR,
  HEN_RESPAWN_MS,
  isHenAway,
  nearestCatchableHen,
  roosterOf,
} from '@/lib/brain/land/chickens';
import { recordPlayerHarvest } from '@/lib/world/playerHarvest';
import { recordNatureEvent } from '@/lib/world/natureEventsStore';
import { emitImpactFx, emitSwingFx } from '@/lib/world/swingFxBus';
import { swingSuccess } from '@/lib/world/swingFeedback';

/** Eggs a player takes from a nest at once. */
export const EGGS_PER_TAKE = 1;
/** Chickens a player gets for catching a hen or rooster. */
export const CHICKENS_PER_CATCH = 1;

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
  // A caught bird is a Chicken (its own good, sold at the Trading Stand).
  recordPlayerHarvest('chicken', CHICKENS_PER_CATCH);

  const n = found.pose.n;
  const lift = EARTH_RADIUS + groundElevationAt(n) + 0.3;
  const rot = quatRotate(pose.spinQuat, [n[0] * lift, n[1] * lift, n[2] * lift]);
  const point: Vec3 = [pose.center[0] + rot[0], pose.center[1] + rot[1], pose.center[2] + rot[2]];
  const up = quatRotate(pose.spinQuat, n);
  const prefab = getPrefab(toolPrefabId);
  const color = prefab?.color ?? '#b8b2a7';
  emitSwingFx({ variant: 'swing', point, up, color, radius: 1.1, intensity: 0.4 });
  emitImpactFx({ point, up, color: '#f4efe4', radius: 0.9, intensity: 0.4, label: 'caught', success: true, material: 'flora' });
  const layMins = Math.round(EGG_LAY_MS / 60_000);
  const mins = Math.round(HEN_RESPAWN_MS / 60_000);
  const rooster = roosterOf(found.hen.flock);
  const noRooster = !found.hen.rooster && rooster !== undefined && isHenAway(rooster.id, now);
  const next = found.hen.rooster
    ? `A hen will lay an egg in the nest in ${layMins} minutes; a new rooster grows up in about ${mins}.`
    : noRooster
      ? 'The flock has no rooster right now, so the hens will lay once a new one has grown up.'
      : `A hen will lay an egg in the nest in ${layMins} minutes; the chick is grown in about ${mins}.`;
  swingSuccess(
    toolPrefabId,
    prefab?.label ?? 'Stone Knife',
    `Caught a ${found.hen.rooster ? 'rooster' : 'hen'} · +${CHICKENS_PER_CATCH} Chicken. ${next}`,
  );
  return true;
}

/**
 * If the player stands at a flock's nest with an egg in it, take the
 * oldest egg for Food. Any held tool will do: it is a hand's work. The
 * take is shared, so the egg is gone from the nest for everyone and will
 * not hatch. Returns false when there is no egg within reach.
 */
export function tryTakeNestEgg(toolPrefabId: string, selfId?: string, now = Date.now()): boolean {
  if (!selfId) return false;
  const body = getBrainPhysics().getBody(selfId);
  if (!body) return false;
  const pose = getEarthPose();
  const selfN = worldPosToLocalNormal(body.pos, pose);
  const r = Math.hypot(body.pos[0] - pose.center[0], body.pos[1] - pose.center[1], body.pos[2] - pose.center[2]);
  if (r - EARTH_RADIUS - groundElevationAt(selfN) > 2.5) return false;
  const found = nearestNestEgg(selfN, now, NEST_REACH_M);
  if (!found) return false;

  recordNatureEvent('egg-taken', found.egg.id, HEN_EVENT_ANCHOR, 0, 0, now);
  // An egg is its own good (sold at the Trading Stand), not Food.
  recordPlayerHarvest('egg', EGGS_PER_TAKE);

  const n = found.egg.mother.nest;
  const lift = EARTH_RADIUS + groundElevationAt(n) + 0.15;
  const rot = quatRotate(pose.spinQuat, [n[0] * lift, n[1] * lift, n[2] * lift]);
  const point: Vec3 = [pose.center[0] + rot[0], pose.center[1] + rot[1], pose.center[2] + rot[2]];
  const up = quatRotate(pose.spinQuat, n);
  emitImpactFx({ point, up, color: '#f4ecdc', radius: 0.6, intensity: 0.2, label: 'egg', success: true, material: 'flora' });
  const prefab = getPrefab(toolPrefabId);
  swingSuccess(toolPrefabId, prefab?.label ?? 'Nest', `Took an egg from the nest · +${EGGS_PER_TAKE} Egg.`);
  return true;
}
