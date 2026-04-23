/**
 * ═══════════════════════════════════════════════════════════════════════
 * LAVA MANTLE — viscous radial bridge between core and surface
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Phase 2A of the Earth's-Core plan. Fixes the per-frame ground tremor
 * caused by the discontinuous radial pin profile (surface basin overlays
 * outer cells, core basin overlays inner cells, with a step gap between).
 *
 * The mantle writes a single C¹-continuous radial pin layer covering the
 * shell EARTH_CORE_RADIUS ≤ r ≤ EARTH_RADIUS. Its profile smoothly
 * interpolates from the deep core depth at the inner boundary up to the
 * surface depth at the outer boundary, with matched derivatives at both
 * seams — so the operator no longer sees a discontinuity to propagate
 * as a shock.
 *
 * The "breath" lives here, not in the core: a slow standing wave moves
 * radially outward at ~1 cycle / 30 s. Because the wave is *spatial*,
 * the operator's own diffusion (ν Δ u) smooths it across cells before
 * inhabitants can feel any high-frequency artefact.
 *
 * Re-asserts every 8 ticks. Between writes, the operator carries the
 * dynamics — that is the "use the full physics engine" the plan calls for.
 *
 * Plates (Phase 2B) couple in *spatially*: at convergent boundaries the
 * stamp is ~5% deeper, at divergent ~5% shallower. No temporal coupling.
 */

import { writePinTemplate, idx3, FIELD3D_AXES, type Field3D } from '../uqrc/field3D';
import {
  EARTH_PIN_AMPLITUDE,
  EARTH_RADIUS,
  getEarthPose,
  type EarthPose,
} from './earth';
import { worldToLattice, WORLD_SIZE } from './uqrcPhysics';
import { EARTH_CORE_RADIUS } from './earthCore';
import { boundaryInfo } from './tectonics';

const SURFACE_AMP = EARTH_PIN_AMPLITUDE;
const CORE_AMP = EARTH_PIN_AMPLITUDE * 1.4;

/** Standing-wave parameters — spatial, not temporal modulation. */
const BREATH_AMP = EARTH_PIN_AMPLITUDE * 0.02;
const BREATH_RADIAL_CYCLES = 3; // 3 wavelengths across the mantle
const BREATH_PERIOD_SECONDS = 30;

/** Plate boundary coupling — small spatial bias, not a force. */
const PLATE_BIAS_FRACTION = 0.05;
/** Angular width (radians) over which boundary bias falls off (≈ 5°). */
const PLATE_BIAS_FALLOFF = 0.09;

/** Hermite C¹ blend: 0 at u=0, 1 at u=1, zero slope at both ends. */
function smoothstep01(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u * u * (3 - 2 * u);
}

/**
 * Continuous radial profile.
 *   r ≤ EARTH_CORE_RADIUS  → core depth (matches earthCore amplitude)
 *   EARTH_CORE_RADIUS ≤ r ≤ EARTH_RADIUS → smoothly interpolates to surface
 *   r ≥ EARTH_RADIUS      → surface depth (matches updateEarthPin)
 *
 * Derivative is zero at both seams (smoothstep), so the field has no kink.
 */
function radialDepth(r: number, t: number): number {
  const rNorm =
    (r - EARTH_CORE_RADIUS) / Math.max(1e-6, EARTH_RADIUS - EARTH_CORE_RADIUS);
  const blend = smoothstep01(rNorm);
  const base = -CORE_AMP * (1 - blend) - SURFACE_AMP * blend;
  // Spatial breath wave — moves outward through the shell.
  const phase =
    2 * Math.PI * (rNorm * BREATH_RADIAL_CYCLES - t / BREATH_PERIOD_SECONDS);
  return base + BREATH_AMP * Math.sin(phase);
}

const _lastMantleFlats = new Set<number>();
let _lastWriteTick = -Infinity;
const REASSERT_EVERY_TICKS = 8;

export function initLavaMantle(field: Field3D): void {
  _lastWriteTick = -Infinity;
  updateLavaMantlePin(field, getEarthPose(), 0);
}

/**
 * Re-stamp the mantle pin layer. Skips writes between re-assert windows
 * so the operator carries the dynamics in between (this is the entire
 * point of using the diffusion term instead of stamping every frame).
 */
export function updateLavaMantlePin(
  field: Field3D,
  pose: EarthPose = getEarthPose(),
  t: number = Date.now() / 1000,
): void {
  if (field.ticks - _lastWriteTick < REASSERT_EVERY_TICKS) return;
  _lastWriteTick = field.ticks;

  const N = field.N;

  // Clear previous-stamp cells.
  if (_lastMantleFlats.size > 0) {
    for (const flat of _lastMantleFlats) {
      for (let a = 0; a < FIELD3D_AXES; a++) {
        field.pinTemplate[a][flat] = 0;
        field.pinMask[a][flat] = 0;
      }
    }
    _lastMantleFlats.clear();
  }

  const cellsPerUnit = N / WORLD_SIZE;
  const stamp = Math.max(1, Math.ceil(EARTH_RADIUS * cellsPerUnit));
  const ei = Math.round(worldToLattice(pose.center[0], N));
  const ej = Math.round(worldToLattice(pose.center[1], N));
  const ek = Math.round(worldToLattice(pose.center[2], N));

  const innerCells = EARTH_CORE_RADIUS * cellsPerUnit;
  const outerCells = EARTH_RADIUS * cellsPerUnit;

  for (let dk = -stamp; dk <= stamp; dk++) {
    for (let dj = -stamp; dj <= stamp; dj++) {
      for (let di = -stamp; di <= stamp; di++) {
        const dCells = Math.sqrt(di * di + dj * dj + dk * dk);
        if (dCells < innerCells - 0.5) continue;       // core's territory
        if (dCells > outerCells + 0.5) continue;       // surface's territory
        const r = dCells / cellsPerUnit;               // back to sim units
        let depth = radialDepth(r, t);

        // Plate coupling: spatial only. Sample the surface normal that
        // this radial line eventually hits, ask tectonics for boundary
        // info, bias the depth slightly. No temporal jitter.
        if (dCells > 0.5) {
          const normal: [number, number, number] = [
            di / dCells,
            dj / dCells,
            dk / dCells,
          ];
          const info = boundaryInfo(normal);
          const proximity = Math.exp(
            -((info.boundaryDistance / PLATE_BIAS_FALLOFF) * (info.boundaryDistance / PLATE_BIAS_FALLOFF)),
          );
          if (info.boundaryKind === 'convergent') {
            depth *= 1 + PLATE_BIAS_FRACTION * proximity;
          } else if (info.boundaryKind === 'divergent') {
            depth *= 1 - PLATE_BIAS_FRACTION * proximity;
          }
        }

        const flat = idx3(ei + di, ej + dj, ek + dk, N);
        for (let a = 0; a < FIELD3D_AXES; a++) {
          const axisVec = a === 0 ? di : a === 1 ? dj : dk;
          const bias = depth * (dCells > 0 ? axisVec / dCells : 0);
          writePinTemplate(field, a, flat, bias);
        }
        _lastMantleFlats.add(flat);
      }
    }
  }
}
