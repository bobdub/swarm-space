/**
 * chickens — free-range hens wandering the land, for hunting with a knife.
 *
 * Like the fish and sharks at sea (`sea/seaLife.ts`), where a hen is at any
 * moment is a pure function of terrain every peer already shares and the
 * shared clock, so nothing about her walk is sent over the wire. Each hen
 * walks a slow, wandering loop around her flock's home: a few steps, then a
 * pause to peck, then a few more.
 *
 * The only thing peers tell each other is that a hen was caught: one small
 * `hen-caught` nature event (see `world/natureEventsStore`). Every peer
 * hides that hen until `HEN_RESPAWN_MS` after the catch, then she is back
 * on her loop, so the land never runs out of chickens.
 *
 * Homes come from two sources:
 *   - a few flocks round the village, a short walk from where everyone
 *     arrives, and
 *   - a Fibonacci lattice over the whole planet, keeping the points whose
 *     whole loop is on dry, gentle ground away from the volcano.
 *
 * Everything is in Earth-local coordinates (the frame that spins with the
 * planet), like the jetty, boats and sea life.
 */

import { SHARED_VILLAGE_ISLAND_ANCHOR, getEarthLocalSiteFrame, type Vec3 } from '../earth';
import { groundElevationAt } from '../groundHeight';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from '../volcanoOrgan';
import { starboardOf, travel } from '../sea/dockSite';
import { arcMetres } from '../sea/seaLife';
import { listNatureEvents, subscribeNatureEvents } from '@/lib/world/natureEventsStore';

/** Food a caught hen gives. */
export const FOOD_PER_HEN = 3;
/** How long a caught hen is gone before she is back with her flock (ms). */
export const HEN_RESPAWN_MS = 10 * 60_000;
/** How close (m) a knife has to get to a hen to catch her. */
export const HEN_CATCH_REACH_M = 1.8;
/** Biome anchor stamped on hen events (keeps them apart from tree events). */
export const HEN_EVENT_ANCHOR = 'chickens';

/** A hen wanders this far (m) from her own centre, at most. */
const HEN_ROAM_M = 6;
/** Hens in a flock live within this far (m) of the flock's home. */
const FLOCK_SPREAD_M = 4;
/** Lowest ground (m above sea level) on a hen's loop: no beaches, no wading. */
export const HEN_MIN_GROUND = 0.9;
/** Highest ground (m) a flock lives on, and the most rise across a loop (m). */
const HEN_MAX_GROUND = 45;
const HEN_MAX_RISE = 5;
/** Flocks keep this far (m) clear of the volcano's foot. */
const VOLCANO_CLEAR_M = 25;
/** Village flocks: count, ring (m from the village centre). */
const VILLAGE_FLOCKS = 5;
const VILLAGE_FROM_M = 28;
const VILLAGE_TO_M = 150;
/** Lattice size over the planet (most points fall in the sea). */
const FLOCK_LATTICE = 420;
/** Walking: one step-and-peck cycle (s), and the walking part of it. */
const CYCLE_S = 7;

export interface Hen {
  /** Shared id, also the body id on catch events: `hen:<flock>-<i>`. */
  id: string;
  flock: string;
  /** Earth-local unit normal at the centre of her loop. */
  home: Vec3;
  e1: Vec3;
  e2: Vec3;
  ax: number;
  az: number;
  w1: number;
  w2: number;
  p1: number;
  p2: number;
  /** Seconds of each cycle spent walking (the rest is pecking). */
  walkS: number;
  /** Cycle offset (s), so a flock does not stop and start in step. */
  offset: number;
  /** 0 white, 1 brown, 2 black, 3 speckled grey. */
  plumage: number;
  /** Body scale (about 0.85 – 1.15). */
  scale: number;
}

export interface HenPose {
  /** Earth-local unit normal under her feet. */
  n: Vec3;
  /** Unit tangent she faces. */
  heading: Vec3;
  /** True while she has stopped to peck. */
  pecking: boolean;
  /** 0..1 through the current walk or peck, for the animation. */
  phase: number;
}

/** Small deterministic PRNG (mulberry32), as in seaLife. */
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

function fibonacci(i: number, count: number): Vec3 {
  const y = 1 - (2 * (i + 0.5)) / count;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const th = i * 2.399963229728653;
  return [r * Math.cos(th), y, r * Math.sin(th)];
}

