/**
 * crew — where this player stands on the boat's working stations, and the
 * raw controls they are giving.
 *
 * Roles: at the helm (the wheel and the sail), at the oars, or at a rod
 * holder fishing (`fishing.ts`). While in a
 * role the body is held at that station each physics tick (like a bar
 * stool, `seating.ts`) and the walking controls drive the boat instead.
 * Inputs are written by the on-screen controls and keyboard
 * (`ShipWheel.tsx`) and read by the boat each tick (`villageBoat.ts`).
 *
 * Rowing burns food. Each serving eaten carries the oars a set distance:
 * one unit of raw Food `ROW_METRES_PER_FOOD` metres, a cooked meal from
 * the fire pit's grill (`world/cooking.ts`) much further. The spend goes
 * through the bag, on this device only. With no food the oars stop pushing.
 */

import { stopFishing } from './fishing';

export type CrewRole = 'helm' | 'oars' | 'rod';

export interface CrewInput {
  /** Wheel target −1 … 1 (A/D, joystick left/right). 0 = let it centre. */
  wheel: number;
  /** Sail command: +1 raise, −1 lower, 0 hold. */
  sail: number;
  /** Oar stroke −1 … 1 (W/S, joystick fwd/back). */
  row: number;
  /** Oar turn −1 … 1 (A/D, joystick left/right). */
  rowTurn: number;
}

/** Metres of rowing per unit of Food. */
export const ROW_METRES_PER_FOOD = 60;
export const OUT_OF_FOOD_NOTE = 'Out of Food, so the oars won\'t pull. Fish from a rod and cook the catch on a fire pit, or gather fruit or honey.';

interface CrewState {
  role: CrewRole | null;
  /** Fleet key of the boat this role is on ('dock' = the berth's boat). */
  boatKey: string | null;
  selfId: string | null;
  /** Boat-frame (x, z) of a station with more than one place (rods). */
  spot: [number, number] | null;
  input: CrewInput;
  /** Metres rowed since the last Food was spent. */
  rowedSinceFood: number;
  /** Metres the last serving eaten is worth (the current leg's length). */
  legMetres: number;
  outOfFood: boolean;
}

const state: CrewState = {
  role: null,
  boatKey: null,
  selfId: null,
  spot: null,
  input: { wheel: 0, sail: 0, row: 0, rowTurn: 0 },
  rowedSinceFood: 0,
  legMetres: ROW_METRES_PER_FOOD,
  outOfFood: false,
};

const listeners = new Set<() => void>();
function emit() {
  for (const fn of listeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

export function subscribeCrew(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getCrewRole(): CrewRole | null {
  return state.role;
}

export function getCrewSelfId(): string | null {
  return state.selfId;
}

export function getCrewInput(): CrewInput {
  return state.input;
}

export function setCrewInput(patch: Partial<CrewInput>): void {
  Object.assign(state.input, patch);
}

export function getCrewBoatKey(): string | null {
  return state.boatKey;
}

/** The fleet re-keys the crew's boat when the dock boat becomes yours. */
export function setCrewBoatKey(key: string | null): void {
  state.boatKey = key;
}

export function getCrewSpot(): [number, number] | null {
  return state.spot;
}

export function takeRole(role: CrewRole, selfId: string, boatKey: string = 'dock', spot?: [number, number]): void {
  state.role = role;
  state.boatKey = boatKey;
  state.selfId = selfId;
  state.spot = spot ?? null;
  state.input = { wheel: 0, sail: 0, row: 0, rowTurn: 0 };
  emit();
}

export function leaveRole(): void {
  if (!state.role) return;
  state.role = null;
  state.boatKey = null;
  state.spot = null;
  mastHold = null;
  stopFishing();
  state.input = { wheel: 0, sail: 0, row: 0, rowTurn: 0 };
  emit();
}

/**
 * Holding the mast (touch or mouse on the boat's mast): +1 raising, −1
 * lowering, null not held. The direction is chosen when the hold starts:
 * a sail more than half down goes up, otherwise down.
 */
let mastHold: 1 | -1 | null = null;

export function startMastHold(currentSail: number): void {
  if (state.role !== 'helm') return;
  mastHold = currentSail < 0.5 ? 1 : -1;
  emit();
}

/** The on-screen sail buttons: hold to raise (+1) or lower (−1). */
export function holdSail(dir: 1 | -1): void {
  if (state.role !== 'helm') return;
  mastHold = dir;
  emit();
}

export function stopMastHold(): void {
  if (mastHold === null) return;
  mastHold = null;
  emit();
}

export function getMastHold(): 1 | -1 | null {
  return mastHold;
}

export function isOutOfFood(): boolean {
  return state.outOfFood;
}

/** How Food is spent and checked; swapped in tests. */
export interface FoodPurse {
  has(): boolean;
  /**
   * Eat one serving. `true` is one unit of raw Food (`ROW_METRES_PER_FOOD`
   * metres); a number is the metres of rowing the serving is worth (a
   * cooked meal); `false` or 0 means nothing could be eaten.
   */
  spendOne(): boolean | number;
}

let purse: FoodPurse | null = null;

export function setFoodPurse(p: FoodPurse | null): void {
  purse = p;
}

/** Can the rower pull right now? Updates the out-of-food flag. */
export function canRow(): boolean {
  const ok = purse ? purse.has() : false;
  if (state.outOfFood !== !ok) {
    state.outOfFood = !ok;
    emit();
  }
  return ok;
}

/** Metres of rowing a purse spend is worth (0 = nothing eaten). */
function servingMetres(spent: boolean | number): number {
  if (spent === true) return ROW_METRES_PER_FOOD;
  if (typeof spent === 'number' && Number.isFinite(spent) && spent > 0) return spent;
  return 0;
}

/**
 * Account for `metres` the boat moved under this rower's stroke. Eats a
 * serving each time the tally passes the current leg; the serving eaten
 * sets how long the next leg is (a cooked meal lasts longer than raw
 * Food). Returns false once a spend fails (out of food).
 */
export function chargeRowing(metres: number): boolean {
  state.rowedSinceFood += Math.max(0, metres);
  while (state.rowedSinceFood >= state.legMetres) {
    state.rowedSinceFood -= state.legMetres;
    const leg = purse ? servingMetres(purse.spendOne()) : 0;
    if (leg <= 0) {
      state.rowedSinceFood = 0;
      state.legMetres = ROW_METRES_PER_FOOD;
      if (!state.outOfFood) { state.outOfFood = true; emit(); }
      return false;
    }
    state.legMetres = leg;
  }
  return true;
}

export function _resetCrewForTest(): void {
  state.role = null;
  state.boatKey = null;
  state.selfId = null;
  state.spot = null;
  state.input = { wheel: 0, sail: 0, row: 0, rowTurn: 0 };
  state.rowedSinceFood = 0;
  state.legMetres = ROW_METRES_PER_FOOD;
  state.outOfFood = false;
  purse = null;
  mastHold = null;
}
