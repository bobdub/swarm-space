/**
 * dockSite — where the village boat is moored, worked out from terrain
 * every peer already shares, so every peer finds the same spot without
 * sending anything.
 *
 * From the village island's centre we walk out along a bearing that
 * points away from the volcano (the calm, open side of the island). The
 * jetty starts where the ground drops to plank height, runs out over the
 * shallows, and ends where the water is deep enough for the boat to lie
 * alongside it. If that bearing is blocked (a long shelf, a headland of
 * noise land) we fan out 15° at a time until a bearing works.
 *
 * Everything is in Earth-local coordinates (the frame that spins with
 * the planet). All heights come from `groundElevationAt`, the same baked
 * triangles the Earth mesh draws, so the dock sits on the drawn sea.
 */

import {
  EARTH_RADIUS,
  SHARED_VILLAGE_ISLAND_ANCHOR,
  getEarthLocalSiteFrame,
  type Vec3,
} from '../earth';
import { groundElevationAt } from '../groundHeight';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from '../volcanoOrgan';

/** Walkable top of the jetty planks (m above sea level). */
export const JETTY_TOP = 0.6;
/** Jetty width (m). */
export const JETTY_WIDTH = 2.2;
/** Water depth the moored boat needs under its keel (m). */
export const BOAT_MOOR_DEPTH = 1.8;
/** Boat length (m), bow to stern. */
export const BOAT_LENGTH = 7;
/** Boat beam (m), widest point. */
export const BOAT_BEAM = 2.6;
/** Gap between the jetty edge and the boat's side (m). */
const BERTH_GAP = 0.35;
/** Sideways offset from the jetty centreline to the boat's centreline. */
export const BERTH_OFFSET = JETTY_WIDTH / 2 + BERTH_GAP + BOAT_BEAM / 2;
/** Search limits along one bearing (m of arc from the island centre). */
const SEARCH_FROM_M = 80;
const SEARCH_TO_M = 520;
const STEP_M = 1;
/** Longest jetty we will build (m). */
export const MAX_JETTY_M = 90;

export interface DockSite {
  /** Bearing used, radians clockwise from the village frame's forward. */
  bearing: number;
  /** Earth-local unit normal where the jetty meets the land. */
  jettyStart: Vec3;
  /** Earth-local unit tangent the jetty runs along (seaward), at jettyStart. */
  jettyDir: Vec3;
  /** Jetty length (m). */
  jettyLength: number;
  /** Earth-local unit normal at the jetty's seaward end. */
  jettyEnd: Vec3;
  /** Earth-local unit normal under the moored boat's centre. */
  boatCenter: Vec3;
  /** Earth-local unit tangent at boatCenter: the bow points this way (out to sea). */
  boatHeading: Vec3;
  /** Sea depth (m, positive) under the boat's bow, centre and stern. */
  boatDepths: [number, number, number];
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Point `arcM` metres along the great circle from `n` in tangent direction `t`. */
export function travel(n: Vec3, t: Vec3, arcM: number): Vec3 {
  const a = arcM / EARTH_RADIUS;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return normalize([n[0] * c + t[0] * s, n[1] * c + t[1] * s, n[2] * c + t[2] * s]);
}

/** Tangent direction at the end of `travel(n, t, arcM)`. */
export function travelTangent(n: Vec3, t: Vec3, arcM: number): Vec3 {
  const a = arcM / EARTH_RADIUS;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return normalize([t[0] * c - n[0] * s, t[1] * c - n[1] * s, t[2] * c - n[2] * s]);
}

/** Unit tangent at `n` perpendicular to `t`, on its starboard side
 *  (right of a walker facing `t` with `n` up). */
export function starboardOf(n: Vec3, t: Vec3): Vec3 {
  // right = forward × up
  return normalize([
    t[1] * n[2] - t[2] * n[1],
    t[2] * n[0] - t[0] * n[2],
    t[0] * n[1] - t[1] * n[0],
  ]);
}

function depthAt(n: Vec3): number {
  return -groundElevationAt(n);
}

/** Try one bearing; null when it gives no usable berth. */
function tryBearing(center: Vec3, fwd: Vec3, right: Vec3, bearing: number): DockSite | null {
  const cb = Math.cos(bearing);
  const sb = Math.sin(bearing);
  const dir = normalize([
    fwd[0] * cb + right[0] * sb,
    fwd[1] * cb + right[1] * sb,
    fwd[2] * cb + right[2] * sb,
  ]);

  // 1. The jetty starts at the last point (walking out) where the ground
  //    still stands at plank height or above.
  let startArc = -1;
  for (let s = SEARCH_FROM_M; s <= SEARCH_TO_M; s += STEP_M) {
    const h = groundElevationAt(travel(center, dir, s));
    if (h >= JETTY_TOP) startArc = s;
    else if (startArc >= 0 && h < 0) break; // past the beach
  }
  if (startArc < 0) return null;

  // 2. Walk on until a full boat length beside the jetty lies in water
  //    deep enough to berth.
  for (let len = 6; len <= MAX_JETTY_M; len += STEP_M) {
    const endArc = startArc + len;
    const endN = travel(center, dir, endArc);
    // Boat lies alongside the outer BOAT_LENGTH of the jetty, bow seaward.
    const boatMidAlong = endArc - BOAT_LENGTH / 2;
    const midN = travel(center, dir, boatMidAlong);
    const midT = travelTangent(center, dir, boatMidAlong);
    const boatCenter = travel(midN, starboardOf(midN, midT), BERTH_OFFSET);
    const bow = travel(boatCenter, midT, BOAT_LENGTH / 2);
    const stern = travel(boatCenter, midT, -BOAT_LENGTH / 2);
    const depths: [number, number, number] = [depthAt(bow), depthAt(boatCenter), depthAt(stern)];
    if (Math.min(...depths) < BOAT_MOOR_DEPTH) continue;
    const startN = travel(center, dir, startArc);
    return {
      bearing,
      jettyStart: startN,
      jettyDir: travelTangent(center, dir, startArc),
      jettyLength: len,
      jettyEnd: endN,
      boatCenter,
      boatHeading: normalize(sub(midT, scale(boatCenter, dot(midT, boatCenter)))),
      boatDepths: depths,
    };
  }
  return null;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

let cached: DockSite | null | undefined;

/**
 * The village dock. Deterministic: the same terrain gives the same site on
 * every peer and every run. Null only if no bearing around the island
 * gives a berth (not expected on the village island).
 */
export function getVillageDockSite(): DockSite | null {
  if (cached !== undefined) return cached;
  const frame = getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR);
  const center = frame.normal;
  const { forward: fwd, right } = frame;
  const volcano = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID).centerNormal;
  // Volcano bearing in the village tangent frame; the dock faces away.
  const vx = dot(volcano, right);
  const vz = dot(volcano, fwd);
  const away = Math.atan2(-vx, -vz);
  const STEP = (15 * Math.PI) / 180;
  let site: DockSite | null = null;
  for (let k = 0; k <= 12 && !site; k++) {
    // 0, +15°, −15°, +30°, −30° …
    const offset = k === 0 ? 0 : Math.ceil(k / 2) * STEP * (k % 2 === 1 ? 1 : -1);
    site = tryBearing(center, fwd, right, away + offset);
  }
  cached = site;
  return site;
}

export function _resetDockSiteForTest(): void {
  cached = undefined;
}
