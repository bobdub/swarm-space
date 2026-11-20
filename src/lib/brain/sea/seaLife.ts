/**
 * seaLife — schools of fish and the odd shark in the open sea.
 *
 * Nothing here is sent over the wire. Every creature's home is picked from
 * terrain every peer already shares (the same `groundElevationAt` the Earth
 * mesh draws), and its path is a smooth loop on the shared clock
 * (`getEarthPoseTime()`), so every peer sees the same fish in the same place
 * at the same moment.
 *
 * Homes come from two sources:
 *   - a Fibonacci lattice over the whole planet, keeping the points that
 *     fall in water deep enough for the creature's whole loop, and
 *   - a few extra spots near the village jetty, so there is something to
 *     see (and fish for) a short row from the boat.
 *
 * A home is only kept if the water is deep enough everywhere on a ring at
 * the creature's roam radius, so a creature can never swim into the
 * shallows or onto a beach without any per-frame terrain checks.
 *
 * Everything is in Earth-local coordinates (the frame that spins with the
 * planet), like the jetty and the boats.
 */

import { EARTH_RADIUS, type Vec3 } from '../earth';
import { groundElevationAt } from '../groundHeight';
import { getVillageDockSite, starboardOf, travel } from './dockSite';

export type SeaCreatureKind = 'school' | 'shark';

export interface SeaCreature {
  id: string;
  kind: SeaCreatureKind;
  /** Earth-local unit normal at the centre of its loop. */
  home: Vec3;
  /** Unit tangents at `home` (east-ish, north-ish) spanning its loop. */
  e1: Vec3;
  e2: Vec3;
  /** Loop half-widths along e1 and e2 (m). */
  ax: number;
  az: number;
  /** Angular rates (rad/s) and phases of the loop. */
  w1: number;
  w2: number;
  p1: number;
  p2: number;
  /** Fish per school (sharks: 1). */
  size: number;
  /** Body-centre depth below sea level (m). */
  depth: number;
  /** Seed for per-fish colour and offsets. */
  seed: number;
}

export interface SeaPose {
  /** Earth-local unit normal under the creature. */
  n: Vec3;
  /** Unit tangent it is swimming along. */
  heading: Vec3;
  /** Speed (m/s). */
  speed: number;
}

/** Fish: roam radius (m), water depth they need on the whole loop (m). */
export const SCHOOL_ROAM_M = 22;
export const SCHOOL_MIN_DEPTH = 3;
/** Sharks: roam radius (m), water depth they need on the whole loop (m). */
export const SHARK_ROAM_M = 55;
export const SHARK_MIN_DEPTH = 12;
/** Fish swim this far under the surface (body centre, m). */
export const SCHOOL_DEPTH = 0.9;
/** Shark body centre (m under): the dorsal fin breaks the surface. */
export const SHARK_DEPTH = 0.45;
/** Lattice sizes over the planet. */
const SCHOOL_LATTICE = 900;
const SHARK_LATTICE = 140;
/** A school this close to the boat (m) makes the fish bite sooner. */
export const SCHOOL_NEAR_BOAT_M = 25;
/** A swimmer this close to a shark (m) is warned. */
export const SHARK_WARN_M = 12;

/** Small deterministic PRNG (mulberry32). */
function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Two unit tangents at `n`, rotated by `angle` about `n`. */
function tangents(n: Vec3, angle: number): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const d = ref[0] * n[0] + ref[1] * n[1] + ref[2] * n[2];
  const a = normalize([ref[0] - n[0] * d, ref[1] - n[1] * d, ref[2] - n[2] * d]);
  const b = starboardOf(n, a);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    normalize([a[0] * c + b[0] * s, a[1] * c + b[1] * s, a[2] * c + b[2] * s]),
    normalize([b[0] * c - a[0] * s, b[1] * c - a[1] * s, b[2] * c - a[2] * s]),
  ];
}

