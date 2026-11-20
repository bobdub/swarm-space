/**
 * boatDeck — a boat's deck as a walkable surface with walls.
 *
 * The deck outline is the same one `BoatMesh` draws (`boatHull.ts`). Its
 * height comes from the boat's floating state each time it is asked, so
 * when the boat rides the swell or settles under load the floor under
 * your feet moves with it.
 *
 * Walls, by where your feet are:
 * - On the deck (feet between deck level and the rail top): the rail
 *   keeps you aboard, except at the gate on each side midships and the
 *   opening onto the stern ladder.
 * - Beside the boat at deck level (the jetty): the rail keeps you off,
 *   except through a gate.
 * - Below deck level (swimming): the hull is solid; you climb aboard by
 *   the ladder.
 * - Above the rail top (mid-jump): no walls, you can leap over.
 */

import type { Vec3 } from '../earth';
import { BOAT_RAIL_H } from './boatSpec';
import {
  HALF_L,
  LADDER_HALF,
  deckHalfWidthAt,
  hullHalfBeam,
  isGateZ,
  railHalfWidthAt,
  tAt,
} from './boatHull';
import { DECK_STEP_UP, type DeckSurface } from './deckSupport';

export interface BoatFrame {
  /** Earth-local unit normal under the boat's centre. */
  center: Vec3;
  /** Earth-local unit tangent the bow points along. */
  heading: Vec3;
}

/** Boat-frame coordinates of an Earth-local normal: x starboard, z aft (m). */
export function toBoatFrame(frame: BoatFrame, n: Vec3, radius: number): { x: number; z: number } {
  const { center: c, heading: h } = frame;
  const s = starboard(frame);
  const d: Vec3 = [n[0] - c[0], n[1] - c[1], n[2] - c[2]];
  return {
    x: (d[0] * s[0] + d[1] * s[1] + d[2] * s[2]) * radius,
    z: -(d[0] * h[0] + d[1] * h[1] + d[2] * h[2]) * radius,
  };
}

/** Earth-local unit normal at boat-frame (x, z). */
export function fromBoatFrame(frame: BoatFrame, x: number, z: number, radius: number): Vec3 {
  const { center: c, heading: h } = frame;
  const s = starboard(frame);
  const v: Vec3 = [
    c[0] + (x * s[0] - z * h[0]) / radius,
    c[1] + (x * s[1] - z * h[1]) / radius,
    c[2] + (x * s[2] - z * h[2]) / radius,
  ];
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function starboard(frame: BoatFrame): Vec3 {
  // right = forward × up
  const { center: n, heading: t } = frame;
  const v: Vec3 = [
    t[1] * n[2] - t[2] * n[1],
    t[2] * n[0] - t[0] * n[2],
    t[0] * n[1] - t[1] * n[0],
  ];
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** z nearest the bow where a body of `radius` still fits between the rails. */
function bowLimit(radius: number): number {
  for (let z = -HALF_L; z < 0; z += 0.02) {
    if (railHalfWidthAt(z) >= radius + 0.05) return z;
  }
  return 0;
}

/**
 * Pure wall rule in the boat frame. Returns the corrected (x, z), or null
 * when nothing pushes. `feetAboveDeck` is feet elevation minus deck top.
 */
export function confineInBoatFrame(
  x: number,
  z: number,
  feetAboveDeck: number,
  radius: number,
): { x: number; z: number } | null {
  if (feetAboveDeck > BOAT_RAIL_H) return null; // clearing the rail mid-jump
  const ax = Math.abs(x);
  const sign = x < 0 ? -1 : 1;

  if (feetAboveDeck >= -DECK_STEP_UP) {
    // Deck level.
    const inside = z >= -HALF_L && z <= HALF_L && ax < railHalfWidthAt(z);
    if (inside) {
      let nx = x;
      let nz = z;
      const zBow = bowLimit(radius);
      if (nz < zBow) nz = zBow;
      if (nz > HALF_L - radius && Math.abs(nx) > LADDER_HALF - 0.05) nz = HALF_L - radius;
      if (!isGateZ(nz)) {
        const xMax = Math.max(0, railHalfWidthAt(nz) - radius);
        if (Math.abs(nx) > xMax) nx = sign * xMax;
      }
      return nx !== x || nz !== z ? { x: nx, z: nz } : null;
    }
    // Outside, at deck level (on the jetty beside the boat): the rail
    // keeps you out except through a gate.
    if (z >= -HALF_L && z <= HALF_L && !isGateZ(z)) {
      const edge = railHalfWidthAt(z) + radius;
      if (ax < edge) return { x: sign * edge, z };
    }
    return null;
  }

  // Below deck level: the hull is solid.
  if (z < -HALF_L || z > HALF_L + radius) return null;
  const zc = Math.min(HALF_L, z);
  const hb = hullHalfBeam(tAt(zc)) + radius;
  if (ax >= hb) return null;
  const sidePen = hb - ax;
  const sternPen = HALF_L + radius - z;
  if (sternPen < sidePen) return { x, z: HALF_L + radius };
  return { x: (x === 0 ? 1 : sign) * hb, z };
}

/**
 * The deck of a boat at `frame()`, `top()` metres above sea level right now.
 */
export function boatDeck(opts: {
  id: string;
  /** Where the boat is now; read on every query, so the deck moves with it. */
  frame: () => BoatFrame;
  radius: number;
  top: () => number;
}): DeckSurface {
  const { radius } = opts;
  const reach = Math.hypot(HALF_L + 1, 2) / radius;
  const minDot = Math.cos(reach);
  const near = (frame: BoatFrame, n: Vec3) =>
    n[0] * frame.center[0] + n[1] * frame.center[1] + n[2] * frame.center[2] >= minDot;
  return {
    id: opts.id,
    elevationAt(n: Vec3): number | null {
      const frame = opts.frame();
      if (!near(frame, n)) return null;
      const { x, z } = toBoatFrame(frame, n, radius);
      if (Math.abs(x) > deckHalfWidthAt(z)) return null;
      // The rail line is a hair wider than the planks; a walker held at the
      // rail stands on the deck, not on the water between them.
      return opts.top();
    },
    confine(n: Vec3, feet: number, bodyRadius: number): Vec3 | null {
      const frame = opts.frame();
      if (!near(frame, n)) return null;
      const { x, z } = toBoatFrame(frame, n, radius);
      const next = confineInBoatFrame(x, z, feet - opts.top(), bodyRadius);
      if (!next) return null;
      // Move by the correction only, so the radial part of n is untouched.
      const from = fromBoatFrame(frame, x, z, radius);
      const to = fromBoatFrame(frame, next.x, next.z, radius);
      const v: Vec3 = [n[0] + to[0] - from[0], n[1] + to[1] - from[1], n[2] + to[2] - from[2]];
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    },
  };
}
