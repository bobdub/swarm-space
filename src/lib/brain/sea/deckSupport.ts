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
 */

import type { Vec3 } from '../earth';

export interface DeckSurface {
  id: string;
  /** Elevation (m above sea level) of the walkable top at `localN`, or
   *  null when `localN` is not over this deck. `localN` is an Earth-local
   *  unit normal. */
  elevationAt(localN: Vec3): number | null;
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

/** Highest deck top over `localN` (m above sea level), or −Infinity. */
export function deckElevationAt(localN: Vec3): number {
  let best = -Infinity;
  for (const deck of decks.values()) {
    const h = deck.elevationAt(localN);
    if (h !== null && h > best) best = h;
  }
  return best;
}

/** True when `localN` is over a registered deck. */
export function isOverDeck(localN: Vec3): boolean {
  return deckElevationAt(localN) > -Infinity;
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
