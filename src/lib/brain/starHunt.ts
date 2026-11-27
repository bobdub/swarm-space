/**
 * Star hunt: the game behind the constellations.
 *
 * Four star charts hang in the bar (The Green Cat & Red Dragon), one per
 * constellation, each with tonight's hint for its figure. A player reads the
 * charts indoors, walks outside after dark and finds the figures among the
 * ordinary stars. The sky
 * draws no figure lines and the figure's stars are only a little brighter
 * than the rest, so the chart's shape and a loose hint are what make it
 * findable. Holding your gaze on it logs the find.
 *
 * Everything here is a pure function of the shared Earth clock and the
 * village's site, so every peer gets the same hints on the same night.
 */
import {
  EARTH_RADIUS,
  GAME_DAY_SECONDS,
  SHARED_VILLAGE_ISLAND_ANCHOR,
  getEarthLocalSiteFrame,
  getEarthPoseAt,
  quatRotate,
  type EarthPose,
} from './earth';
import { skyCadenceAt } from './skyCadence';
import { CONSTELLATIONS, constellationCentre, type ConstellationChart, type Vec3 } from './constellations';

const DEG = Math.PI / 180;

// ── Tuning: the challenge sweet spot ─────────────────────────────────
/** How far (degrees) your gaze may sit from the figure's centre and still count. */
export const FIND_CONE_DEG = 7;
/** Seconds you hold your gaze on the figure before the find is logged. */
export const FIND_HOLD_S = 2.2;
/**
 * Seconds of holding before any on-screen feedback shows. Without this a
 * player could sweep the sky and follow the ring like a metal detector.
 */
export const FIND_QUIET_S = 0.8;
/** The figure must stand at least this high (degrees) to be found. */
export const MIN_FIND_ALTITUDE_DEG = 10;
/** Stars must be at least this visible (skyCadence starOpacity). */
export const MIN_FIND_STAR_OPACITY = 0.45;
/** A constellation is "up tonight" if it is this high, after dark, for… */
const TONIGHT_MIN_ALTITUDE_DEG = 20;
/** …at least this many of the night's samples (48 per day ≈ 2 game hours). */
const TONIGHT_MIN_SAMPLES = 4;
const SAMPLES_PER_NIGHT = 48;

export interface SkyPlace {
  /** Earth-local unit normal of the observer's site. */
  normal: Vec3;
}

export interface LocalSky {
  up: Vec3;
  north: Vec3;
  east: Vec3;
  /** World position of the observer (on the surface), for sky cadence. */
  pos: Vec3;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** The village, where the bar and its star chart stand. */
export function villagePlace(): SkyPlace {
  return { normal: getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR).normal };
}

/** Local up / north / east for an observer at `place` under `pose`. */
export function localSky(place: SkyPlace, pose: EarthPose): LocalSky {
  const up = norm(quatRotate(pose.spinQuat, place.normal));
  // North: the celestial pole (+Y) projected onto the horizon.
  const pole: Vec3 = [0, 1, 0];
  const k = dot(pole, up);
  const north = norm([pole[0] - k * up[0], pole[1] - k * up[1], pole[2] - k * up[2]]);
  const east = cross(north, up);
  const pos: Vec3 = [
    pose.center[0] + up[0] * EARTH_RADIUS,
    pose.center[1] + up[1] * EARTH_RADIUS,
    pose.center[2] + up[2] * EARTH_RADIUS,
  ];
  return { up, north, east, pos };
}

/** Altitude and azimuth (degrees; azimuth 0 = north, 90 = east) of a sky direction. */
export function altAz(dir: Vec3, sky: LocalSky): { alt: number; az: number } {
  const alt = Math.asin(Math.max(-1, Math.min(1, dot(dir, sky.up)))) / DEG;
  let az = Math.atan2(dot(dir, sky.east), dot(dir, sky.north)) / DEG;
  if (az < 0) az += 360;
  return { alt, az };
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Eight-point compass word for an azimuth in degrees. */
export function compassWord(azDeg: number): string {
  return COMPASS[Math.round((((azDeg % 360) + 360) % 360) / 45) % 8];
}

// ── Nights ───────────────────────────────────────────────────────────

let noonOffsetCache: number | null = null;

/**
 * Seconds after the epoch of the village's first local noon. Nights are
 * counted noon to noon so a whole night (dusk → dawn) always belongs to one
 * night index and tonight's chart never changes in the dark.
 */
export function villageNoonOffset(): number {
  if (noonOffsetCache !== null) return noonOffsetCache;
  const place = villagePlace();
  let best = -2;
  let bestT = 0;
  const N = 240;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * GAME_DAY_SECONDS;
    const pose = getEarthPoseAt(t);
    const sky = localSky(place, pose);
    const e = skyCadenceAt(sky.pos, pose).solarElevation;
    if (e > best) { best = e; bestT = t; }
  }
  noonOffsetCache = bestT;
  return bestT;
}

