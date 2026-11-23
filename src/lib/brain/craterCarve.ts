/**
 * craterCarve — the summit crater as real, walkable ground.
 *
 * The baked Earth mesh (`terrainMesh.ts`) has ~40 m cells, wider than the
 * 32 m crater, so on the mesh the summit is a few flat-ish triangles. The
 * vent used to be painted onto that lid (a stencil window), so the crater
 * looked open but walked like solid ground: you could stroll across the
 * vent, never look down into it and never fall in.
 *
 * This module carves the crater for real, ONE surface for every consumer:
 *
 * - Bowl (neck radius a ≤ s ≤ rim radius R, s = arc distance from the vent):
 *   the baked ground blended down to a flat floor ring,
 *     e(s) = baked + (floor − baked)·w(s),  w = smoothstep(R → a),
 *   C¹ at the rim (meets the Earth mesh with no step) and level at the neck.
 * - Vent (s < a): an open shaft down the magma conduit. There is no ground
 *   until the magma head (`magmaLevelAt`), so you fall to the lava.
 *
 * The renderer cuts the crater out of the Earth mesh and draws
 * `buildCraterPatchGeometry` (terrainGeometry.ts) from these same heights;
 * physics stands on `groundElevationAt` (groundHeight.ts), which routes
 * here. Same function, same surface: the render and physics operators
 * still commute.
 */
import { EARTH_RADIUS, getEarthPoseTime, type Vec3 } from './earth';
import { sampleTerrainLift } from './terrainMesh';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from './volcanoOrgan';
import { LAVA_DEPTH_M } from './volcanoEffects';
import { throatRadius } from './magmaConduit';
import { magmaLevelAt } from './eruptionCycle';

/** How far the crater floor ring sits below the baked vent ground (m). */
export const CRATER_FLOOR_DEPTH_M = 12;
/** Shaft wall clearance: how close a body's centre may get to the wall (m). */
export const VENT_WALL_CLEARANCE_M = 0.35;
/** Feet this far below the floor ring count as down the shaft (m). */
const SHAFT_ENTRY_M = 0.5;
/** A body down the shaft keeps the shaft floor this far past the wall,
 *  so one fast step past it never snaps the body up onto the bowl (m). */
const SHAFT_GRACE_M = 2;
/** Feet within this of the magma surface are in the lava (m). */
const LAVA_CONTACT_M = 0.2;

export interface CraterCarve {
  /** Earth-local unit normal at the vent. */
  center: Vec3;
  /** Rim radius R (m, arc). */
  rimR: number;
  /** Neck (vent) radius a (m, arc). */
  neckR: number;
  /** Elevation (m above sea level) of the crater-frame origin (lava frame). */
  originElev: number;
  /** Elevation (m above sea level) of the flat floor ring at the neck. */
  floorElev: number;
  /** cos of the rim's angular radius, for a cheap early-out. */
  cosRim: number;
  /** Elevation (m above sea level) of the lowest point on the rim: the
   *  spill point. Magma in the crater can never stand above it; it pours
   *  out there instead (the flank flows start at the rim's low saddles). */
  spillElev: number;
}

/** Azimuth samples used to find the rim's lowest point. */
const RIM_SAMPLES = 144;

let _carve: CraterCarve | null = null;

