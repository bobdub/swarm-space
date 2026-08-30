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
 * While seated the body is PINNED to the stool every frame. Without the
 * pin the support basin and residual velocity slide the avatar off the
 * stool within a second or two, dropping the view under the tabletop.
 * Any movement intent releases the pin so the player can just walk away.
 */
let pin: { tableId: string; index: number; selfId: string } | null = null;
let raf = 0;

function pinLoop() {
  raf = 0;
  if (!pin) return;
  const physics = getBrainPhysics();
  const intent = physics.getIntent(pin.selfId);
  // Ignore controller dead-zone noise. Only a deliberate movement input
  // releases the stool pin; an idle avatar must remain visibly seated.
  if (intent && (Math.abs(intent.fwd) > 0.2 || Math.abs(intent.right) > 0.2)) {
    leaveSeat();
    return;
  }
  const target = pubSeatWorldPos(pin.tableId, pin.index);
  if (target) {
    teleportBody(pin.selfId, target);
    physics.setIntent(pin.selfId, { fwd: 0, right: 0, yaw: intent?.yaw ?? 0, basis: intent?.basis });
  }
  raf = requestAnimationFrame(pinLoop);
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
  if (placed) {
    pin = { tableId, index, selfId };
    if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(pinLoop);
  }
  return placed;
}

export function isSeated(): boolean {
  return pin !== null;
}

export function leaveSeat(): void {
  pin = null;
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  standUp();
}

