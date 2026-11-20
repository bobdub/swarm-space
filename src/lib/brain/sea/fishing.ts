/**
 * fishing — a rod over the rail, so a crew becalmed far from land can
 * still eat (rowing burns Food; see `crew.ts`).
 *
 * Take a rod at either rod holder forward of the mast. Cast, wait for a
 * bite, and hook it while the float is down. Then the fish fights: a
 * marker sweeps along a bar, and you strike while it is inside the
 * highlighted zone. Three good strikes land it (+1 Food, credited like
 * any other gathered Food via `recordHarvestForResource`); two bad ones
 * and it throws the hook. Each good strike makes the zone narrower and
 * the marker quicker. Miss the bite and it gets away. Deeper water bites sooner than the shallows, and a boat making
 * more than 1.5 m/s trails the line too fast for anything to take it.
 *
 * The bite times are drawn per cast from an injectable random source, on
 * this device only: fishing is a local activity like rowing's Food spend.
 * The fish themselves are shared (`seaLife.ts`): cast where a school is
 * swimming under the boat and the wait drops to a few seconds.
 */

import { railHalfWidthAt } from './boatHull';

/** Rod holders (boat frame x, z): port and starboard, forward of the mast. */
const ROD_Z = -1.8;
const ROD_X = Math.max(0.3, railHalfWidthAt(ROD_Z) - 0.45);
export const ROD_SPOTS: ReadonlyArray<[number, number]> = [[-ROD_X, ROD_Z], [ROD_X, ROD_Z]];

/** Mean wait for a bite (s) in deep water and in the shallows. */
export const BITE_WAIT_DEEP_S = 12;
export const BITE_WAIT_SHALLOW_S = 25;
/** Mean wait (s) with a school of fish swimming under the boat. */
export const BITE_WAIT_SCHOOL_S = 5;
/** Depths (m) that count as shallows and as deep water. */
const SHALLOW_M = 3;
const DEEP_M = 15;
/** Seconds the float stays down: time to hook the fish. */
export const BITE_WINDOW_S = 5;
/** Good strikes to land a fish, and bad ones before it throws the hook. */
export const FIGHT_HITS = 3;
export const FIGHT_MISSES = 2;
/** Highlighted zone width (fraction of the bar) for each round. */
export const FIGHT_ZONES: readonly number[] = [0.3, 0.22, 0.16];
/** Seconds for the marker to sweep across the bar and back, first round. */
export const FIGHT_SWEEP_S = 2.2;
/** Each good strike speeds the marker up by this factor. */
const FIGHT_SPEEDUP = 0.8;
/** A round with no strike for this long counts as a bad one. */
export const FIGHT_ROUND_S = 6;
/** Above this boat speed (m/s) nothing bites. */
export const TROLL_MAX_SPEED = 1.5;
/** Seconds the catch / got-away note stays up. */
const NOTE_S = 2.5;

export type FishingPhase = 'idle' | 'waiting' | 'bite' | 'fight' | 'caught' | 'missed';

export interface FishFight {
  hits: number;
  misses: number;
  /** Highlighted zone: centre and width as fractions of the bar. */
  zoneC: number;
  zoneW: number;
  /** Shared-clock time this round began, and the marker's sweep time. */
  roundAt: number;
  sweep: number;
  /** Where along its sweep the marker started this round (0..1). */
  start: number;
  /** The last strike and when, for a flash on the bar. */
  last: 'hit' | 'miss' | null;
  lastAt: number;
}

export interface FishingState {
  phase: FishingPhase;
  /** Shared-clock time the phase began. */
  since: number;
  /** When the next bite comes (waiting only). */
  biteAt: number;
  /** True while the boat is too fast for a bite. */
  tooFast: boolean;
  catches: number;
  /** The fight while a fish is on (phase 'fight'), else null. */
  fight: FishFight | null;
}

/**
 * Mean seconds to a bite at `depth` metres of water. With a school of
 * fish under the boat (`sea/seaLife.ts`) they come much sooner.
 */
export function meanBiteWait(depth: number, schoolNear = false): number {
  if (schoolNear) return BITE_WAIT_SCHOOL_S;
  const d = Math.max(0, depth);
  const u = Math.min(1, Math.max(0, (d - SHALLOW_M) / (DEEP_M - SHALLOW_M)));
  return BITE_WAIT_SHALLOW_S + (BITE_WAIT_DEEP_S - BITE_WAIT_SHALLOW_S) * u;
}

const state: FishingState = { phase: 'idle', since: 0, biteAt: Infinity, tooFast: false, catches: 0, fight: null };
let rng: () => number = Math.random;
let reward: () => void = () => {};
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

