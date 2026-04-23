/**
 * ═══════════════════════════════════════════════════════════════════════
 * LAVA MANTLE — viscous radial bridge between core and surface
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Phase 4B — true layered Earth profile. The mantle is the **sole writer**
 * of Earth's radial pin from r=0 to r=EARTH_RADIUS, and that writer is
 * organised into four physical bands so the surface stops "breathing" to
 * a standing observer:
 *
 *   1. Core sink     r ≤ R_CORE                 → constant deep basin
 *   2. Dynamic mantle R_CORE ≤ r ≤ R_MANTLE_TOP → coreBreath(t) + plate
 *                                                  bias live here, fade
 *                                                  to zero at the top
 *   3. Crust lock    R_MANTLE_TOP ≤ r ≤ R_CRUST_TOP → static, no time, no
 *                                                      plate bias
 *   4. Surface band  R_CRUST_TOP ≤ r ≤ EARTH_RADIUS → constant surface
 *                                                      depth, time-invariant
 *
 * Because the surface band carries zero temporal modulation and the
 * dynamic mantle's breath envelope is forced to zero before the crust
 * begins, an observer standing on the visible ground sees a quiet field.
 * Plate convergent / divergent stress only modulates depth in the
 * dynamic mantle band — never the crust, never the surface — so plate
 * tension reads inward, not as lateral ground sliding.
 *
 * Re-asserts every 8 ticks. Between writes the operator carries the
 * dynamics via ν·Δu — that is the "use the full physics engine" the
 * plan calls for.
 */

import { writePinTemplate, idx3, FIELD3D_AXES, type Field3D } from '../uqrc/field3D';
import {
  EARTH_PIN_AMPLITUDE,
  EARTH_RADIUS,
  WORLD_SCALE,
  BODY_SHELL_RADIUS,
  getEarthPose,
  type EarthPose,
} from './earth';
import { boundaryInfo } from './tectonics';

const WORLD_SIZE = 60 * WORLD_SCALE;
const EARTH_CORE_RADIUS = EARTH_RADIUS * 0.35;

function worldToLattice(p: number, N: number): number {
  return ((p / WORLD_SIZE + 0.5) * N + N) % N;
}

const SURFACE_AMP = EARTH_PIN_AMPLITUDE;
const CORE_AMP = EARTH_PIN_AMPLITUDE * 1.4;

/** Mantle pressure band — coreBreath(t) + plate bias live here. */
const BREATH_AMP = EARTH_PIN_AMPLITUDE * 0.02;
const BREATH_RADIAL_CYCLES = 3;
const BREATH_PERIOD_SECONDS = 30;

/** Plate boundary coupling — radial bias only, applied inside the
 *  dynamic mantle band so surface tangential drift never appears. */
const PLATE_BIAS_FRACTION = 0.05;
const PLATE_BIAS_FALLOFF = 0.09;

/**
 * Five-band radial profile (fractions of EARTH_RADIUS).
 *
 *   r/R = 0          .. CORE_TOP        → core sink (mid depth, constant)
 *   r/R = CORE_TOP   .. MANTLE_TOP      → dynamic mantle (breath + plates)
 *   r/R = MANTLE_TOP .. CRUST_TOP       → crust lock (rises toward basin)
 *   r/R = CRUST_TOP  .. 1               → basin descent to deepest point
 *                                         AT r = EARTH_RADIUS (surface)
 *   r/R = 1          .. ATMOSPHERE_TOP  → atmosphere wall (rises back up)
 *
 * The basin minimum sits exactly at r = EARTH_RADIUS so a resting body
 * experiences ZERO net radial force at the surface, with restoring force
 * on either side. Below the surface the field pushes outward; above the
 * surface it pushes inward. That is the UQRC collider — no clamp, no
 * spring, just the field gradient created by `pinTemplate`.
 */
const MANTLE_TOP = 0.82;     // top of dynamic mantle
const CRUST_TOP = 0.94;      // basin descent starts here (still below surface)
const ATMOSPHERE_TOP = 1.06; // outer wall — pushes airborne bodies back down

/** Where the basin minimum sits, expressed as a fraction of EARTH_RADIUS.
 *  Equal to BODY_SHELL_RADIUS / EARTH_RADIUS so a body resting at the
 *  basin minimum has its centre at the BODY_SHELL — feet on the visible
 *  ground, eyes one EYE_LIFT above. The lattice resolution (~531 m/cell)
 *  cannot resolve the BODY_CENTER_HEIGHT offset directly, so this only
 *  biases which side of EARTH_RADIUS the cell-quantised minimum lands. */
