import type { Vec3 } from './earth';

/** Carry a heading onto the current tangent plane without an anchor singularity. */
export function surfaceHeading(up: Vec3, previous: Vec3, fallback: Vec3): Vec3 {
  const project = (axis: Vec3): Vec3 => {
    const dot = axis[0] * up[0] + axis[1] * up[1] + axis[2] * up[2];
    return [axis[0] - dot * up[0], axis[1] - dot * up[1], axis[2] - dot * up[2]];
  };
  let forward = project(previous);
  if (Math.hypot(...forward) < 1e-6) forward = project(fallback);
  if (Math.hypot(...forward) < 1e-6) forward = project(Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  const length = Math.hypot(...forward);
  return [forward[0] / length, forward[1] / length, forward[2] / length];
}