/** Point on the loop plane at tangent offset (x, z) metres from `home`. */
function offsetPoint(home: Vec3, e1: Vec3, e2: Vec3, x: number, z: number): Vec3 {
  const d = Math.hypot(x, z);
  if (d < 1e-9) return home;
  const t = normalize([
    (e1[0] * x + e2[0] * z) / d,
    (e1[1] * x + e2[1] * z) / d,
    (e1[2] * x + e2[2] * z) / d,
  ]);
  return travel(home, t, d);
}

/** True when the water is at least `minDepth` deep at home and all round its loop. */
function loopIsWet(home: Vec3, e1: Vec3, e2: Vec3, ax: number, az: number, minDepth: number): boolean {
  if (-groundElevationAt(home) < minDepth) return false;
  // The loop stays inside the box ±ax × ±az. Check a grid over that box,
  // a little oversized for the spread of a school.
  const N = 8;
  for (let a = 0; a <= N; a++) {
    for (let b = 0; b <= N; b++) {
      const x = ((2 * a) / N - 1) * ax * 1.2;
      const z = ((2 * b) / N - 1) * az * 1.2;
      if (-groundElevationAt(offsetPoint(home, e1, e2, x, z)) < minDepth) return false;
    }
  }
  return true;
}

function fibonacci(i: number, count: number): Vec3 {
  const y = 1 - (2 * (i + 0.5)) / count;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const th = i * 2.399963229728653; // golden angle
  return [r * Math.cos(th), y, r * Math.sin(th)];
}

function make(
  kind: SeaCreatureKind,
  id: string,
  home: Vec3,
  seed: number,
  roam: number,
  minDepth: number,
): SeaCreature | null {
  const r = rand(seed);
  const [e1, e2] = tangents(home, r() * Math.PI * 2);
  const ax = roam * (0.7 + 0.3 * r());
  const az = roam * (0.5 + 0.5 * r());
  if (!loopIsWet(home, e1, e2, ax, az, minDepth)) return null;
  // Speeds: fish about 0.6–1.2 m/s, sharks about 1–1.8 m/s. A loop with
  // half-width a and rate w moves at most a·w along that axis.
  const target = kind === 'school' ? 0.6 + 0.6 * r() : 1 + 0.8 * r();
  const w1 = target / ax;
  // A slightly different rate on the other axis makes the loop wander
  // (a slow Lissajous) instead of tracing the same ellipse forever.
  const w2 = (target / az) * (0.85 + 0.3 * r()) * (r() < 0.5 ? -1 : 1);
  return {
    id,
    kind,
    home,
    e1,
    e2,
    ax,
    az,
    w1,
    w2,
    p1: r() * Math.PI * 2,
    p2: r() * Math.PI * 2,
    size: kind === 'school' ? 8 + Math.floor(r() * 9) : 1,
    depth: kind === 'school' ? SCHOOL_DEPTH : SHARK_DEPTH,
    seed: Math.floor(r() * 2 ** 31),
  };
}

function nearVillage(
  kind: SeaCreatureKind,
  count: number,
  fromM: number,
  toM: number,
  roam: number,
  minDepth: number,
  seed: number,
): SeaCreature[] {
  const site = getVillageDockSite();
  if (!site) return [];
  const out: SeaCreature[] = [];
  const r = rand(seed);
  const side = starboardOf(site.boatCenter, site.boatHeading);
  // Try spots fanning out to sea from the berth until enough are wet.
  for (let tries = 0; tries < count * 40 && out.length < count; tries++) {
    const bearing = (r() - 0.5) * Math.PI * 1.4;
    const dist = fromM + (toM - fromM) * r();
    const dir = normalize([
      site.boatHeading[0] * Math.cos(bearing) + side[0] * Math.sin(bearing),
      site.boatHeading[1] * Math.cos(bearing) + side[1] * Math.sin(bearing),
      site.boatHeading[2] * Math.cos(bearing) + side[2] * Math.sin(bearing),
    ]);
    const home = travel(site.boatCenter, dir, dist);
    const c = make(kind, `${kind}-v${out.length}`, home, seed + 101 * tries + 7, roam, minDepth);
    if (c) out.push(c);
  }
  return out;
}

let cached: SeaCreature[] | null = null;

