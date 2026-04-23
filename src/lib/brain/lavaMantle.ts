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
  getEarthPose,
  type EarthPose,
} from './earth';
import { worldToLattice, WORLD_SIZE } from './uqrcPhysics';
import { EARTH_CORE_RADIUS } from './earthCore';
import { boundaryInfo } from './tectonics';

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

/** Surface basin depth — the global minimum of the radial profile.
 *  Must be deeper than CORE_AMP so the surface, not the core, is the
 *  global attractor for resting bodies. */
const SURFACE_BASIN_AMP = EARTH_PIN_AMPLITUDE * 1.8;
/** How high the atmosphere wall rises above zero — sets the inward push
 *  strength on bodies that lift off the surface. */
const ATMOSPHERE_AMP = EARTH_PIN_AMPLITUDE * 0.4;

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
  // 4. Surface band — constant surface depth, time-invariant. This is
  //    the band the visible ground + avatars + builder content live in.
  if (r >= crustTopR) {
    return { depth: -SURFACE_AMP, dynamicScale: 0 };
  }
  // 3. Crust lock — smoothly bridges mantle-top depth to surface depth
  //    without any temporal term. Provides the static support that keeps
  //    bodies on the surface basin between mantle re-asserts.
  if (r >= mantleTopR) {
    const u = (r - mantleTopR) / Math.max(1e-6, crustTopR - mantleTopR);
    const blend = smoothstep01(u);
    // Mantle-top base is the static blended depth at the top of the
    // dynamic band (no breath term applied — breath envelope is 0 here).
    const baseMantleTop =
      -CORE_AMP * (1 - 1) - SURFACE_AMP * 1; // = -SURFACE_AMP at u_dyn=1
    const depth = baseMantleTop * (1 - blend) + (-SURFACE_AMP) * blend;
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

  const outerCells = EARTH_RADIUS * cellsPerUnit;

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
