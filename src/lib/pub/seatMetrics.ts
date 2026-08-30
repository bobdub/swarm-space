/**
 * seatMetrics — geometry read-outs shared by the seat debug overlay and
 * the automated two-peer sync test.
 *
 * Everything here is a pure function of world positions, so the test can
 * assert exactly what the overlay draws.
 */

import {
  EARTH_RADIUS,
  EYE_LIFT,
  HUMAN_HEIGHT,
  getEarthPose,
  worldDisplacementToEarthLocal,
} from '@/lib/brain/earth';
import { sampleSurfaceLift } from '@/lib/brain/surfaceProfile';
import { getBuilderBlockEngine, blockWorldPos } from '@/lib/brain/builderBlockEngine';
import { listPubAnchors } from '@/lib/world/pubAnchors';

/** Height of the local rendered ground (above the analytic shell) under `world`. */
export function groundRadiusAt(world: [number, number, number]): number {
  const pose = getEarthPose();
  const disp: [number, number, number] = [
    world[0] - pose.center[0],
    world[1] - pose.center[1],
    world[2] - pose.center[2],
  ];
  const local = worldDisplacementToEarthLocal(disp, pose);
  const len = Math.hypot(local[0], local[1], local[2]) || 1;
  const lift = sampleSurfaceLift([local[0] / len, local[1] / len, local[2] / len]);
  return EARTH_RADIUS + lift;
}

/** Body-centre height above the local ground, in metres. */
export function baseHeight(world: [number, number, number]): number {
  const pose = getEarthPose();
  const r = Math.hypot(
    world[0] - pose.center[0],
    world[1] - pose.center[1],
    world[2] - pose.center[2],
  );
  return r - groundRadiusAt(world);
}

/** Metres the avatar's feet are BELOW the floor (0 = clean contact). */
export function floorPenetration(world: [number, number, number]): number {
  return Math.max(0, HUMAN_HEIGHT / 2 - baseHeight(world));
}

/** Eye height above the local ground for an avatar at `world`. */
export function eyeHeight(world: [number, number, number], seatLift = 0): number {
  return baseHeight(world) + EYE_LIFT + seatLift;
}

/** Height of a pub table's playing surface above the local ground. */
export function tableTopHeight(tableId: string): number | null {
  const anchor = listPubAnchors().find((a) => a.tableId === tableId);
  if (!anchor) return null;
  const block = getBuilderBlockEngine().getBlock(anchor.bodyId);
  if (!block) return null;
  const wp = blockWorldPos(block);
  const h = (block.meta?.height as number) ?? 0.9;
  return baseHeight(wp) + h / 2;
}

/**
 * Can an avatar at `world` (optionally seated, adding `seatLift`) look
 * DOWN onto a surface at `topHeight`? True when the eye clears the
 * surface with a little margin so the felt is actually readable.
 */
export function seesTableTop(
  world: [number, number, number],
  topHeight: number,
  seatLift = 0,
  margin = 0.25,
): boolean {
  return eyeHeight(world, seatLift) >= topHeight + margin;
}
