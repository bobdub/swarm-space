/**
 * chickens — free-range hens wandering the land, for hunting with a knife.
 *
 * Like the fish and sharks at sea (`sea/seaLife.ts`), where a hen is at any
 * moment is a pure function of terrain every peer already shares and the
 * shared clock, so nothing about her walk is sent over the wire. Each hen
 * walks a slow, wandering loop around her flock's home: a few steps, then a
 * pause to peck, then a few more.
 *
 * Every flock has one rooster and a nest at its home. The only thing peers
 * tell each other is that a bird was caught: one small `hen-caught` nature
 * event (see `world/natureEventsStore`). From that one timestamp every peer
 * works out the same life story for the empty place in the flock: a hen
 * lays an egg in the nest, the egg hatches, and the chick grows up into the
 * bird that was lost, walking the same loop. So the land never runs out of
 * chickens, and nothing more is sent.
 *
 * Hens also lay on their own: each hen lays an egg in the nest every
 * `LAY_EVERY_MS` (each on her own beat), so a nest usually holds an egg or
 * two. A player can take an egg for Food (one `egg-taken` event, shared
 * like a catch). An egg left alone hatches if the rooster was there when
 * it was laid; the chick trots after its mother while it grows, then
 * wanders off to start a flock of its own. An egg laid with no rooster is
 * not fertile and just sits in the nest until it is taken or goes bad.
 *
 * A hen's replacement egg only hatches if the flock has a rooster, so when the rooster
 * is caught the hens hold off laying until a new rooster has grown up. (His
 * own replacement egg needs no rooster: a hen stays fertile for weeks.)
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

/** Food a caught hen gives, and a caught rooster (a bigger bird). */
export const FOOD_PER_HEN = 3;
export const FOOD_PER_ROOSTER = 4;
/** After a catch: until an egg is laid in the nest (ms). */
export const EGG_LAY_MS = 2 * 60_000;
/** An egg takes this long to hatch (ms). */
export const EGG_HATCH_MS = 4 * 60_000;
/** A chick takes this long to grow into a hen or rooster (ms). */
export const CHICK_GROW_MS = 6 * 60_000;
/** Shortest time from a catch until the flock is whole again (ms). */
export const HEN_RESPAWN_MS = EGG_LAY_MS + EGG_HATCH_MS + CHICK_GROW_MS;
/** Each hen lays an egg on her own this often (ms). */
export const LAY_EVERY_MS = 5 * 60_000;
/** An infertile egg sits in the nest this long before it goes bad (ms). */
export const EGG_KEEP_MS = 2 * LAY_EVERY_MS;
/** Food for an egg taken from the nest. */
export const FOOD_PER_EGG = 1;
/** How close (m) a player has to be to a nest to take an egg. */
export const NEST_REACH_M = 1.6;
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
  /** Place in the flock; place 0 is the flock's rooster. */
  slot: number;
  rooster: boolean;
  /** Earth-local unit normal of the flock's nest (the flock's home). */
  nest: Vec3;
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
  const size = 3 + Math.floor(r() * 4); // a rooster and 2–5 hens
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
      slot: i,
      rooster: i === 0,
      nest: home,
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
      scale: i === 0 ? 1.15 + 0.1 * r() : 0.85 + 0.3 * r(),
    });
  }
  return true;
}

let cached: Hen[] | null = null;
let roosters: Map<string, Hen> | null = null;

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
  roosters = new Map(all.filter((h) => h.rooster).map((h) => [h.flock, h]));
  return all;
}

