/**
 * deckSupport — walkable surfaces that stand above the sea: the village
 * jetty now, boat decks later.
 *
 * A deck is ground. `supportElevationAt` (groundHeight.ts) takes the
 * highest of the terrain, the swim level and any deck under the point, so
 * the physics floor, every avatar's feet and the camera guard all read the
 * same surface. Nothing here writes the field or moves a body.
 *
 * Decks are described in Earth-local coordinates (the frame that spins
 * with the planet), so a static deck never needs updating.
 *
 * A deck only holds you up when your feet are at its level or above
 * (within `DECK_STEP_UP`): a swimmer under the jetty stays in the water
 * instead of popping up through the planks. A deck can also have walls
 * (`confine`), such as a boat's rail and hull, applied by the physics
 * after each step the same way trees and builder walls push a walker out.
 */

import type { Vec3 } from '../earth';

/** How far below a deck's top your feet can be and still step onto it (m). */
export const DECK_STEP_UP = 0.45;

export interface DeckSurface {
  id: string;
  /** Elevation (m above sea level) of the walkable top at `localN`, or
   *  null when `localN` is not over this deck. `localN` is an Earth-local
   *  unit normal. */
  elevationAt(localN: Vec3): number | null;
  /** Optional walls. Given a walker's Earth-local unit normal, feet
   *  elevation (m above sea level) and body radius (m), return the
   *  corrected unit normal when a wall pushes them, else null. */
  confine?(localN: Vec3, feet: number, radius: number): Vec3 | null;
}

const decks = new Map<string, DeckSurface>();

export function registerDeckSurface(deck: DeckSurface): () => void {
  decks.set(deck.id, deck);
  return () => {
    if (decks.get(deck.id) === deck) decks.delete(deck.id);
  };
}

export function unregisterDeckSurface(id: string): void {
  decks.delete(id);
}

/**
 * Highest deck top over `localN` (m above sea level) that can hold feet at
 * `feet`, or −Infinity. With `feet` omitted every deck counts.
 */
export function deckElevationAt(localN: Vec3, feet?: number): number {
  let best = -Infinity;
  for (const deck of decks.values()) {
    const h = deck.elevationAt(localN);
    if (h === null || h <= best) continue;
    if (feet !== undefined && feet < h - DECK_STEP_UP) continue;
    best = h;
  }
  return best;
}

/** True when `localN` is over a registered deck (that can hold `feet`). */
export function isOverDeck(localN: Vec3, feet?: number): boolean {
  return deckElevationAt(localN, feet) > -Infinity;
}

/**
 * Apply every deck's walls to a walker. Returns the corrected Earth-local
 * unit normal, or null when no wall touched them.
 */
export function confineToDecks(localN: Vec3, feet: number, radius: number): Vec3 | null {
  let n = localN;
  let moved = false;
  for (const deck of decks.values()) {
    if (!deck.confine) continue;
    const next = deck.confine(n, feet, radius);
    if (next) { n = next; moved = true; }
  }
  return moved ? n : null;
}

/** True when any registered deck has walls (lets physics skip the pass). */
export function hasDeckWalls(): boolean {
  for (const deck of decks.values()) if (deck.confine) return true;
  return false;
}

export function _resetDecksForTest(): void {
  decks.clear();
}

/**
 * A straight rectangular deck laid along the sphere: `start` is the
 * Earth-local unit normal at one end, `dir` the unit tangent it runs
 * along, `length` and `width` in metres, `top` the walkable elevation.
 * Distances are measured on the tangent plane at `start`, which is exact
 * to a few millimetres over a 100 m jetty on the 1700 m planet.
 */
export function straightDeck(opts: {
  id: string;
  start: Vec3;
  dir: Vec3;
  length: number;
  width: number;
  top: number;
  radius: number;
}): DeckSurface {
  const { start, dir, length, width, top, radius } = opts;
  // Across axis = start × dir (a unit tangent perpendicular to dir).
  const across: Vec3 = [
    start[1] * dir[2] - start[2] * dir[1],
    start[2] * dir[0] - start[0] * dir[2],
    start[0] * dir[1] - start[1] * dir[0],
  ];
  const halfW = width / 2;
  // Cheap reject: angular radius of the whole deck around its start.
  const reach = Math.hypot(length, halfW) / radius;
  const minDot = Math.cos(reach * 1.05 + 1e-6);
  return {
    id: opts.id,
    elevationAt(n: Vec3): number | null {
      const dot = n[0] * start[0] + n[1] * start[1] + n[2] * start[2];
      if (dot < minDot) return null;
      const dx = n[0] - start[0];
      const dy = n[1] - start[1];
      const dz = n[2] - start[2];
      const along = (dx * dir[0] + dy * dir[1] + dz * dir[2]) * radius;
      if (along < 0 || along > length) return null;
      const side = (dx * across[0] + dy * across[1] + dz * across[2]) * radius;
      if (Math.abs(side) > halfW) return null;
      return top;
    },
  };
}
