/**
 * ═══════════════════════════════════════════════════════════════════════
 * VOLCANO ORGAN — single source of truth for the village volcano
 * ═══════════════════════════════════════════════════════════════════════
 *
 * One descriptor consumed by mantle, terrain displacement, render overlay,
 * and collision sampler. The volcano is part of the Earth organism — same
 * normal, same elevation, same vent — never a separate floating prop.
 *
 * Selection: pick the closest convergent seam site to the village anchor
 * (within REACH). If none, use a deterministic fallback offset from the
 * village's local tangent frame.
 *
 * Geometry: a smooth Hermite cone of height `height`, base radius
 * `baseRadius` (in metres of arc length on the EARTH_RADIUS sphere), with
 * a recessed crater of `craterRadius` and depth `craterDepth`.
 */
import { EARTH_RADIUS, getEarthLocalSiteFrame, type Vec3 } from './earth';
import { getVolcanoSites } from './tectonics';
import { sampleLandMask, sampleSurfaceLift, WATER_WADE_DEPTH } from './surfaceProfile';

export interface VolcanoOrgan {
  /** Earth-local outward unit normal at the volcano centre. */
  centerNormal: [number, number, number];
  /** Cone base radius (m, arc length on the surface). */
  baseRadius: number;
  /** Peak elevation above the visible ground (m). */
  height: number;
  /** Crater rim inner radius (m). */
  craterRadius: number;
  /** Crater rim depression depth below peak (m). */
  craterDepth: number;
  /** Falloff (radians of angular distance) for the mantle pressure sink. */
  pressureRadius: number;
}

const REACH_M = 320;

const _cache = new Map<string, VolcanoOrgan>();

function pickCenterNormal(
  anchorId: string,
): [number, number, number] {
  const lf = getEarthLocalSiteFrame(anchorId);
  const sites = getVolcanoSites();
  let bestNormal: [number, number, number] | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < sites.length; i++) {
    const n = sites[i];
    const dotN = n[0] * lf.normal[0] + n[1] * lf.normal[1] + n[2] * lf.normal[2];
    if (dotN <= 0) continue;
    const dotR = n[0] * lf.right[0] + n[1] * lf.right[1] + n[2] * lf.right[2];
    const dotF = n[0] * lf.forward[0] + n[1] * lf.forward[1] + n[2] * lf.forward[2];
    const tx = dotR * EARTH_RADIUS;
    const tz = dotF * EARTH_RADIUS;
    const dist = Math.hypot(tx, tz);
    if (dist <= REACH_M && dist < bestDist) {
      bestDist = dist;
      bestNormal = [n[0], n[1], n[2]];
    }
  }
  if (bestNormal) return bestNormal;
  // Deterministic fallback: a single village-side normal offset on the
  // local tangent plane so the player always sees one volcano nearby.
  const offsetRight = 160;  // m of arc length
  const offsetForward = 90; // m of arc length
  const aRight = offsetRight / EARTH_RADIUS;
  const aFwd = offsetForward / EARTH_RADIUS;
  // Small-angle approximation: n' ≈ normal + right·θ_r + forward·θ_f, normalize.
  let nx = lf.normal[0] + lf.right[0] * aRight + lf.forward[0] * aFwd;
  let ny = lf.normal[1] + lf.right[1] * aRight + lf.forward[1] * aFwd;
  let nz = lf.normal[2] + lf.right[2] * aRight + lf.forward[2] * aFwd;
  const nn = Math.hypot(nx, ny, nz) || 1;
  return snapNormalToLandLocal([nx / nn, ny / nn, nz / nn], lf);
}

/**
 * Spiral the seed normal across the village's tangent plane until we
 * hit a land cell. Without this the volcano can choose an ocean spot
 * (it then renders blue and looks like a wave instead of a mountain).
 * Search stays inside the village basin so the volcano remains visible
 * from the apartment.
 */
