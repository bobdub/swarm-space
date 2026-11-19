import { HUMAN_HEIGHT, worldDisplacementToEarthLocal, type EarthPose } from './earth';
import { feetRadiusAt } from './groundHeight';

type Vec3 = [number, number, number];

/** Capture remote positions once in the frame that received them, not on every draw. */
export function avatarLocalTarget(position: Vec3, pose: EarthPose, pinned: boolean, stale: boolean): Vec3 {
  const local = worldDisplacementToEarthLocal([
    position[0] - pose.center[0], position[1] - pose.center[1], position[2] - pose.center[2],
  ], pose);
  if (pinned) return local;
  const length = Math.hypot(...local) || 1;
  const normal: Vec3 = [local[0] / length, local[1] / length, local[2] / length];
  const feet = feetRadiusAt(normal);
  const broadcastFeet = length - HUMAN_HEIGHT / 2;
  const radius = (!stale && broadcastFeet - feet > 0.3 ? broadcastFeet : feet) + HUMAN_HEIGHT / 2;
  return [normal[0] * radius, normal[1] * radius, normal[2] * radius];
}

/** Same damping at every refresh rate; self and seated poses are authoritative. */
export function avatarTrackingAlpha(delta: number, snap: boolean): number {
  return snap ? 1 : 1 - Math.exp(-12 * Math.max(0, Math.min(delta, 0.05)));
}