/**
 * Sharing avatar positions between devices.
 *
 * Earth orbits and spins, so a point in world space is only right for the
 * instant it was measured: by the time another device applies it, the ground
 * under it has moved on (about 3.5 m/s at the surface), and two devices whose
 * clocks differ by a few seconds disagree by tens of metres. Positions are
 * therefore sent relative to Earth's centre in Earth's own spinning frame,
 * which names the same spot on the ground on every device, and turned back
 * into world space with the receiver's own Earth pose.
 */
import {
  earthLocalToWorld,
  worldDisplacementToEarthLocal,
  type EarthPose,
} from './earth';

export type Vec3 = [number, number, number];

/** World + Earth-local copies of our own body position, ready to broadcast. */
export function encodeSelfPosition(world: Vec3, pose: EarthPose): { position: Vec3; local: Vec3 } {
  const local = worldDisplacementToEarthLocal(
    [world[0] - pose.center[0], world[1] - pose.center[1], world[2] - pose.center[2]],
    pose,
  );
  return { position: [world[0], world[1], world[2]], local };
}

/**
 * Where a peer's avatar is in our world right now. Prefers the Earth-local
 * point; falls back to the raw world point from peers on older builds.
 */
export function resolvePeerWorldPosition(
  presence: { position?: Vec3; local?: Vec3 },
  pose: EarthPose,
): Vec3 | null {
  if (presence.local) return earthLocalToWorld(presence.local, pose);
  if (presence.position) return [presence.position[0], presence.position[1], presence.position[2]];
  return null;
}

/** Earth-local distance between two broadcasts: how far the player really walked. */
export function localDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
