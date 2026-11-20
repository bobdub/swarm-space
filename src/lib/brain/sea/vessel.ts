/**
 * vessel — how a boat floats.
 *
 * Phase 2 covers the vertical only: buoyancy against weight. The hull
 * sinks until the water it pushes aside weighs as much as the boat and
 * everyone on it (Archimedes). Each extra kilogram sinks it by
 * 1 / (ρ · A_wp) metres, where A_wp is the hull's waterplane area from
 * `boatHull.ts`. The heave is a damped spring on that balance, stepped on
 * the physics clock, so a boat that is loaded settles rather than snaps.
 *
 * The swell on top of it is a shared-clock sine (`swellAt`), identical on
 * every peer, and the same number lifts the drawn deck and the walkable
 * deck, so feet and planks never part.
 *
 * Sailing (wind, wheel, oars) arrives in Phase 3 and adds horizontal state
 * to this same module.
 */

import { BOAT_DECK_Y, BOAT_DRAFT } from './boatSpec';
import { WATERPLANE_AREA } from './boatHull';

/** Sea water density (kg/m³). */
export const WATER_DENSITY = 1025;
export const GRAVITY = 9.81;
/** Mass of one person aboard (kg). */
export const PERSON_KG = 80;
/** Lowest freeboard (deck above water, m) at which anyone may still board. */
export const MIN_FREEBOARD = 0.2;
/** Empty boat displacement at its design draft (kg): the water its hull
 *  pushes aside at 0.6 m draft, with a block coefficient for a round
 *  bilge open boat. */
export const BOAT_EMPTY_KG = WATER_DENSITY * WATERPLANE_AREA * BOAT_DRAFT * 0.42;

/** Extra sinkage (m) for `loadKg` on board, at rest. */
export function restSinkFor(loadKg: number): number {
  return Math.max(0, loadKg) / (WATER_DENSITY * WATERPLANE_AREA);
}

/** Freeboard (m) at rest with `people` aboard. */
export function freeboardFor(people: number): number {
  return BOAT_DECK_Y - restSinkFor(people * PERSON_KG);
}

/** How many people the boat carries before freeboard drops under the limit. */
export const BOAT_CAPACITY = Math.floor(
  ((BOAT_DECK_Y - MIN_FREEBOARD) * WATER_DENSITY * WATERPLANE_AREA) / PERSON_KG,
);

/** True when one more person could board a boat already carrying `people`. */
export function canBoard(people: number): boolean {
  return freeboardFor(people + 1) >= MIN_FREEBOARD;
}

/** Shared-clock swell (m) at time `t` (s), with a per-boat phase. */
export function swellAt(t: number, phase = 0): number {
  return 0.07 * Math.sin(t * 0.9 + phase) + 0.03 * Math.sin(t * 2.3 + 1.1 + phase * 1.7);
}

/** Small roll/pitch (rad) for the drawn hull; the deck stays level. */
export function swellTiltAt(t: number, phase = 0): { roll: number; pitch: number } {
  return {
    roll: 0.025 * Math.sin(t * 0.7 + 0.4 + phase),
    pitch: 0.012 * Math.sin(t * 1.1 + 2.0 + phase),
  };
}

export interface HeaveState {
  /** Sinkage below the design waterline from load (m, + = deeper). */
  sink: number;
  /** Rate of change of sink (m/s). */
  rate: number;
}

/**
 * One heave step. Restoring force ρ·g·A_wp·(sinkRest − sink) against the
 * boat-plus-load mass, critically damped so it settles in a couple of
 * seconds without bouncing.
 */
export function stepHeave(state: HeaveState, loadKg: number, dt: number): HeaveState {
  const mass = BOAT_EMPTY_KG + Math.max(0, loadKg);
  const k = WATER_DENSITY * GRAVITY * WATERPLANE_AREA;
  const omega = Math.sqrt(k / mass);
  const target = restSinkFor(loadKg);
  const acc = omega * omega * (target - state.sink) - 2 * omega * state.rate;
  // Semi-implicit Euler: stable at the 60 Hz physics step for ω ≈ 4 rad/s.
  const rate = state.rate + acc * dt;
  const sink = state.sink + rate * dt;
  return { sink, rate };
}

/**
 * A boat's floating state. One instance per boat; the moored village boat
 * is `getVillageBoat()`.
 */
export class Vessel {
  readonly id: string;
  readonly phase: number;
  heave: HeaveState = { sink: 0, rate: 0 };
  people = 0;

  constructor(id: string, phase = 0) {
    this.id = id;
    this.phase = phase;
  }

  setPeople(n: number): void {
    this.people = Math.max(0, Math.floor(n));
  }

  step(dt: number): void {
    this.heave = stepHeave(this.heave, this.people * PERSON_KG, dt);
  }

  /** Waterline offset of the boat frame at time t (m): swell − load sink. */
  waterlineAt(t: number): number {
    return swellAt(t, this.phase) - this.heave.sink;
  }

  /** Walkable deck elevation above sea level at time t (m). */
  deckTopAt(t: number): number {
    return BOAT_DECK_Y + this.waterlineAt(t);
  }

  freeboard(): number {
    return BOAT_DECK_Y - this.heave.sink;
  }

  canBoard(): boolean {
    return canBoard(this.people);
  }
}

let village: Vessel | null = null;

export function getVillageBoat(): Vessel {
  if (!village) village = new Vessel('village-boat', 0);
  return village;
}

export function _resetVillageBoatForTest(): void {
  village = null;
}
