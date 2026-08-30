/**
 * seating — put the avatar physically on a stool.
 *
 * Taking a seat is not just a camera tweak: the local body is teleported
 * onto the stool that belongs to your seat index, so every other peer
 * sees you sitting at the table through the normal pose broadcast.
 */

import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { getEarthPose, worldDisplacementToEarthLocal } from '@/lib/brain/earth';
import { pubSeatWorldPos } from '@/lib/world/pubAnchors';
import { sitDown, standUp } from './seatStore';

/** Hard-place a body, keeping the interpolation tracks in register. */
export function teleportBody(id: string, world: [number, number, number]): boolean {
  const body = getBrainPhysics().getBody(id);
  if (!body) return false;
  body.pos = [world[0], world[1], world[2]];
  body.prevPos = [world[0], world[1], world[2]];
  body.vel = [0, 0, 0];
  const pose = getEarthPose();
  const local = worldDisplacementToEarthLocal(
    [world[0] - pose.center[0], world[1] - pose.center[1], world[2] - pose.center[2]],
    pose,
  );
  body.local = [local[0], local[1], local[2]];
  body.prevLocal = [local[0], local[1], local[2]];
  return true;
}

/**
 * Move the local avatar onto the stool for `index` at `tableId` and
 * apply the seated camera pose. Falls back to the camera-only lift when
 * no stool is registered yet.
 */
export function takeSeatAt(tableId: string, index: number, selfId: string): boolean {
  const target = pubSeatWorldPos(tableId, index);
  let placed = false;
  if (target && selfId) placed = teleportBody(selfId, target);
  sitDown(0.45, -0.35);
  return placed;
}

export function leaveSeat(): void {
  standUp();
}