export function subscribeFishing(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getFishing(): Readonly<FishingState> {
  return state;
}

/** Where a catch goes (the scene credits Food); swapped in tests. */
export function setFishingReward(fn: (() => void) | null): void {
  reward = fn ?? (() => {});
}

/** Random source for bite times; swapped in tests. */
export function setFishingRandom(fn: (() => number) | null): void {
  rng = fn ?? Math.random;
}

function to(phase: FishingPhase, t: number): void {
  state.phase = phase;
  state.since = t;
  if (phase !== 'waiting') state.biteAt = Infinity;
  if (phase !== 'fight') state.fight = null;
  emit();
}

/** Cast at shared time `t` over `depth` metres of water. */
export function cast(t: number, depth: number, schoolNear = false): void {
  // Exponential wait: bites come at random, more often in deep water.
  const u = Math.min(0.999999, Math.max(1e-6, rng()));
  state.biteAt = t + 1.5 - Math.log(1 - u) * meanBiteWait(depth, schoolNear);
  state.phase = 'waiting';
  state.since = t;
  emit();
}

/** A new round of the fight: a fresh zone, the marker set off from an end. */
function newRound(f: FishFight, t: number): void {
  const w = FIGHT_ZONES[Math.min(f.hits, FIGHT_ZONES.length - 1)];
  f.zoneW = w;
  f.zoneC = w / 2 + 0.05 + rng() * (1 - w - 0.1);
  f.roundAt = t;
  f.start = rng() < 0.5 ? 0 : 0.5;
}

/** Marker position along the bar (0..1) at shared time `t`. */
export function markerAt(t: number, f: FishFight | null = state.fight): number {
  if (!f) return 0;
  const k = ((t - f.roundAt) / f.sweep + f.start) % 1;
  const u = k < 0 ? k + 1 : k;
  // Across and back: 0 → 1 → 0 over one sweep.
  return u < 0.5 ? u * 2 : 2 - u * 2;
}

/** True when the marker sits inside the highlighted zone at `t`. */
export function markerInZone(t: number, f: FishFight | null = state.fight): boolean {
  if (!f) return false;
  return Math.abs(markerAt(t, f) - f.zoneC) <= f.zoneW / 2;
}

/**
 * Reel at `t`. While the float is down this hooks the fish and starts the
 * fight (returns false: nothing landed yet). With the line out and no bite
 * it just winds in.
 */
export function reel(t: number): boolean {
  if (state.phase === 'bite' && t - state.since <= BITE_WINDOW_S) {
    const f: FishFight = { hits: 0, misses: 0, zoneC: 0.5, zoneW: FIGHT_ZONES[0], roundAt: t, sweep: FIGHT_SWEEP_S, start: 0, last: null, lastAt: t };
    newRound(f, t);
    state.fight = f;
    to('fight', t);
    return false;
  }
  if (state.phase === 'waiting' || state.phase === 'bite') to('idle', t);
  return false;
}

/** A bad strike (or a round left too long): two and the fish is off. */
function badStrike(f: FishFight, t: number): 'miss' | 'lost' {
  f.misses++;
  f.last = 'miss';
  f.lastAt = t;
  if (f.misses >= FIGHT_MISSES) { to('missed', t); return 'lost'; }
  newRound(f, t);
  emit();
  return 'miss';
}

/**
 * Strike during the fight at `t`: good inside the highlighted zone, bad
 * outside it. Returns what happened: a good strike, a bad one, the fish
 * landed (+1 Food), or the fish lost.
 */
export function strike(t: number): 'hit' | 'miss' | 'landed' | 'lost' | null {
  const f = state.fight;
  if (state.phase !== 'fight' || !f) return null;
  if (!markerInZone(t, f)) return badStrike(f, t);
  f.hits++;
  f.last = 'hit';
  f.lastAt = t;
  if (f.hits >= FIGHT_HITS) {
    state.catches++;
    try { reward(); } catch { /* ignore */ }
    to('caught', t);
    return 'landed';
  }
  f.sweep *= FIGHT_SPEEDUP;
  newRound(f, t);
  emit();
  return 'hit';
}

/** The one press: cast, hook, strike, or wind in, as the moment needs. */
export function castOrReel(t: number, depth: number, schoolNear = false): void {
  if (state.phase === 'fight') strike(t);
  else if (state.phase === 'waiting' || state.phase === 'bite') reel(t);
  else cast(t, depth, schoolNear);
}

/** Advance at shared time `t` with the boat making `speed` m/s. */
export function updateFishing(t: number, speed: number): void {
  const fast = Math.abs(speed) > TROLL_MAX_SPEED;
  if (fast !== state.tooFast) { state.tooFast = fast; emit(); }
  if (state.phase === 'waiting') {
    // A fast boat drags the bite time along with it.
    if (fast) state.biteAt = Math.max(state.biteAt, t + 1.5);
    else if (t >= state.biteAt) to('bite', t);
  } else if (state.phase === 'bite' && t - state.since > BITE_WINDOW_S) {
    to('missed', t);
  } else if (state.phase === 'fight' && state.fight && t - state.fight.roundAt > FIGHT_ROUND_S) {
    badStrike(state.fight, t);
  } else if ((state.phase === 'caught' || state.phase === 'missed') && t - state.since > NOTE_S) {
    to('idle', t);
  }
}

/** Put the rod down (leaving the station). */
export function stopFishing(t = 0): void {
  if (state.phase !== 'idle') to('idle', t);
}

export function _resetFishingForTest(): void {
  state.phase = 'idle';
  state.since = 0;
  state.biteAt = Infinity;
  state.tooFast = false;
  state.catches = 0;
  state.fight = null;
  rng = Math.random;
  reward = () => {};
}
