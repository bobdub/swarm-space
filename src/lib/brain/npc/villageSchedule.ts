/**
 * villageSchedule — where every villager is, from the shared clock alone.
 *
 * Each villager keeps a daily routine keyed to the village's own solar
 * time (sunrise, noon and dusk over the village island), and the time
 * comes from the shared epoch clock (`getEarthPoseTime()`, read from
 * `networkNow()`). Everything below is a pure function of
 * (name, personality, walking speed, epoch seconds), so two devices that
 * agree on the clock put every villager on the same spot at the same
 * moment without sending a byte.
 *
 *   night      rest at home
 *   dawn       drink at a spring
 *   morning    first work (personality picks it: gather, hunt, fish,
 *              craft or grow)
 *   midday     eat at home
 *   afternoon  second work (always a food source when the first isn't)
 *   late day   drink at a spring
 *   evening    eat at home
 *   twilight   gather in the village circle
 *   late night rest at home
 *
 * Block edges are shifted by up to ±0.4 h per villager so the village
 * doesn't move in lockstep, and the first and second work swap on odd
 * days. Springs, woods and game come from the deterministic resource
 * sites (`baseResources.ts`), picked by hash rather than by local yield,
 * because yield is per-device state.
 *
 * Between blocks a villager walks a straight line in the village's
 * tangent plane (the geodesic at village scale, under 40 m) at its own
 * speed, leaving at the start of the block.
 */
import {
  GAME_DAY_SECONDS,
  SHARED_VILLAGE_ISLAND_ANCHOR,
  getEarthLocalSiteFrame,
  getEarthPoseAt,
  getSunDirection,
  quatRotate,
  type Vec3,
} from '@/lib/brain/earth';
import { listResourceSites, type ResourceKind } from '@/lib/world/baseResources';
import { hash01 } from './npcIdentity';
import type { NpcDrive, PersonalitySeed } from './npcTypes';

type Place = 'home' | 'circle' | 'garden' | ResourceKind;

interface Block {
  /** Solar hour the block starts (before the per-villager shift). */
  start: number;
  /** Fixed drive, or which personality work slot fills it. */
  drive: NpcDrive | 'work1' | 'work2';
}

const DAY_PLAN: readonly Block[] = [
  { start: 0, drive: 'rest' },
  { start: 5.5, drive: 'drink' },
  { start: 7, drive: 'work1' },
  { start: 10.5, drive: 'eat' },
  { start: 11.5, drive: 'work2' },
  { start: 15, drive: 'drink' },
  { start: 16.5, drive: 'eat' },
  { start: 18, drive: 'socialise' },
  { start: 21.5, drive: 'rest' },
];

/** Largest per-villager shift of the block edges (solar hours). */
const MAX_SHIFT_H = 0.4;
/** Spread of the standing spots around a site (m), inside ARRIVE_RADIUS. */
const SITE_SPREAD_M = 0.8;
/** Radius of the twilight circle around the village centre (m). */
const CIRCLE_RADIUS_M = 3.5;

const FOOD_WORK: ReadonlySet<NpcDrive> = new Set(['hunt', 'fish']);

export interface VillagerRef {
  /** Cross-device identity. */
  name: string;
  seed: PersonalitySeed;
}

export interface VillagePlan {
  /** What the routine has the villager doing right now. */
  drive: NpcDrive;
  /** Resource site the drive works at, or null (home, garden, circle). */
  siteId: string | null;
  /** Scheduled tangent-plane position (m from the village anchor). */
  tx: number;
  tz: number;
  /** True once the walk to this block's spot is over. */
  arrived: boolean;
  /** Solar day number (shared). */
  day: number;
  /** Index of the block in the day plan. */
  block: number;
}

// ── Solar time over the village ────────────────────────────────────────

let _noonSeconds: number | null = null;

function sunElevationAt(seconds: number, localNormal: Vec3): number {
  const pose = getEarthPoseAt(seconds);
  const n = quatRotate(pose.spinQuat, localNormal);
  const s = getSunDirection(pose);
  return n[0] * s[0] + n[1] * s[1] + n[2] * s[2];
}

/**
 * Epoch seconds of one solar noon over the village. The solar day is
 * exactly GAME_DAY_SECONDS by construction (`EARTH_SPIN_PERIOD`), so one
 * noon fixes them all. Found once by sampling the first game day and
 * refining around the highest sample.
 */
export function villageNoonSeconds(): number {
  if (_noonSeconds !== null) return _noonSeconds;
  const normal = getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR).normal;
  const steps = 288;
  const dt = GAME_DAY_SECONDS / steps;
  let best = 0;
  let bestE = -Infinity;
  for (let i = 0; i < steps; i++) {
    const e = sunElevationAt(i * dt, normal);
    if (e > bestE) { bestE = e; best = i * dt; }
  }
  let lo = best - dt;
  let hi = best + dt;
  for (let i = 0; i < 40; i++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (sunElevationAt(a, normal) < sunElevationAt(b, normal)) lo = a; else hi = b;
  }
  _noonSeconds = (lo + hi) / 2;
  return _noonSeconds;
}

/** Village solar hour in [0, 24) at epoch `seconds` (12 = noon). */
export function villageSolarHour(seconds: number): number {
  const u = (seconds - villageNoonSeconds()) / GAME_DAY_SECONDS + 0.5;
  return (u - Math.floor(u)) * 24;
}

