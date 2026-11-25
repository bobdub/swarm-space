/**
 * mapProjection — the one projection every map overlay shares.
 *
 * Everything here works in EARTH-LOCAL space (the planet's own frame,
 * before the live spin is applied), so a point on the ground always maps
 * to the same place no matter how far Earth has turned. Feed world
 * positions through `worldToLocalNormal` first.
 *
 * Projection: azimuthal equidistant around the viewer. Distance from the
 * centre of the map is true arc distance over the ground, and the
 * direction is the true compass bearing. North (toward Earth's spin axis,
 * local +Y) is up, east is right.
 */
import { EARTH_RADIUS, quatRotate, type EarthPose, type Vec3 } from './earth';

export interface NorthFrame {
  /** Earth-local outward unit normal at the viewer. */
  up: Vec3;
  /** Unit tangent pointing east (the direction Earth turns). */
  east: Vec3;
  /** Unit tangent pointing north, toward local +Y. */
  north: Vec3;
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Earth-local unit normal under a world-space position. */
export function worldToLocalNormal(worldPos: Vec3, pose: EarthPose): Vec3 {
  const d: Vec3 = [worldPos[0] - pose.center[0], worldPos[1] - pose.center[1], worldPos[2] - pose.center[2]];
  return normalize(quatRotate(pose.invSpinQuat, d));
}

/**
 * North-up tangent frame at an Earth-local normal. East = spin axis × up.
 * Right at a pole east is undefined; then the previous frame's east is
 * reused (projected onto the new tangent plane) so the map never snaps.
 */
export function getNorthFrame(up: Vec3, prev?: NorthFrame | null): NorthFrame {
  const n = normalize(up);
  // (0,1,0) × n
  let east: Vec3 = [n[2], 0, -n[0]];
  if (Math.hypot(east[0], east[2]) < 1e-3) {
    const ref: Vec3 = prev ? prev.east : [0, 0, -1];
    const k = dot(ref, n);
    east = [ref[0] - n[0] * k, ref[1] - n[1] * k, ref[2] - n[2] * k];
  }
  east = normalize(east);
  const north = normalize(cross(n, east));
  return { up: n, east, north };
}

/**
 * Project an Earth-local normal onto the map plane around `frame.up`.
 * Returns [east, north] in metres of ground distance.
 */
export function projectToMap(frame: NorthFrame, n: Vec3, radius = EARTH_RADIUS): [number, number] {
  const p = normalize(n);
  const c = Math.max(-1, Math.min(1, dot(p, frame.up)));
  const t: Vec3 = [p[0] - frame.up[0] * c, p[1] - frame.up[1] * c, p[2] - frame.up[2] * c];
  const tl = Math.hypot(t[0], t[1], t[2]);
  if (tl < 1e-12) return [0, 0];
  const dist = Math.acos(c) * radius;
  return [(dot(t, frame.east) / tl) * dist, (dot(t, frame.north) / tl) * dist];
}

/** Inverse of `projectToMap`: map metres [east, north] → Earth-local normal. */
export function unprojectFromMap(frame: NorthFrame, eastM: number, northM: number, radius = EARTH_RADIUS): Vec3 {
  const d = Math.hypot(eastM, northM);
  if (d < 1e-9) return [...frame.up];
  const theta = d / radius;
  const s = Math.sin(theta) / d;
  const c = Math.cos(theta);
  return normalize([
    frame.up[0] * c + (frame.east[0] * eastM + frame.north[0] * northM) * s,
    frame.up[1] * c + (frame.east[1] * eastM + frame.north[1] * northM) * s,
    frame.up[2] * c + (frame.east[2] * eastM + frame.north[2] * northM) * s,
  ]);
}

/** Map metres → canvas pixels for a square canvas showing ±rangeM. North is up. */
export function mapToCanvas(eastM: number, northM: number, sizePx: number, rangeM: number): [number, number] {
  const half = sizePx / 2;
  return [half + (eastM / rangeM) * half, half - (northM / rangeM) * half];
}

/** Canvas pixels → map metres. Inverse of `mapToCanvas`. */
export function canvasToMap(px: number, py: number, sizePx: number, rangeM: number): [number, number] {
  const half = sizePx / 2;
  return [((px - half) / half) * rangeM, ((half - py) / half) * rangeM];
}
