/**
 * ═══════════════════════════════════════════════════════════════════════
 * TECTONIC PLATES — pure data layer over Earth's surface
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Deterministic 7-plate Voronoi tessellation on the unit sphere, hashed
 * from EARTH_POSITION so every client agrees. Plates are *data only* —
 * they never write to the field. They answer two questions:
 *
 *   plateAt(normal) → which plate covers this surface direction?
 *   boundaryInfo(normal) → distance/kind of the nearest plate boundary?
 *
 * Phases 3 (mountains) and 4 (volcanoes) consume this. The lava mantle
 * also consults it spatially to bias its pin depth at convergent /
 * divergent boundaries — but the pin write itself stays inside the
 * mantle module.
 */
import { EARTH_POSITION } from './earth';

export type BoundaryKind = 'convergent' | 'divergent' | 'transform';

export interface Plate {
  id: number;
  /** Unit-vector centre on the sphere. */
  centerNormal: [number, number, number];
  /** Tangent drift vector (unit-ish, mm/s sim time scale). */
  drift: [number, number, number];
}

export interface BoundaryInfo {
  /** Owning plate id. */
  plateId: number;
  /** Neighbour plate id at the nearest boundary. */
  neighbourId: number;
  /** Angular distance (radians) from `normal` to the nearest boundary. */
  boundaryDistance: number;
  /** Convergent / divergent / transform, derived from drift dot. */
  boundaryKind: BoundaryKind;
}

const PLATE_COUNT = 7;

function hash32(seed: number, salt: number): number {
  let h = (seed ^ (salt + 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function rand01(seed: number, salt: number): number {
  return hash32(seed, salt) / 0x1_0000_0000;
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

function computePlates(): Plate[] {
  const seed =
    (Math.round(EARTH_POSITION[0]) ^
      (Math.round(EARTH_POSITION[2]) << 8)) >>>
    0;
  const plates: Plate[] = [];
  for (let i = 0; i < PLATE_COUNT; i++) {
    // Fibonacci-sphere-ish placement, jittered by the seed for variety.
    const u = (i + 0.5) / PLATE_COUNT;
    const phi = Math.acos(1 - 2 * u);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i + rand01(seed, i * 3) * 0.6;
    const centerNormal = normalize3([
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta),
    ]);
    // Drift: any tangent direction. Build by projecting a hashed vector.
    const raw: [number, number, number] = [
      rand01(seed, i * 7 + 1) - 0.5,
      rand01(seed, i * 7 + 2) - 0.5,
      rand01(seed, i * 7 + 3) - 0.5,
    ];
    const dot =
      raw[0] * centerNormal[0] +
      raw[1] * centerNormal[1] +
      raw[2] * centerNormal[2];
    const drift = normalize3([
      raw[0] - centerNormal[0] * dot,
      raw[1] - centerNormal[1] * dot,
      raw[2] - centerNormal[2] * dot,
    ]);
    plates.push({ id: i, centerNormal, drift });
  }
  return plates;
}

let _plates: Plate[] | null = null;
export function getPlates(): Plate[] {
  if (!_plates) _plates = computePlates();
  return _plates;
}

/** Owning plate id for a surface normal (Voronoi nearest-centre). */
export function plateAt(normal: [number, number, number]): number {
  const ps = getPlates();
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < ps.length; i++) {
    const c = ps[i].centerNormal;
    const d = c[0] * normal[0] + c[1] * normal[1] + c[2] * normal[2];
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  }
  return best;
}

/** Boundary info for a surface normal — distance is angular (radians). */
export function boundaryInfo(
  normal: [number, number, number],
): BoundaryInfo {
  const ps = getPlates();
  let bestId = 0;
  let bestDot = -Infinity;
  let secondId = 0;
  let secondDot = -Infinity;
  for (let i = 0; i < ps.length; i++) {
    const c = ps[i].centerNormal;
    const d = c[0] * normal[0] + c[1] * normal[1] + c[2] * normal[2];
    if (d > bestDot) {
      secondDot = bestDot;
      secondId = bestId;
      bestDot = d;
      bestId = i;
    } else if (d > secondDot) {
      secondDot = d;
      secondId = i;
    }
  }
  // Approx. angular distance to the perpendicular bisector (boundary):
  // half the angular gap to the second-nearest centre.
  const angToSecond = Math.acos(Math.max(-1, Math.min(1, secondDot)));
  const angToBest = Math.acos(Math.max(-1, Math.min(1, bestDot)));
  const boundaryDistance = Math.max(0, (angToSecond - angToBest) * 0.5);

  // Convergent if drift vectors point toward each other across the seam.
  const a = ps[bestId];
  const b = ps[secondId];
  // Seam normal (from a to b along the sphere).
  const seam = normalize3([
    b.centerNormal[0] - a.centerNormal[0],
    b.centerNormal[1] - a.centerNormal[1],
    b.centerNormal[2] - a.centerNormal[2],
  ]);
  const aAlong = a.drift[0] * seam[0] + a.drift[1] * seam[1] + a.drift[2] * seam[2];
  const bAlong = b.drift[0] * seam[0] + b.drift[1] * seam[1] + b.drift[2] * seam[2];
  // a moves toward b (aAlong > 0), b moves toward a (bAlong < 0) → convergent.
  const closing = aAlong - bAlong;
  let boundaryKind: BoundaryKind;
  if (closing > 0.25) boundaryKind = 'convergent';
  else if (closing < -0.25) boundaryKind = 'divergent';
  else boundaryKind = 'transform';

  return { plateId: bestId, neighbourId: secondId, boundaryDistance, boundaryKind };
}