/** Every school and shark in the world. Deterministic and cached. */
export function getSeaLife(): SeaCreature[] {
  if (cached) return cached;
  const all: SeaCreature[] = [];
  // Near the jetty: smaller loops so fish can live in the shelf water a
  // short row out, and two sharks well out past the shelf.
  all.push(...nearVillage('school', 6, 30, 220, SCHOOL_ROAM_M * 0.6, SCHOOL_MIN_DEPTH, 0x5ea1));
  all.push(...nearVillage('shark', 2, 260, 520, SHARK_ROAM_M, SHARK_MIN_DEPTH, 0x54a2c));
  for (let i = 0; i < SCHOOL_LATTICE; i++) {
    const c = make('school', `school-${i}`, fibonacci(i, SCHOOL_LATTICE), 0x1000 + i * 2654435761, SCHOOL_ROAM_M, SCHOOL_MIN_DEPTH);
    if (c) all.push(c);
  }
  for (let i = 0; i < SHARK_LATTICE; i++) {
    // Offset the lattice so sharks don't sit on top of schools.
    const n = fibonacci(i + 0.37, SHARK_LATTICE);
    const c = make('shark', `shark-${i}`, normalize(n), 0x9000 + i * 40503, SHARK_ROAM_M, SHARK_MIN_DEPTH);
    if (c) all.push(c);
  }
  cached = all;
  return all;
}

/** Where a creature is at shared time `t` (seconds). */
export function seaPoseAt(c: SeaCreature, t: number): SeaPose {
  const a1 = c.w1 * t + c.p1;
  const a2 = c.w2 * t + c.p2;
  const x = c.ax * Math.sin(a1);
  const z = c.az * Math.sin(a2);
  const vx = c.ax * c.w1 * Math.cos(a1);
  const vz = c.az * c.w2 * Math.cos(a2);
  const n = offsetPoint(c.home, c.e1, c.e2, x, z);
  const speed = Math.hypot(vx, vz);
  // Heading: the loop's velocity, carried to `n` (the loop is a few tens
  // of metres on a 1.7 km planet, so projecting onto n's tangent plane is
  // plenty). A momentary stop keeps the last good direction via e1.
  const raw: Vec3 = speed > 1e-6
    ? [
        (c.e1[0] * vx + c.e2[0] * vz) / speed,
        (c.e1[1] * vx + c.e2[1] * vz) / speed,
        (c.e1[2] * vx + c.e2[2] * vz) / speed,
      ]
    : c.e1;
  const d = raw[0] * n[0] + raw[1] * n[1] + raw[2] * n[2];
  const heading = normalize([raw[0] - n[0] * d, raw[1] - n[1] * d, raw[2] - n[2] * d]);
  return { n, heading, speed };
}

/** Surface distance (m) between two Earth-local unit normals. */
export function arcMetres(a: Vec3, b: Vec3): number {
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * EARTH_RADIUS;
}

/** Creatures whose loop comes within `radiusM` of `n` (cheap broad phase). */
export function seaLifeNear(n: Vec3, radiusM: number, kind?: SeaCreatureKind): SeaCreature[] {
  const out: SeaCreature[] = [];
  for (const c of getSeaLife()) {
    if (kind && c.kind !== kind) continue;
    const reach = radiusM + Math.max(c.ax, c.az) * 1.05;
    if (arcMetres(n, c.home) <= reach) out.push(c);
  }
  return out;
}

/** Distance (m) from `n` to the nearest creature of `kind` at time `t`. */
export function nearestDistance(n: Vec3, t: number, kind: SeaCreatureKind, withinM: number): number {
  let best = Infinity;
  for (const c of seaLifeNear(n, withinM, kind)) {
    const d = arcMetres(n, seaPoseAt(c, t).n);
    if (d < best) best = d;
  }
  return best;
}

/** True when a school of fish is swimming within SCHOOL_NEAR_BOAT_M of `n`. */
export function schoolNear(n: Vec3, t: number): boolean {
  return nearestDistance(n, t, 'school', SCHOOL_NEAR_BOAT_M) <= SCHOOL_NEAR_BOAT_M;
}

export function _resetSeaLifeForTest(): void {
  cached = null;
}