let volcano: { n: Vec3; clearM: number } | null = null;
function volcanoGuard(): { n: Vec3; clearM: number } {
  if (!volcano) {
    const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
    volcano = { n: organ.centerNormal, clearM: organ.baseRadius + VOLCANO_CLEAR_M };
  }
  return volcano;
}

/** True when the whole flock area round `home` is dry, gentle land. */
function flockGroundOk(home: Vec3): boolean {
  const v = volcanoGuard();
  if (arcMetres(home, v.n) < v.clearM) return false;
  const [e1, e2] = tangents(home, 0);
  const reach = (HEN_ROAM_M + FLOCK_SPREAD_M) * 1.15;
  const N = 6;
  let lo = Infinity;
  let hi = -Infinity;
  for (let a = 0; a <= N; a++) {
    for (let b = 0; b <= N; b++) {
      const x = ((2 * a) / N - 1) * reach;
      const z = ((2 * b) / N - 1) * reach;
      const g = groundElevationAt(offsetPoint(home, e1, e2, x, z));
      if (g < HEN_MIN_GROUND || g > HEN_MAX_GROUND) return false;
      if (g < lo) lo = g;
      if (g > hi) hi = g;
    }
  }
  return hi - lo <= HEN_MAX_RISE;
}

function makeFlock(flock: string, home: Vec3, seed: number, out: Hen[]): boolean {
  if (!flockGroundOk(home)) return false;
  const r = rand(seed);
  const size = 3 + Math.floor(r() * 4); // 3–6 hens
  const [f1, f2] = tangents(home, r() * Math.PI * 2);
  const plumageBase = Math.floor(r() * 4);
  for (let i = 0; i < size; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * FLOCK_SPREAD_M;
    const centre = offsetPoint(home, f1, f2, Math.cos(a) * d, Math.sin(a) * d);
    const [e1, e2] = tangents(centre, r() * Math.PI * 2);
    const ax = HEN_ROAM_M * (0.5 + 0.5 * r());
    const az = HEN_ROAM_M * (0.4 + 0.6 * r());
    // Walking pace about 0.35–0.6 m/s while moving.
    const pace = 0.35 + 0.25 * r();
    const w1 = pace / ax;
    const w2 = (pace / az) * (0.8 + 0.4 * r()) * (r() < 0.5 ? -1 : 1);
    out.push({
      id: `hen:${flock}-${i}`,
      flock,
      home: centre,
      e1,
      e2,
      ax,
      az,
      w1,
      w2,
      p1: r() * Math.PI * 2,
      p2: r() * Math.PI * 2,
      walkS: CYCLE_S * (0.4 + 0.3 * r()),
      offset: r() * CYCLE_S * 10,
      // Mostly the flock's colour, the odd one different.
      plumage: r() < 0.75 ? plumageBase : Math.floor(r() * 4),
      scale: 0.85 + 0.3 * r(),
    });
  }
  return true;
}

let cached: Hen[] | null = null;

/** Every hen in the world. Deterministic and cached. */
export function getHens(): Hen[] {
  if (cached) return cached;
  const all: Hen[] = [];
  // Round the village, so the first hens are a short walk from spawn.
  const site = getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR);
  const r = rand(0xc41c);
  let made = 0;
  for (let tries = 0; tries < VILLAGE_FLOCKS * 30 && made < VILLAGE_FLOCKS; tries++) {
    const bearing = r() * Math.PI * 2;
    const dist = VILLAGE_FROM_M + (VILLAGE_TO_M - VILLAGE_FROM_M) * r();
    const dir = normalize([
      site.forward[0] * Math.cos(bearing) + site.right[0] * Math.sin(bearing),
      site.forward[1] * Math.cos(bearing) + site.right[1] * Math.sin(bearing),
      site.forward[2] * Math.cos(bearing) + site.right[2] * Math.sin(bearing),
    ]);
    const home = travel(site.normal, dir, dist);
    if (makeFlock(`v${made}`, home, 0xc41c + 977 * tries, all)) made++;
  }
  for (let i = 0; i < FLOCK_LATTICE; i++) {
    makeFlock(`f${i}`, fibonacci(i + 0.61, FLOCK_LATTICE), 0xe99 + i * 2246822519, all);
  }
  cached = all;
  return all;
}