const BASIN_MIN_FRACTION = BODY_SHELL_RADIUS / EARTH_RADIUS;

/** Surface basin depth — the global minimum of the radial profile.
 *  Must be deeper than CORE_AMP so the surface, not the core, is the
 *  global attractor for resting bodies. */
const SURFACE_BASIN_AMP = EARTH_PIN_AMPLITUDE * 1.8;
/** How high the atmosphere wall rises above zero — sets the inward push
 *  strength on bodies that lift off the surface. */
const ATMOSPHERE_AMP = EARTH_PIN_AMPLITUDE * 0.4;
/** Sub-cell radial force scale used by the body integrator. The lattice is
 *  ~531 m/cell, so metre-scale altitude errors must come from the analytic
 *  mantle profile rather than the sampled grid alone. Must out-pull the
 *  field's drift gradient from the deep core basin (~8 m/s² inward), so
 *  set well above that to keep the surface as the global attractor. */
export const SURFACE_RESTORING_ACCEL = 24.0;

/** Hermite C¹ blend: 0 at u=0, 1 at u=1, zero slope at both ends. */
function smoothstep01(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u * u * (3 - 2 * u);
}

/**
 * Layered radial profile with strict band ownership.
 *
 *   `dynamicScale` is returned alongside `depth` so the caller can decide
 *   whether to apply plate bias at this radius. Plate bias is only ever
 *   multiplied by `dynamicScale`, which is 1.0 in the dynamic mantle and
 *   0.0 inside the crust + surface bands. That guarantees no plate
 *   modulation reaches the visible ground.
 */
function radialPin(r: number, t: number): { depth: number; dynamicScale: number } {
  // 1. Core sink — constant, no time, no plate.
  if (r <= EARTH_CORE_RADIUS) {
    return { depth: -CORE_AMP, dynamicScale: 0 };
  }
  const mantleTopR = EARTH_RADIUS * MANTLE_TOP;
  const crustTopR = EARTH_RADIUS * CRUST_TOP;
  const atmosphereTopR = EARTH_RADIUS * ATMOSPHERE_TOP;
  const basinMinR = EARTH_RADIUS * BASIN_MIN_FRACTION;

  // 5. Atmosphere wall — ABOVE the surface. depth rises from
  //    -SURFACE_BASIN_AMP at r=EARTH_RADIUS to +ATMOSPHERE_AMP at the
  //    top of the wall. The positive slope here yields an inward radial
  //    force, so any body that lifts off is pushed back down onto the
  //    surface basin. Outside the wall, no pin → free space.
  if (r >= basinMinR) {
    if (r >= atmosphereTopR) {
      return { depth: ATMOSPHERE_AMP, dynamicScale: 0 };
    }
    const u = (r - basinMinR) / Math.max(1e-6, atmosphereTopR - basinMinR);
    const blend = smoothstep01(u);
    const depth = -SURFACE_BASIN_AMP * (1 - blend) + ATMOSPHERE_AMP * blend;
    return { depth, dynamicScale: 0 };
  }
  // 4. Basin descent — between crust-top and the surface. depth FALLS
  //    from -SURFACE_AMP at crust-top to -SURFACE_BASIN_AMP at the basin
  //    minimum (just above the visible ground).
  //    The negative slope here yields an outward radial force on bodies
  //    below the surface, lifting them up to the basin minimum.
  if (r >= crustTopR) {
    const u = (r - crustTopR) / Math.max(1e-6, basinMinR - crustTopR);
    const blend = smoothstep01(u);
    const depth = -SURFACE_AMP * (1 - blend) + (-SURFACE_BASIN_AMP) * blend;
    return { depth, dynamicScale: 0 };
  }
  // 3. Crust lock — smoothly bridges mantle-top depth to crust-top depth
  //    without any temporal term.
  if (r >= mantleTopR) {
    const u = (r - mantleTopR) / Math.max(1e-6, crustTopR - mantleTopR);
    const blend = smoothstep01(u);
    const depth = -SURFACE_AMP * (1 - blend) + (-SURFACE_AMP) * blend;
    return { depth, dynamicScale: 0 };
  }
  // 2. Dynamic mantle — coreBreath(t) and plate bias modulate here.
  //    Envelope forces both terms to zero at the band's boundaries so
  //    the crust above is never touched by time or plate stress.
  const span = mantleTopR - EARTH_CORE_RADIUS;
  const u = (r - EARTH_CORE_RADIUS) / Math.max(1e-6, span);
  const blend = smoothstep01(u);
  const base = -CORE_AMP * (1 - blend) - SURFACE_AMP * blend;
  const envelope = blend * (1 - blend) * 4; // peaks at 1.0 in band middle, 0 at edges
  const phase =
    2 * Math.PI * (u * BREATH_RADIAL_CYCLES - t / BREATH_PERIOD_SECONDS);
  const breath = BREATH_AMP * envelope * Math.sin(phase);
  return { depth: base + breath, dynamicScale: envelope };
}

