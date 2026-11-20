/**
 * boatHull — the hull's shape as plain numbers, shared by the mesh that
 * draws it and the physics that stands people on it, so the deck you see
 * and the deck you walk on are the same outline.
 *
 * Boat frame: +x starboard, +y up (y = 0 is the design waterline),
 * +z aft. The bow is at z = −BOAT_LENGTH/2. `t` runs 0 (bow) → 1 (stern).
 */

import { BOAT_BEAM, BOAT_DECK_Y, BOAT_DRAFT, BOAT_GATE_HALF, BOAT_LENGTH } from './boatSpec';

export const HALF_L = BOAT_LENGTH / 2;

/** Half the hull's width at the gunwale, t ∈ [0,1] bow → stern. */
export function hullHalfBeam(t: number): number {
  const max = BOAT_BEAM / 2;
  const c = Math.min(1, Math.max(0, t));
  if (c < 0.45) return max * Math.pow(Math.sin(((c / 0.45) * Math.PI) / 2), 0.75);
  const u = (c - 0.45) / 0.55;
  return max * (1 - 0.18 * u * u);
}

export function gunwaleY(t: number): number {
  return BOAT_DECK_Y + 0.22 + 0.35 * (1 - t) * (1 - t) * (1 - t);
}

export function keelY(t: number): number {
  const rise = Math.max(0, (0.22 - t) / 0.22);
  return -BOAT_DRAFT + 1.1 * rise * rise;
}

export function zAt(t: number): number {
  return -HALF_L + t * BOAT_LENGTH;
}

export function tAt(z: number): number {
  return (z + HALF_L) / BOAT_LENGTH;
}

/** Half-width of the walkable deck at boat-frame z (0 outside the hull). */
export function deckHalfWidthAt(z: number): number {
  if (z < -HALF_L || z > HALF_L) return 0;
  return hullHalfBeam(tAt(z)) * 0.94;
}

/** Half-width of the rail line at z. */
export function railHalfWidthAt(z: number): number {
  if (z < -HALF_L || z > HALF_L) return 0;
  return hullHalfBeam(tAt(z)) * 0.97;
}

/** True where the side rail has its gate (midships, both sides). */
export function isGateZ(z: number): boolean {
  return Math.abs(z) < BOAT_GATE_HALF;
}

/** Half-width of the stern opening onto the ladder. */
export const LADDER_HALF = 0.32;
/** Where the side rails stop before the stern (t), leaving the transom
 *  corners railed by the transom itself. */
export const STERN_RAIL_END_T = 0.93;

/**
 * Hull waterplane area at the design waterline (m²), integrated from the
 * same half-beam the mesh is lofted from. The waterline beam is a little
 * narrower than the gunwale beam (the topsides flare), taken as 0.85.
 */
export const WATERPLANE_AREA = (() => {
  const n = 200;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    // Below the waterline only where the keel is actually wet.
    if (keelY(t) >= 0) continue;
    a += 2 * hullHalfBeam(t) * 0.85 * (BOAT_LENGTH / n);
  }
  return a;
})();