export function getCraterCarve(): CraterCarve {
  if (_carve) return _carve;
  const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
  const c = organ.centerNormal;
  const len = Math.hypot(c[0], c[1], c[2]) || 1;
  const center: Vec3 = [c[0] / len, c[1] / len, c[2] / len];
  const baked = sampleTerrainLift(center);
  // Lowest point on the rim: walk the rim circle on the baked ground.
  const ref: Vec3 = Math.abs(center[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let e1: Vec3 = [
    ref[1] * center[2] - ref[2] * center[1],
    ref[2] * center[0] - ref[0] * center[2],
    ref[0] * center[1] - ref[1] * center[0],
  ];
  const l1 = Math.hypot(e1[0], e1[1], e1[2]);
  e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const e2: Vec3 = [
    center[1] * e1[2] - center[2] * e1[1],
    center[2] * e1[0] - center[0] * e1[2],
    center[0] * e1[1] - center[1] * e1[0],
  ];
  const ang = organ.craterRadius / EARTH_RADIUS;
  let spillElev = Infinity;
  for (let i = 0; i < RIM_SAMPLES; i++) {
    const az = (i / RIM_SAMPLES) * Math.PI * 2;
    const ca = Math.cos(az), sa = Math.sin(az);
    const d: Vec3 = [0, 1, 2].map((j) =>
      center[j] * Math.cos(ang) + (e1[j] * ca + e2[j] * sa) * Math.sin(ang)) as Vec3;
    spillElev = Math.min(spillElev, sampleTerrainLift(d));
  }
  _carve = {
    center,
    rimR: organ.craterRadius,
    neckR: throatRadius(organ),
    originElev: baked + LAVA_DEPTH_M,
    floorElev: baked - CRATER_FLOOR_DEPTH_M,
    cosRim: Math.cos(organ.craterRadius / EARTH_RADIUS),
    spillElev,
  };
  return _carve;
}

/** Test hook: forget the cached crater (e.g. after a terrain reset). */
export function resetCraterCarve(): void {
  _carve = null;
}

/** Arc distance (m) from the vent, or Infinity outside the rim. */
export function craterArcAt(localN: Vec3): number {
  const k = getCraterCarve();
  const len = Math.hypot(localN[0], localN[1], localN[2]) || 1;
  const dot = (k.center[0] * localN[0] + k.center[1] * localN[1] + k.center[2] * localN[2]) / len;
  if (dot < k.cosRim) return Infinity;
  return Math.acos(Math.min(1, dot)) * EARTH_RADIUS;
}

/** Bowl weight: 0 at (and beyond) the rim, 1 at (and inside) the neck. */
export function craterBowlWeight(s: number): number {
  const k = getCraterCarve();
  const t = Math.max(0, Math.min(1, (k.rimR - s) / (k.rimR - k.neckR)));
  return t * t * (3 - 2 * t);
}

/**
 * Static carved ground (m above sea level): the bowl, and the floor ring's
 * level across the vent mouth (the plane the summit pond fills from).
 * Outside the rim it is the baked ground.
 */
export function carvedGroundAt(localN: Vec3, baked?: number): number {
  const s = craterArcAt(localN);
  const b = baked ?? sampleTerrainLift(localN);
  if (s === Infinity) return b;
  const k = getCraterCarve();
  return b + (k.floorElev - b) * craterBowlWeight(s);
}

/** True when `localN` is over the open vent. */
export function isOverVent(localN: Vec3): boolean {
  return craterArcAt(localN) < getCraterCarve().neckR;
}

/**
 * Magma level (m, crater frame) at shared time `t`, as it can actually
 * stand in the carved crater: never above the rim's spill point, where it
 * overflows down the flanks instead.
 */
export function craterMagmaLevelAt(t: number = getEarthPoseTime()): number {
  const k = getCraterCarve();
  const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
  return Math.min(magmaLevelAt(organ, t), k.spillElev - k.originElev);
}

/** Elevation (m above sea level) of the magma surface at shared time `t`. */
export function magmaSurfaceElevationAt(t: number = getEarthPoseTime()): number {
  return getCraterCarve().originElev + craterMagmaLevelAt(t);
}

/**
 * Solid support (m above sea level) at `localN`: the carved bowl, or over
 * the vent the magma head far down the shaft (never above the floor ring,
 * so the vent never bulges above the bowl floor). Pass the walker's `feet`
 * elevation where it is known (the physics does).
 */
export function craterGroundAt(localN: Vec3, t?: number, feet?: number): number {
  const s = craterArcAt(localN);
  if (s === Infinity) return sampleTerrainLift(localN);
  const k = getCraterCarve();
  // Feet already down the shaft are inside its walls (`containInVent`):
  // the bowl above is not their floor, even a step past the wall.
  const down = feet !== undefined && feet < k.floorElev - SHAFT_ENTRY_M;
  if (s < k.neckR || (down && s < k.neckR + SHAFT_GRACE_M)) {
    return Math.min(k.floorElev, magmaSurfaceElevationAt(t));
  }
  return carvedGroundAt(localN);
}

/**
 * A body whose feet are down the shaft is held inside its walls. Returns
 * the Earth-local unit normal to move the body to, or null if it is free
 * (not down the shaft, or already clear of the wall).
 */
export function containInVent(localN: Vec3, feet: number): Vec3 | null {
  const k = getCraterCarve();
  if (feet > k.floorElev - SHAFT_ENTRY_M) return null;
  const s = craterArcAt(localN);
  const maxS = k.neckR - VENT_WALL_CLEARANCE_M;
  // Clear of the wall, or nowhere near the shaft (anywhere else on Earth).
  if (s <= maxS || s >= k.neckR + SHAFT_GRACE_M) return null;
  const len = Math.hypot(localN[0], localN[1], localN[2]) || 1;
  const n: Vec3 = [localN[0] / len, localN[1] / len, localN[2] / len];
  const c = k.center;
  const dot = c[0] * n[0] + c[1] * n[1] + c[2] * n[2];
  // Tangent direction from the vent toward the body.
  let tx = n[0] - c[0] * dot, ty = n[1] - c[1] * dot, tz = n[2] - c[2] * dot;
  const tl = Math.hypot(tx, ty, tz);
  if (tl < 1e-12) return null;
  tx /= tl; ty /= tl; tz /= tl;
  const ang = maxS / EARTH_RADIUS;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  return [c[0] * ca + tx * sa, c[1] * ca + ty * sa, c[2] * ca + tz * sa];
}

/**
 * True when feet at elevation `feet` stand in molten magma at `localN`:
 * down the vent at the magma head, or in the summit pond when an eruption
 * floods the bowl.
 */
export function inMagmaAt(localN: Vec3, feet: number, t?: number): boolean {
  const s = craterArcAt(localN);
  if (s === Infinity) return false;
  const lava = magmaSurfaceElevationAt(t);
  const k = getCraterCarve();
  const floor = s < k.neckR ? lava : carvedGroundAt(localN);
  if (floor > lava) return false;
  return feet <= lava + LAVA_CONTACT_M;
}
