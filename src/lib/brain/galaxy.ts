/**
 * ═══════════════════════════════════════════════════════════════════════
 * GALAXY — deterministic spiral pin template
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Pure function: same seed → same star positions on every node. Stars,
 * Earth, and the galactic core are written as pins into a Field3D so
 * they emerge as basins/ridges of ‖F_{μν}‖ rather than as glued-on
 * meshes. No network sync needed for the structure.
 */

import {
  pin3D,
  writePinTemplate,
  idx3,
  FIELD3D_AXES,
  FIELD3D_N,
  type Field3D,
} from '../uqrc/field3D';
import { worldToLattice, WORLD_SIZE } from './uqrcPhysics';
import { EARTH_POSITION, EARTH_PIN_AMPLITUDE, EARTH_RADIUS } from './earth';

export const GALAXY_SEED = 0x5eed1e;
export const GALAXY_ARMS = 8;
export const GALAXY_PITCH_DEG = 12;
export const GALAXY_RADIUS_INNER = 8;
export const GALAXY_RADIUS_OUTER = 22; // clamp inside WORLD_SIZE*0.45
export const GALAXY_STAR_COUNT = 120;
export const GALAXY_BG_STAR_COUNT = 3000;
export const GALAXY_CORE_TARGET = -0.6;
export const GALAXY_STAR_TARGET = 0.8;

export interface NamedStar {
  id: number;
  arm: number;
  pos: [number, number, number];
  brightness: number;
}

export interface BgStar {
  pos: [number, number, number];
  size: number;
}

export interface Galaxy {
  seed: number;
  stars: NamedStar[];
  bgStars: BgStar[];
  core: [number, number, number];
  earth: [number, number, number];
}

/** Mulberry32 — small fast deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildGalaxy(seed: number = GALAXY_SEED): Galaxy {
  const rand = mulberry32(seed);
  const stars: NamedStar[] = [];
  const pitch = (GALAXY_PITCH_DEG * Math.PI) / 180;
  const tan = Math.tan(pitch);
  const perArm = Math.floor(GALAXY_STAR_COUNT / GALAXY_ARMS);

  for (let arm = 0; arm < GALAXY_ARMS; arm++) {
    const armOffset = (arm / GALAXY_ARMS) * Math.PI * 2;
    for (let s = 0; s < perArm; s++) {
      const t = s / (perArm - 1); // 0..1
      const r = GALAXY_RADIUS_INNER + (GALAXY_RADIUS_OUTER - GALAXY_RADIUS_INNER) * t;
      // Logarithmic spiral: theta = ln(r/r0)/tan(pitch)
      const theta = armOffset + Math.log(r / GALAXY_RADIUS_INNER) / tan;
      const jitterR = (rand() - 0.5) * 1.4;
      const jitterT = (rand() - 0.5) * 0.18;
      const rr = r + jitterR;
      const tt = theta + jitterT;
      const x = Math.cos(tt) * rr;
      const z = Math.sin(tt) * rr;
      const y = (rand() - 0.5) * 0.6; // thin disk
      stars.push({
        id: arm * perArm + s,
        arm,
        pos: [x, y, z],
        brightness: 0.4 + rand() * 0.6,
      });
    }
  }

  // Background starfield — purely cosmetic, far away, no physics impact.
  const bgStars: BgStar[] = [];
  for (let i = 0; i < GALAXY_BG_STAR_COUNT; i++) {
    // Uniform on a sphere of radius 70..90 m.
    const u = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const r = 70 + rand() * 20;
    const sq = Math.sqrt(1 - u * u);
    bgStars.push({
      pos: [r * sq * Math.cos(phi), r * u, r * sq * Math.sin(phi)],
      size: 0.04 + rand() * 0.06,
    });
  }

  return {
    seed,
    stars,
    bgStars,
    core: [0, 0, 0],
    earth: [EARTH_POSITION[0], EARTH_POSITION[1], EARTH_POSITION[2]],
  };
}

/**
 * Apply the galaxy as pins into the field. Earth is anchored as a stronger
 * pin (EARTH_PIN_TARGET). The galactic core is a small negative basin.
 * Stars are written as positive pins on a single axis (axis 0) for cheapness;
 * curvature emerges from the resulting cross-axis gradients.
 */
export function applyGalaxyToField(field: Field3D, galaxy: Galaxy): void {
  const N = field.N;

  // Galactic core — negative basin gives the spiral its drift center.
  const ci = Math.round(worldToLattice(galaxy.core[0], N));
  const cj = Math.round(worldToLattice(galaxy.core[1], N));
  const ck = Math.round(worldToLattice(galaxy.core[2], N));
  const coreFlat = idx3(ci, cj, ck, N);
  for (let a = 0; a < FIELD3D_AXES; a++) {
    writePinTemplate(field, a, coreFlat, GALAXY_CORE_TARGET);
    pin3D(field, a, ci, cj, ck, GALAXY_CORE_TARGET); // legacy mirror in sparse map
  }

  // Stars — single-axis positive pin, brightness-scaled.
  for (const star of galaxy.stars) {
    const i = Math.round(worldToLattice(star.pos[0], N));
    const j = Math.round(worldToLattice(star.pos[1], N));
    const k = Math.round(worldToLattice(star.pos[2], N));
    const flat = idx3(i, j, k, N);
    writePinTemplate(field, 0, flat, GALAXY_STAR_TARGET * star.brightness);
    pin3D(field, 0, i, j, k, GALAXY_STAR_TARGET * star.brightness);
  }

  // Earth — bake a deep, radial basin into pinTemplate. The basin's
  // gradient *is* gravity. We stamp a small spherical region around
  // EARTH_POSITION so the basin spans the surface, not a single cell.
  const stamp = Math.max(1, Math.ceil(EARTH_RADIUS));
  const ei = Math.round(worldToLattice(galaxy.earth[0], N));
  const ej = Math.round(worldToLattice(galaxy.earth[1], N));
  const ek = Math.round(worldToLattice(galaxy.earth[2], N));
  for (let dk = -stamp; dk <= stamp; dk++) {
    for (let dj = -stamp; dj <= stamp; dj++) {
      for (let di = -stamp; di <= stamp; di++) {
        const d2 = di * di + dj * dj + dk * dk;
        const d = Math.sqrt(d2);
        if (d > stamp + 0.5) continue;
        // Negative basin (deeper at center) — bodies fall toward minimum.
        const depth = -EARTH_PIN_AMPLITUDE * Math.exp(-d2 / (stamp * stamp));
        const flat = idx3(ei + di, ej + dj, ek + dk, N);
        for (let a = 0; a < FIELD3D_AXES; a++) {
          // Anisotropic: per-axis bias points toward Earth center → ∇u radial inward.
          const axisVec = a === 0 ? di : a === 1 ? dj : dk;
          const bias = depth * (d > 0 ? axisVec / d : 0);
          writePinTemplate(field, a, flat, bias);
        }
      }
    }
  }
  // Also drop a single sparse anchor pin at the center for legacy readers.
  for (let a = 0; a < FIELD3D_AXES; a++) {
    pin3D(field, a, ei, ej, ek, -EARTH_PIN_AMPLITUDE);
  }
}

let _cached: Galaxy | null = null;
export function getGalaxy(): Galaxy {
  if (!_cached) _cached = buildGalaxy(GALAXY_SEED);
  return _cached;
}

// Re-export world constants for callers
export { WORLD_SIZE, FIELD3D_N };