/** Where a hen is at shared time `t` (seconds). */
export function henPoseAt(h: Hen, t: number): HenPose {
  const local = t + h.offset;
  const k = Math.floor(local / CYCLE_S);
  const inCycle = local - k * CYCLE_S;
  const walking = inCycle < h.walkS;
  // Loop time only advances while she walks, so she stops where she pecks.
  const tau = k * h.walkS + Math.min(inCycle, h.walkS);
  const a1 = h.w1 * tau + h.p1;
  const a2 = h.w2 * tau + h.p2;
  const x = h.ax * Math.sin(a1);
  const z = h.az * Math.sin(a2);
  const vx = h.ax * h.w1 * Math.cos(a1);
  const vz = h.az * h.w2 * Math.cos(a2);
  const n = offsetPoint(h.home, h.e1, h.e2, x, z);
  const sp = Math.hypot(vx, vz);
  const raw: Vec3 = sp > 1e-6
    ? [(h.e1[0] * vx + h.e2[0] * vz) / sp, (h.e1[1] * vx + h.e2[1] * vz) / sp, (h.e1[2] * vx + h.e2[2] * vz) / sp]
    : h.e1;
  const d = raw[0] * n[0] + raw[1] * n[1] + raw[2] * n[2];
  const heading = normalize([raw[0] - n[0] * d, raw[1] - n[1] * d, raw[2] - n[2] * d]);
  const phase = walking ? inCycle / h.walkS : (inCycle - h.walkS) / (CYCLE_S - h.walkS);
  return { n, heading, pecking: !walking, phase };
}

/** Hens whose loop comes within `radiusM` of `n` (cheap broad phase). */
export function hensNear(n: Vec3, radiusM: number): Hen[] {
  const out: Hen[] = [];
  const pad = HEN_ROAM_M * 1.05;
  for (const h of getHens()) {
    if (arcMetres(n, h.home) <= radiusM + pad) out.push(h);
  }
  return out;
}

// ── Catches, from the shared nature events ──────────────────────────

let caughtAt: Map<string, number> | null = null;
let unsubscribe: (() => void) | null = null;

function catches(): Map<string, number> {
  if (!caughtAt) {
    caughtAt = new Map();
    for (const e of listNatureEvents(HEN_EVENT_ANCHOR)) {
      if (e.kind !== 'hen-caught') continue;
      const prev = caughtAt.get(e.blockId);
      if (prev === undefined || e.at > prev) caughtAt.set(e.blockId, e.at);
    }
    if (!unsubscribe) unsubscribe = subscribeNatureEvents(() => { caughtAt = null; });
  }
  return caughtAt;
}

/** True while a caught hen is gone (from her catch until she respawns). */
export function isHenAway(henId: string, now = Date.now()): boolean {
  const at = catches().get(henId);
  return at !== undefined && now >= at && now < at + HEN_RESPAWN_MS;
}

/** When a caught hen comes back (ms), or undefined if she is out now. */
export function henBackAt(henId: string, now = Date.now()): number | undefined {
  const at = catches().get(henId);
  return at !== undefined && now >= at && now < at + HEN_RESPAWN_MS ? at + HEN_RESPAWN_MS : undefined;
}

/**
 * The nearest hen that is out and within `reachM` of `n` at shared time
 * `t` (s) and wall time `now` (ms), with her pose.
 */
export function nearestCatchableHen(
  n: Vec3,
  t: number,
  now = Date.now(),
  reachM = HEN_CATCH_REACH_M,
): { hen: Hen; pose: HenPose; distM: number } | null {
  let best: { hen: Hen; pose: HenPose; distM: number } | null = null;
  for (const h of hensNear(n, reachM)) {
    if (isHenAway(h.id, now)) continue;
    const pose = henPoseAt(h, t);
    const d = arcMetres(n, pose.n);
    if (d <= reachM && (!best || d < best.distM)) best = { hen: h, pose, distM: d };
  }
  return best;
}

export function _resetChickensForTest(): void {
  cached = null;
  caughtAt = null;
  unsubscribe?.();
  unsubscribe = null;
  volcano = null;
}
