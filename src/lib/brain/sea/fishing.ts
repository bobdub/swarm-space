/**
 * fishing — a rod over the rail, so a crew becalmed far from land can
 * still eat (rowing burns Food; see `crew.ts`).
 *
 * Take a rod at either rod holder forward of the mast. Cast, wait for a
 * bite, and reel in while the fish is on: +1 Food, credited like any other
 * gathered Food (`recordHarvestForResource`). Miss the moment and it gets
 * away. Deeper water bites sooner than the shallows, and a boat making
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
/** Seconds the fish stays on the hook. */
export const BITE_WINDOW_S = 3;
/** Above this boat speed (m/s) nothing bites. */
export const TROLL_MAX_SPEED = 1.5;
/** Seconds the catch / got-away note stays up. */
const NOTE_S = 2.5;

export type FishingPhase = 'idle' | 'waiting' | 'bite' | 'caught' | 'missed';

export interface FishingState {
  phase: FishingPhase;
  /** Shared-clock time the phase began. */
  since: number;
  /** When the next bite comes (waiting only). */
  biteAt: number;
  /** True while the boat is too fast for a bite. */
  tooFast: boolean;
  catches: number;
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

const state: FishingState = { phase: 'idle', since: 0, biteAt: Infinity, tooFast: false, catches: 0 };
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

/** Reel in at `t`: lands the fish while it is on, else just winds in. */
export function reel(t: number): boolean {
  if (state.phase === 'bite' && t - state.since <= BITE_WINDOW_S) {
    state.catches++;
    try { reward(); } catch { /* ignore */ }
    to('caught', t);
    return true;
  }
  if (state.phase === 'waiting' || state.phase === 'bite') to('idle', t);
  return false;
}

/** The one press: cast when the line is in, reel when it is out. */
export function castOrReel(t: number, depth: number, schoolNear = false): void {
  if (state.phase === 'waiting' || state.phase === 'bite') reel(t);
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
  rng = Math.random;
  reward = () => {};
}