function snapNormalToLandLocal(
  seed: [number, number, number],
  lf: { normal: [number, number, number]; right: [number, number, number]; forward: [number, number, number] },
  threshold = 0.6,
): [number, number, number] {
  if (sampleLandMask(seed) >= threshold) return seed;
  const STEPS = 96;
  const MAX_ARC = 700; // m — keeps the volcano in eyesight of the village
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const arc = MAX_ARC * t;
    const theta = t * Math.PI * 6;
    const aR = (Math.cos(theta) * arc) / EARTH_RADIUS;
    const aF = (Math.sin(theta) * arc) / EARTH_RADIUS;
    let nx = lf.normal[0] + lf.right[0] * aR + lf.forward[0] * aF;
    let ny = lf.normal[1] + lf.right[1] * aR + lf.forward[1] * aF;
    let nz = lf.normal[2] + lf.right[2] * aR + lf.forward[2] * aF;
    const nn = Math.hypot(nx, ny, nz) || 1;
    const cand: [number, number, number] = [nx / nn, ny / nn, nz / nn];
    if (sampleLandMask(cand) >= threshold) return cand;
  }
  return seed;
}

export function getVolcanoOrgan(anchorId: string): VolcanoOrgan {
  const cached = _cache.get(anchorId);
  if (cached) return cached;
  let centerNormal = pickCenterNormal(anchorId);
  // Final guard: if the seam-derived center still sits over water, snap
  // it to nearby land using the village frame so the volcano is built
  // ON the continent, not in the sea.
  const lf = getEarthLocalSiteFrame(anchorId);
  centerNormal = snapNormalToLandLocal(centerNormal, lf);
  const organ: VolcanoOrgan = {
    centerNormal,
    // Sized so the cone spans many sphere vertices on the 256-segment
    // Earth mesh. The previous 60 m base fell *between* vertices on a
    // 48-seg sphere and read as a flat patch — only the floating
    // overlay (plume/glow) remained visible, looking like a free prop.
    baseRadius: 220,   // m — wide enough to read as terrain at horizon
    height: 90,        // m — taller than tree-line, dominates the village
    craterRadius: 32,  // m — recessed bowl at the peak
    craterDepth: 14,   // m
    pressureRadius: 0.18, // rad — angular falloff of mantle sink
  };
  _cache.set(anchorId, organ);
  return organ;
}

/**
 * Anchor id used by every consumer for the shared village volcano. Keep
 * in sync with `SHARED_VILLAGE_ANCHOR_ID` in `BrainUniverseScene.tsx`.
 */
export const SHARED_VOLCANO_ANCHOR_ID = 'swarm-shared-village';

/**
 * Local elevation (metres) above the visible ground at an Earth-LOCAL
 * unit normal. Combines a smooth cone uplift with a crater depression so
 * the same function drives vertex displacement, collision shells, and
 * mantle vent placement.
 *
 *   h(θ) = cone(θ) − crater(θ)
 *
 * where θ is the great-circle angular distance from the volcano centre.
 */
export function sampleVolcanoElevation(
  organ: VolcanoOrgan,
  localNormal: [number, number, number],
): number {
  const dot = Math.max(-1, Math.min(1,
    organ.centerNormal[0] * localNormal[0] +
    organ.centerNormal[1] * localNormal[1] +
    organ.centerNormal[2] * localNormal[2]));
  // Arc length on the visible sphere.
  const arc = Math.acos(dot) * EARTH_RADIUS;
  if (arc >= organ.baseRadius) return 0;
  // Cone profile — Hermite C¹ falloff from peak (1) at centre to 0 at base.
  const u = arc / Math.max(1e-6, organ.baseRadius);
  const cone = (1 - u) * (1 - u) * (3 - 2 * (1 - u)); // smooth peak→base
  const coneH = organ.height * cone;
  // Crater — subtract a small bowl near the centre.
  let craterH = 0;
  if (arc < organ.craterRadius) {
    const cu = arc / Math.max(1e-6, organ.craterRadius);
    const bowl = (1 - cu) * (1 - cu) * (3 - 2 * (1 - cu));
    craterH = organ.craterDepth * bowl;
  }
  return Math.max(0, coneH - craterH);
}

function smoothstep(min: number, max: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
  return t * t * (3 - 2 * t);
}

/**
 * Shared dry-ground classifier used by both movement physics and terrain
 * placement decisions. Physics already treats volcano uplift + land lift as
 * solid terrain; this mask makes water drag / colour follow that same rule.
 */
export function sampleTerrainDryMask(
  organ: VolcanoOrgan,
  localNormal: Vec3,
): number {
  const terrainLift = sampleSurfaceLift(localNormal) + sampleVolcanoElevation(organ, localNormal);
  const liftedGround = smoothstep(0.05, WATER_WADE_DEPTH, terrainLift);
  return Math.max(sampleLandMask(localNormal), liftedGround);
}