/** Index of the night (noon to noon at the village) that contains time `t`. */
export function nightIndexAt(t: number): number {
  return Math.floor((t - villageNoonOffset()) / GAME_DAY_SECONDS);
}

export interface NightSighting {
  chart: ConstellationChart;
  /** Samples tonight (of 48) where it is dark and the figure is ≥ 20° up. */
  upSamples: number;
  /** Highest altitude reached in the dark, degrees. */
  bestAlt: number;
  /** Azimuth at that moment, degrees. */
  bestAz: number;
  /** When in the night it stands highest: 0 = dusk … 1 = dawn. */
  bestPhase: number;
}

/** How each constellation shows from the village on night `n`. */
export function nightSightings(n: number): NightSighting[] {
  const place = villagePlace();
  const start = villageNoonOffset() + n * GAME_DAY_SECONDS;
  const centres = CONSTELLATIONS.map(constellationCentre);
  const out: NightSighting[] = CONSTELLATIONS.map((chart) => ({
    chart, upSamples: 0, bestAlt: -90, bestAz: 0, bestPhase: 0.5,
  }));
  const dark: number[] = [];
  const darkBest: Array<number> = CONSTELLATIONS.map(() => -1);
  for (let i = 0; i < SAMPLES_PER_NIGHT; i++) {
    const t = start + (i / SAMPLES_PER_NIGHT) * GAME_DAY_SECONDS;
    const pose = getEarthPoseAt(t);
    const sky = localSky(place, pose);
    if (skyCadenceAt(sky.pos, pose).starOpacity < MIN_FIND_STAR_OPACITY) continue;
    dark.push(i);
    centres.forEach((c, k) => {
      const { alt, az } = altAz(c, sky);
      const s = out[k];
      if (alt >= TONIGHT_MIN_ALTITUDE_DEG) s.upSamples++;
      if (alt > s.bestAlt) { s.bestAlt = alt; s.bestAz = az; darkBest[k] = i; }
    });
  }
  if (dark.length > 1) {
    const first = dark[0];
    const last = dark[dark.length - 1];
    out.forEach((s, k) => {
      if (darkBest[k] >= 0) s.bestPhase = (darkBest[k] - first) / Math.max(1, last - first);
    });
  }
  return out;
}

const sightingsCache = new Map<number, NightSighting[]>();

/** `nightSightings`, memoised: each night is sampled once. */
export function sightingsForNight(n: number): NightSighting[] {
  const cached = sightingsCache.get(n);
  if (cached) return cached;
  const s = nightSightings(n);
  if (sightingsCache.size > 16) sightingsCache.clear();
  sightingsCache.set(n, s);
  return s;
}

/** Whether a sighting is worth hunting tonight: well up after dark for a while. */
export function isUpTonight(s: NightSighting): boolean {
  return s.upSamples >= TONIGHT_MIN_SAMPLES;
}

/**
 * The chart's hint: roughly where and when, never exactly. Enough to know
 * which part of the sky to search, not enough to skip learning the shape.
 */
export function sightingHint(s: NightSighting): string {
  if (!isUpTonight(s)) return 'Not up after dark tonight. Try another night';
  const when = s.bestPhase < 0.35 ? 'early in the night' : s.bestPhase > 0.65 ? 'before dawn' : 'around midnight';
  const height = s.bestAlt > 65 ? 'high overhead' : s.bestAlt > 40 ? 'high' : 'low';
  if (height === 'high overhead') return `Rides high overhead ${when}`;
  return `Look ${height} in the ${compassWord(s.bestAz)} ${when}`;
}

// ── Gaze ─────────────────────────────────────────────────────────────

/** Angle (degrees) between the camera's forward and the figure's centre. */
export function gazeOffsetDeg(forward: Vec3, centre: Vec3): number {
  const f = norm(forward);
  return Math.acos(Math.max(-1, Math.min(1, dot(f, centre)))) / DEG;
}

export interface GazeState {
  /** Seconds the gaze has stayed on target. */
  held: number;
  found: boolean;
}

/**
 * Advance the hold timer by `dt`. Looking away resets it; the find is logged
 * once the hold reaches FIND_HOLD_S.
 */
export function stepGaze(state: GazeState, onTarget: boolean, dt: number): GazeState {
  if (state.found) return state;
  if (!onTarget) return { held: 0, found: false };
  const held = state.held + dt;
  return { held, found: held >= FIND_HOLD_S };
}

/** On-screen progress 0..1, hidden (0) for the first FIND_QUIET_S seconds. */
export function gazeProgress(held: number): number {
  if (held < FIND_QUIET_S) return 0;
  return Math.min(1, (held - FIND_QUIET_S) / (FIND_HOLD_S - FIND_QUIET_S));
}