/**
 * Analytic radial acceleration implied by the mantle profile.
 * Negative = inward (fall toward Earth), positive = outward.
 *
 * This gives the integrator metre-scale radial response inside one lattice
 * cell, where the sampled field cannot distinguish 0 m vs 60 m altitude.
 */
export function sampleMantleRadialAcceleration(r: number): number {
  const basinMinR = EARTH_RADIUS * BASIN_MIN_FRACTION;
  const atmosphereTopR = EARTH_RADIUS * ATMOSPHERE_TOP;
  const crustTopR = EARTH_RADIUS * CRUST_TOP;

  if (r >= atmosphereTopR) return 0;
  // Sub-cell dead-band centred on the basin minimum (~1 m wide). A
  // resting body at BODY_SHELL_RADIUS reads exactly zero net radial
  // acceleration so it doesn't jitter against either side of the well.
  const DEAD = 1.0;
  if (r >= basinMinR - DEAD && r <= basinMinR + DEAD) return 0;
  // ABOVE the surface basin → push inward at full strength up to the
  // atmosphere wall, decaying to zero only at the wall's outer edge.
  if (r >= basinMinR) {
    const span = Math.max(1e-6, atmosphereTopR - basinMinR);
    const u = (r - basinMinR) / span;
    return -SURFACE_RESTORING_ACCEL * (1 - smoothstep01(u));
  }
  // BELOW the surface basin → push outward at full strength all the way
  // down to the core. There is no neutral band: any radius below
  // basinMinR reads as "fell through the crust" and the field lifts the
  // body back up. The previous smoothstep that decayed restoring force
  // toward the basin let the inward drift gradient win at small Δr,
  // which is exactly the slow-sink the user is seeing.
  if (r < basinMinR) {
    return SURFACE_RESTORING_ACCEL;
  }
  return 0;
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
  // Stamp out to the top of the atmosphere wall so airborne bodies still
  // feel the inward force. Without this band the field above the surface
  // would be flat and a body that lifts off has nothing pulling it back.
  const writerOuterRadius = EARTH_RADIUS * ATMOSPHERE_TOP;
  const stamp = Math.max(1, Math.ceil(writerOuterRadius * cellsPerUnit));
  const ei = Math.round(worldToLattice(pose.center[0], N));
  const ej = Math.round(worldToLattice(pose.center[1], N));
  const ek = Math.round(worldToLattice(pose.center[2], N));

  const outerCells = writerOuterRadius * cellsPerUnit;

  for (let dk = -stamp; dk <= stamp; dk++) {
    for (let dj = -stamp; dj <= stamp; dj++) {
      for (let di = -stamp; di <= stamp; di++) {
        const dCells = Math.sqrt(di * di + dj * dj + dk * dk);
        // Mantle owns the full radial pin from r=0 → r=EARTH_RADIUS.
        // No other module writes this region anymore.
        if (dCells > outerCells + 0.5) continue;
        const r = dCells / cellsPerUnit;               // back to sim units
        const { depth: baseDepth, dynamicScale } = radialPin(r, t);
        let depth = baseDepth;

        // Plate coupling — radial-only and gated by `dynamicScale`, which
        // is 0 in the crust + surface bands. Convergent plates push the
        // basin slightly deeper inside the dynamic mantle; divergent
        // plates lift it. The visible ground above never sees the bias.
        if (dCells > 0.5 && dynamicScale > 0) {
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
            depth *= 1 + PLATE_BIAS_FRACTION * proximity * dynamicScale;
          } else if (info.boundaryKind === 'divergent') {
            depth *= 1 - PLATE_BIAS_FRACTION * proximity * dynamicScale;
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