// ── Per-villager routine ───────────────────────────────────────────────

/** The two work drives a personality leans toward, strongest first. */
export function workDrives(seed: PersonalitySeed): [NpcDrive, NpcDrive] {
  const pos = (n: number) => Math.max(0, n);
  const scored: Array<[NpcDrive, number]> = [
    ['gather', 0.5 + 0.4 * pos(seed.empathy)],
    ['hunt', 0.45 + 0.5 * pos(seed.riskTolerance)],
    ['fish', 0.45 + 0.5 * pos(seed.curiosity)],
    ['craft', 0.4 + 0.6 * pos(seed.inventiveHarmony)],
    ['grow', 0.4 + 0.5 * pos(seed.relationalWarmth)],
  ];
  // Stable order on ties: the list order above.
  const ranked = scored
    .map(([d, s], i) => ({ d, s, i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.d);
  const first = ranked[0];
  const second = FOOD_WORK.has(first)
    ? ranked[1]
    : ranked.find((d) => FOOD_WORK.has(d)) ?? 'fish';
  return [first, second];
}

function placeFor(drive: NpcDrive): Place {
  switch (drive) {
    case 'drink':
    case 'fish': return 'water';
    case 'gather':
    case 'craft': return 'wood';
    case 'hunt': return 'animal';
    case 'grow': return 'garden';
    case 'socialise': return 'circle';
    default: return 'home';
  }
}

/** The villager's home spot: a ring 6–12 m from the village centre. */
export function homeSpot(name: string): { tx: number; tz: number } {
  const a = hash01(`${name}:home:angle`) * Math.PI * 2;
  const r = 6 + hash01(`${name}:home:radius`) * 6;
  return { tx: Math.cos(a) * r, tz: Math.sin(a) * r };
}

function spotFor(name: string, drive: NpcDrive, day: number, block: number): { tx: number; tz: number; siteId: string | null } {
  const place = placeFor(drive);
  if (place === 'home') return { ...homeSpot(name), siteId: null };
  if (place === 'garden') {
    const h = homeSpot(name);
    const a = hash01(`${name}:garden`) * Math.PI * 2;
    return { tx: h.tx + Math.cos(a) * 2, tz: h.tz + Math.sin(a) * 2, siteId: null };
  }
  if (place === 'circle') {
    const a = hash01(`${name}:circle`) * Math.PI * 2;
    return { tx: Math.cos(a) * CIRCLE_RADIUS_M, tz: Math.sin(a) * CIRCLE_RADIUS_M, siteId: null };
  }
  const sites = listResourceSites().filter((s) => s.kind === place);
  if (sites.length === 0) return { ...homeSpot(name), siteId: null };
  const site = sites[Math.floor(hash01(`${name}:${day}:${block}:site`) * sites.length)];
  const a = hash01(`${name}:${site.id}:stand`) * Math.PI * 2;
  return {
    tx: site.tx + Math.cos(a) * SITE_SPREAD_M,
    tz: site.tz + Math.sin(a) * SITE_SPREAD_M,
    siteId: site.id,
  };
}

function driveOf(block: Block, work: [NpcDrive, NpcDrive], day: number): NpcDrive {
  if (block.drive === 'work1' || block.drive === 'work2') {
    const swap = (day & 1) === 1;
    const first = block.drive === 'work1';
    return work[first !== swap ? 0 : 1];
  }
  return block.drive;
}

/**
 * Where `villager` is and what it is doing at epoch `seconds`, walking at
 * `speed` m/s between spots. Pure: same inputs, same answer, any device.
 */
export function villagePlan(villager: VillagerRef, seconds: number, speed: number): VillagePlan {
  const { name, seed } = villager;
  const shiftH = (hash01(`${name}:shift`) * 2 - 1) * MAX_SHIFT_H;
  const u = (seconds - villageNoonSeconds()) / GAME_DAY_SECONDS + 0.5 - shiftH / 24;
  const day = Math.floor(u);
  const hour = (u - day) * 24;
  let block = 0;
  for (let i = DAY_PLAN.length - 1; i >= 0; i--) {
    if (hour >= DAY_PLAN[i].start) { block = i; break; }
  }
  const work = workDrives(seed);
  const drive = driveOf(DAY_PLAN[block], work, day);
  const to = spotFor(name, drive, day, block);

  const prevDay = block === 0 ? day - 1 : day;
  const prevBlock = block === 0 ? DAY_PLAN.length - 1 : block - 1;
  const from = spotFor(name, driveOf(DAY_PLAN[prevBlock], work, prevDay), prevDay, prevBlock);

  const sinceStart = ((hour - DAY_PLAN[block].start) / 24) * GAME_DAY_SECONDS;
  const dist = Math.hypot(to.tx - from.tx, to.tz - from.tz);
  const travel = speed > 0 ? dist / speed : 0;
  const f = travel <= 0 ? 1 : Math.min(1, Math.max(0, sinceStart / travel));
  return {
    drive,
    siteId: to.siteId,
    tx: from.tx + (to.tx - from.tx) * f,
    tz: from.tz + (to.tz - from.tz) * f,
    arrived: f >= 1,
    day,
    block,
  };
}

/** Test seam. */
export function _resetVillageScheduleForTest(): void {
  _noonSeconds = null;
}