/** The rooster of `flock`. */
export function roosterOf(flock: string): Hen | undefined {
  if (!roosters) getHens();
  return roosters?.get(flock);
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

let caughtAt: Map<string, number[]> | null = null;
let takenAt: Map<string, number> | null = null;
let unsubscribe: (() => void) | null = null;

/** Every catch time per bird, oldest first. */
function catches(): Map<string, number[]> {
  if (!caughtAt) {
    caughtAt = new Map();
    takenAt = new Map();
    for (const e of listNatureEvents(HEN_EVENT_ANCHOR)) {
      if (e.kind === 'egg-taken') {
        const prev = takenAt.get(e.blockId);
        if (prev === undefined || e.at < prev) takenAt.set(e.blockId, e.at);
        continue;
      }
      if (e.kind !== 'hen-caught') continue;
      const list = caughtAt.get(e.blockId);
      if (list) list.push(e.at); else caughtAt.set(e.blockId, [e.at]);
    }
    for (const list of caughtAt.values()) list.sort((a, b) => a - b);
    if (!unsubscribe) unsubscribe = subscribeNatureEvents(() => { caughtAt = null; takenAt = null; });
  }
  return caughtAt;
}

/** Latest catch of `id` at or before `now`. */
function lastCatch(id: string, now: number): number | undefined {
  const list = catches().get(id);
  if (!list) return undefined;
  for (let i = list.length - 1; i >= 0; i--) if (list[i] <= now) return list[i];
  return undefined;
}

export type HenStage = 'adult' | 'gone' | 'egg' | 'chick';

export interface HenLife {
  stage: HenStage;
  /** When the egg is (or was) laid, hatches, and the chick is grown (ms). */
  layAt?: number;
  hatchAt?: number;
  grownAt?: number;
  /** 0..1 through the current stage (egg or chick). */
  progress: number;
}

/** When the rooster of `flock` is grown again, if he is missing at `at`. */
function roosterBackAt(flock: string, at: number): number | undefined {
  const r = roosterOf(flock);
  if (!r) return undefined;
  const c = lastCatch(r.id, at);
  if (c === undefined) return undefined;
  const back = c + HEN_RESPAWN_MS;
  return at < back ? back : undefined;
}

/**
 * Where a bird is in its life at wall time `now` (ms). Every peer holds the
 * same catch events, so every peer works out the same answer.
 */
export function henLifeAt(h: Hen, now = Date.now()): HenLife {
  const c = lastCatch(h.id, now);
  if (c === undefined) return { stage: 'adult', progress: 1 };
  let layAt = c + EGG_LAY_MS;
  // A hen's egg needs a rooster: with him gone, the laying waits for the new one.
  if (!h.rooster) {
    const back = roosterBackAt(h.flock, layAt);
    if (back !== undefined) layAt = back;
  }
  const hatchAt = layAt + EGG_HATCH_MS;
  const grownAt = hatchAt + CHICK_GROW_MS;
  const span = { layAt, hatchAt, grownAt };
  if (now < layAt) return { stage: 'gone', progress: 0, ...span };
  if (now < hatchAt) return { stage: 'egg', progress: (now - layAt) / EGG_HATCH_MS, ...span };
  if (now < grownAt) return { stage: 'chick', progress: (now - hatchAt) / CHICK_GROW_MS, ...span };
  return { stage: 'adult', progress: 1, ...span };
}

/** True while a caught bird is not yet grown back (gone, egg or chick). */
export function isHenAway(henId: string, now = Date.now()): boolean {
  const h = henById(henId);
  if (!h) return false;
  return henLifeAt(h, now).stage !== 'adult';
}

/** When a caught bird is grown back (ms), or undefined if it is out now. */
export function henBackAt(henId: string, now = Date.now()): number | undefined {
  const h = henById(henId);
  if (!h) return undefined;
  const life = henLifeAt(h, now);
  return life.stage === 'adult' ? undefined : life.grownAt;
}

let byId: Map<string, Hen> | null = null;
function henById(id: string): Hen | undefined {
  if (!byId) byId = new Map(getHens().map((h) => [h.id, h]));
  return byId.get(id);
}

/** Where in the nest (tangent offset, m) the egg for flock place `slot` lies. */
export function eggOffset(slot: number): [number, number] {
  const a = slot * 2.399963229728653;
  const d = slot === 0 ? 0 : 0.09;
  return [Math.cos(a) * d, Math.sin(a) * d];
}

/** Earth-local unit normal of a point `x`, `z` metres from `n` (east-ish, north-ish). */
export function nestPoint(n: Vec3, x: number, z: number): Vec3 {
  const [e1, e2] = tangents(n, 0);
  return offsetPoint(n, e1, e2, x, z);
}

/**
 * A chick's pose: she toddles out from the nest onto her loop over the
 * first part of growing up, then walks it like the grown-ups.
 */
export function chickPoseAt(h: Hen, t: number, progress: number): HenPose {
  const p = henPoseAt(h, t);
  const k = Math.min(1, progress * 2.5);
  if (k >= 1) return p;
  const n = normalize([
    h.nest[0] + (p.n[0] - h.nest[0]) * k,
    h.nest[1] + (p.n[1] - h.nest[1]) * k,
    h.nest[2] + (p.n[2] - h.nest[2]) * k,
  ]);
  return { ...p, n };
}

// ── The brood: eggs hens lay on their own, and the chicks they become ──

export interface BroodEgg {
  /** Shared id, also the body id on `egg-taken` events: `egg:<hen>:<k>`. */
  id: string;
  mother: Hen;
  /** When it was laid (ms). */
  layAt: number;
  /** True if the rooster was with the flock when it was laid. */
  fertile: boolean;
}

export interface BroodChick {
  egg: BroodEgg;
  /** 0..1 from hatching to wandering off. */
  progress: number;
}

function hash01(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h / 4294967296;
}

/** When egg `id` was taken from the nest, if it was. */
function eggTakenAt(id: string, now: number): number | undefined {
  catches();
  const at = takenAt?.get(id);
  return at !== undefined && at <= now ? at : undefined;
}

function roosterPresent(flock: string, at: number): boolean {
  const r = roosterOf(flock);
  return !!r && henLifeAt(r, at).stage === 'adult';
}

/** The eggs `h` laid on her own whose lives overlap `now`, newest last. */
function layingsNear(h: Hen, now: number): BroodEgg[] {
  if (h.rooster) return [];
  const off = hash01(h.id) * LAY_EVERY_MS;
  const span = Math.max(EGG_KEEP_MS, EGG_HATCH_MS + CHICK_GROW_MS);
  const kHi = Math.floor((now - off) / LAY_EVERY_MS);
  const kLo = Math.floor((now - off - span) / LAY_EVERY_MS);
  const out: BroodEgg[] = [];
  for (let k = Math.max(kLo, 0); k <= kHi; k++) {
    const layAt = k * LAY_EVERY_MS + off;
    // She only lays while she is with the flock as a grown hen.
    if (henLifeAt(h, layAt).stage !== 'adult') continue;
    out.push({ id: `egg:${h.id}:${k}`, mother: h, layAt, fertile: roosterPresent(h.flock, layAt) });
  }
  return out;
}

/** Eggs lying in `flock`'s nest at `now` that a player may take. */
export function nestEggs(flockHens: Hen[], now = Date.now()): BroodEgg[] {
  const out: BroodEgg[] = [];
  for (const h of flockHens) {
    for (const e of layingsNear(h, now)) {
      if (now < e.layAt || eggTakenAt(e.id, now) !== undefined) continue;
      const end = e.layAt + (e.fertile ? EGG_HATCH_MS : EGG_KEEP_MS);
      if (now < end) out.push(e);
    }
  }
  return out.sort((a, b) => a.layAt - b.layAt);
}

/** Chicks hatched from untaken eggs of `flockHens`, at `now`. */
export function broodChicks(flockHens: Hen[], now = Date.now()): BroodChick[] {
  const out: BroodChick[] = [];
  for (const h of flockHens) {
    for (const e of layingsNear(h, now)) {
      if (!e.fertile || eggTakenAt(e.id, now) !== undefined) continue;
      const hatch = e.layAt + EGG_HATCH_MS;
      if (now >= hatch && now < hatch + CHICK_GROW_MS) out.push({ egg: e, progress: (now - hatch) / CHICK_GROW_MS });
    }
  }
  return out;
}

/** Where in the nest (tangent offset, m) a laid egg lies. */
export function broodEggOffset(e: BroodEgg): [number, number] {
  const a = hash01(e.id) * Math.PI * 2;
  const d = 0.05 + 0.08 * hash01(`${e.id}/r`);
  return [Math.cos(a) * d, Math.sin(a) * d];
}

/**
 * A brood chick's pose at shared time `t`: it toddles out of the nest to
 * its mother, trots along just behind her, and near the end of growing up
 * wanders off on its own to start a new flock.
 */
export function broodChickPoseAt(c: BroodChick, t: number): HenPose {
  const mom = henPoseAt(c.egg.mother, t);
  const seed = hash01(c.egg.id);
  // Behind and a little to one side of her, with a bit of a scamper.
  const back = 0.45 + 0.25 * seed;
  const side = (seed - 0.5) * 0.8 + 0.15 * Math.sin(t * 1.7 + seed * 10);
  const right = normalize([
    mom.heading[1] * mom.n[2] - mom.heading[2] * mom.n[1],
    mom.heading[2] * mom.n[0] - mom.heading[0] * mom.n[2],
    mom.heading[0] * mom.n[1] - mom.heading[1] * mom.n[0],
  ]);
  const dir = normalize([
    -mom.heading[0] * back + right[0] * side,
    -mom.heading[1] * back + right[1] * side,
    -mom.heading[2] * back + right[2] * side,
  ]);
  let n = travel(mom.n, dir, Math.hypot(back, side));
  const k = Math.min(1, c.progress * 6);
  if (k < 1) {
    n = normalize([
      c.egg.mother.nest[0] + (n[0] - c.egg.mother.nest[0]) * k,
      c.egg.mother.nest[1] + (n[1] - c.egg.mother.nest[1]) * k,
      c.egg.mother.nest[2] + (n[2] - c.egg.mother.nest[2]) * k,
    ]);
  }
  let heading = mom.heading;
  if (c.progress > 0.8) {
    // Off it goes, straight out from the flock.
    const [e1] = tangents(c.egg.mother.nest, seed * Math.PI * 2);
    const away = (c.progress - 0.8) / 0.2;
    n = travel(n, e1, away * 12);
    heading = e1;
  }
  return { n, heading, pecking: mom.pecking, phase: mom.phase };
}

/** The flock mates of `h` (including her). */
export function flockOf(h: Hen): Hen[] {
  if (!flocks) {
    flocks = new Map();
    for (const x of getHens()) {
      const l = flocks.get(x.flock);
      if (l) l.push(x); else flocks.set(x.flock, [x]);
    }
  }
  return flocks.get(h.flock) ?? [h];
}
let flocks: Map<string, Hen[]> | null = null;

/**
 * The nest within `reachM` of `n` with an egg to take, and its oldest egg.
 */
export function nearestNestEgg(
  n: Vec3,
  now = Date.now(),
  reachM = NEST_REACH_M,
): { egg: BroodEgg; distM: number } | null {
  let best: { egg: BroodEgg; distM: number } | null = null;
  const seen = new Set<string>();
  for (const h of hensNear(n, reachM)) {
    if (seen.has(h.flock)) continue;
    seen.add(h.flock);
    const d = arcMetres(n, h.nest);
    if (d > reachM || (best && d >= best.distM)) continue;
    const eggs = nestEggs(flockOf(h), now);
    if (eggs.length) best = { egg: eggs[0], distM: d };
  }
  return best;
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
  roosters = null;
  byId = null;
  flocks = null;
  caughtAt = null;
  takenAt = null;
  unsubscribe?.();
  unsubscribe = null;
  volcano = null;
}
