import { ATMOSPHERE_RADIUS, EARTH_RADIUS, type EarthPose } from './earth';

type Position = readonly [number, number, number];

function smoothstep(low: number, high: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

/** Local horizon, not a global day/night flag. Uses the shared (or solo) pose. */
export function skyCadenceAt(position: Position, pose: Pick<EarthPose, 'center' | 'sun'>) {
  const rx = position[0] - pose.center[0];
  const ry = position[1] - pose.center[1];
  const rz = position[2] - pose.center[2];
  const sx = pose.sun[0] - position[0];
  const sy = pose.sun[1] - position[1];
  const sz = pose.sun[2] - position[2];
  const radius = Math.hypot(rx, ry, rz);
  const sunDistance = Math.hypot(sx, sy, sz);
  const solarElevation = radius > 0 && sunDistance > 0
    ? Math.max(-1, Math.min(1, (rx * sx + ry * sy + rz * sz) / (radius * sunDistance)))
    : 1;
  const spaceMix = Math.max(0, Math.min(1,
    (radius - EARTH_RADIUS) / Math.max(1, ATMOSPHERE_RADIUS - EARTH_RADIUS)));
  // Civil twilight (-6°) to a Sun 10° above the horizon.
  const daylight = smoothstep(Math.sin(-Math.PI / 30), Math.sin(Math.PI / 18), solarElevation);
  // Stars emerge from civil twilight to astronomical night (-18°).
  const night = 1 - smoothstep(Math.sin(-Math.PI / 10), Math.sin(-Math.PI / 30), solarElevation);
  const twilight = smoothstep(Math.sin(-Math.PI / 15), 0, solarElevation)
    * (1 - smoothstep(0, Math.sin(Math.PI / 12), solarElevation));
  return {
    solarElevation,
    spaceMix,
    daylight,
    twilight,
    atmosphereOpacity: (0.08 + 0.84 * (1 - night)) * (1 - spaceMix) + 0.02 * spaceMix,
    starOpacity: 0.85 * (night * (1 - spaceMix) + spaceMix),
  };
}