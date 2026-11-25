/**
 * navigation — bearings, distances and the player's facing, all measured
 * against true north (Earth's spin axis) in Earth-local space, so the
 * map, the compass and the "way home" line agree with each other.
 */
import type { EarthPose, Vec3 } from './earth';
import { quatRotate } from './earth';
import { getNorthFrame, projectToMap, worldToLocalNormal, type NorthFrame } from './mapProjection';

const TAU = Math.PI * 2;

/** Wrap an angle into [0, 2π). */
export function wrapAngle(a: number): number {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** Compass bearing (radians clockwise from north) and great-circle distance (m) to `target`. */
export function bearingTo(frame: NorthFrame, target: Vec3): { bearing: number; distanceM: number } {
  const [e, n] = projectToMap(frame, target);
  return { bearing: wrapAngle(Math.atan2(e, n)), distanceM: Math.hypot(e, n) };
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Eight-wind compass point for a bearing in radians. */
export function compassPoint(bearing: number): (typeof POINTS)[number] {
  return POINTS[Math.round(wrapAngle(bearing) / (TAU / 8)) % 8];
}

/** Bearing in whole degrees, zero-padded like a real compass: 045°. */
export function formatBearing(bearing: number): string {
  const deg = Math.round((wrapAngle(bearing) * 180) / Math.PI) % 360;
  return `${String(deg).padStart(3, '0')}°`;
}

/** 640 m · 1.2 km · 12 km */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

/**
 * Which way the camera looks, as a compass bearing at the player's spot.
 * Uses the view direction flattened onto the ground; when looking almost
 * straight down it falls back to the camera's screen-up direction.
 * Returns null when no direction can be read.
 */
export function headingFromCamera(
  viewForward: Vec3,
  viewUp: Vec3,
  bodyWorldPos: Vec3,
  pose: EarthPose,
): number | null {
  const up = worldToLocalNormal(bodyWorldPos, pose);
  const frame = getNorthFrame(up);
  const flat = (v: Vec3): [number, number] => {
    const l = quatRotate(pose.invSpinQuat, v);
    return [
      l[0] * frame.east[0] + l[1] * frame.east[1] + l[2] * frame.east[2],
      l[0] * frame.north[0] + l[1] * frame.north[1] + l[2] * frame.north[2],
    ];
  };
  let [e, n] = flat(viewForward);
  if (Math.hypot(e, n) < 0.2) {
    // Looking almost straight down, screen-up points the way you face;
    // looking almost straight up it points behind you, so flip it.
    const fl = quatRotate(pose.invSpinQuat, viewForward);
    const lookingUp = fl[0] * frame.up[0] + fl[1] * frame.up[1] + fl[2] * frame.up[2] > 0;
    [e, n] = flat(viewUp);
    if (lookingUp) { e = -e; n = -n; }
  }
  if (Math.hypot(e, n) < 1e-6) return null;
  return wrapAngle(Math.atan2(e, n));
}

/**
 * Where a point that lies off a square map should be pinned on its edge:
 * the border point along the direction from the centre, inset by `insetPx`.
 */
export function edgePin(eastM: number, northM: number, sizePx: number, insetPx: number): [number, number] {
  const half = sizePx / 2 - insetPx;
  const dx = eastM;
  const dy = -northM; // canvas y grows downward
  const k = half / Math.max(Math.abs(dx), Math.abs(dy), 1e-9);
  return [sizePx / 2 + dx * k, sizePx / 2 + dy * k];
}

// ── Live facing, shared by the camera rig, the compass and the map ──────

let _heading: number | null = null;

/** Called by the camera rig every frame with the player's facing bearing. */
export function setViewHeading(bearing: number | null): void {
  _heading = bearing;
}

/** The player's facing bearing (radians clockwise from true north), or null before the first frame. */
export function getViewHeading(): number | null {
  return _heading;
}
