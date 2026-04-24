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
import {
  getVolcanoOrgan,
  SHARED_VOLCANO_ANCHOR_ID,
} from './volcanoOrgan';
import { COSMO_COMPOUNDS, type CosmoCompound } from './cosmoChemistry';

const WORLD_SIZE = 60 * WORLD_SCALE;
const EARTH_CORE_RADIUS = EARTH_RADIUS * 0.35;

function worldToLattice(p: number, N: number): number {
  return ((p / WORLD_SIZE + 0.5) * N + N) % N;
}

const SURFACE_AMP = EARTH_PIN_AMPLITUDE;
const CORE_AMP = EARTH_PIN_AMPLITUDE * 1.4;

/** Mantle pressure band — coreBreath(t) + plate bias live here. */
/**
 * Mantle pressure no longer oscillates as a closed sin wave — that wave
 * was leaking through the crust band's lattice quantisation (~531 m/cell)
 * and showing up as a periodic shake under the player's feet.
 *
 * Instead, pressure accumulates monotonically and is **vented** through
 * volcano sites at convergent plate boundaries. The vent term is purely
 * radial-inward (relieves pressure toward the core), bounded, and lives
 * deep in the dynamic mantle band — well below the crust.
 *
 *   p(t) = clamp( P_RATE · t  mod  P_VENT_THRESHOLD , 0, P_VENT_THRESHOLD )
 *
 * Because p(t) is a slow sawtooth (no high-frequency component) and is
 * forced to zero by the same `envelope` that gates plate bias, no
 * oscillation reaches the surface lattice cells. The previous
 * `BREATH_AMP * sin(...)` term is removed entirely.
 */
/**
 * Constant pressure-release sink at each volcano site. Time-invariant
 * by design — any periodic component, however small, will smear across
 * the lattice via the operator's diffusion and read as ground tremor.
 * The pressure that the mantle accumulates is released by the visible
 * volcano blocks (see `volcanoSeed.ts`), not by modulating the field
 * over time.
 */
const VENT_AMP_BASE = EARTH_PIN_AMPLITUDE * 0.012;
/** Maximum vent amplification when the mantle is fully pressurised. */
const VENT_AMP_MAX = EARTH_PIN_AMPLITUDE * 0.10;
/** Angular falloff for vent influence on the unit sphere (radians). */
const VENT_FALLOFF = 0.18;

// ── Mantle pressure ↔ vent loop ───────────────────────────────────
//
// The mantle is a closed organ — convergent plate stress accumulates
// pressure inside the dynamic band, the volcano vent bleeds it out.
// Without this loop, plate bias only ever pushes the basin deeper and
// the vent term is constant: the system never depressurises, the field
// keeps integrating tension, and ground cells oscillate. With the
// loop, vent amplitude rises with pressure, pressure falls under vent
// flow, and the system reaches a quiet steady state.
//
//   ṗ = +k_in − k_out · vent(p)
//   vent(p) = VENT_AMP_BASE + (VENT_AMP_MAX − VENT_AMP_BASE) · p
//   p ∈ [0, 1]
let _mantlePressure = 0.5;
let _lastPressureT = 0;

/** Read-only — current normalised mantle pressure for HUD / debug. */
export function getMantlePressure(): number { return _mantlePressure; }

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
function radialPin(r: number): { depth: number; dynamicScale: number } {
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
  // No temporal modulation. Plate bias rides on `envelope` (set in
  // `updateLavaMantlePin`); volcano vent sites add a *spatial*,
  // time-invariant inward bias deep in the mantle. The surface band
  // (above r = CRUST_TOP) carries `dynamicScale = 0` and can't be
  // touched by either.
  return { depth: base, dynamicScale: envelope };
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
  // ── Smooth radial collider (no hard step at the dead-band edge) ──
  // Previously the profile was: exact 0 inside ±1 m of the basin, then a
  // hard jump to ±SURFACE_RESTORING_ACCEL outside. With dt = 1/60 a body
  // sitting just outside the dead-band gets a 0.4 m/s impulse in one
  // tick, overshoots into the dead-band, flips on the next, and the
  // limit-cycle reads as the visible "floor shake". Replace the jump
  // with a continuous tanh spring: zero force exactly at the basin,
  // ramping smoothly to ±SURFACE_RESTORING_ACCEL outside ~SOFT_BAND.
  // This is the "tissue" — it absorbs micro-perturbations instead of
  // bouncing them.
  const dr = r - basinMinR;
  const SOFT_BAND = 2.0;          // metres — width of the tissue
  const x = dr / SOFT_BAND;
  // tanh saturates to ±1 by |x| ≈ 2, so beyond ±4 m we're at full force.
  const shaped = Math.tanh(x);
  // Above the basin: −accel (inward). Below the basin: +accel (outward).
  // The smoothstep above the surface still fades inward push toward the
  // atmosphere top so airborne bodies don't fight the ceiling.
  if (dr >= 0) {
    const span = Math.max(1e-6, atmosphereTopR - basinMinR);
    const u = Math.min(1, dr / span);
    return -SURFACE_RESTORING_ACCEL * shaped * (1 - smoothstep01(u));
  }
  return -SURFACE_RESTORING_ACCEL * shaped;
}

const _lastMantleFlats = new Set<number>();
let _lastWriteTick = -Infinity;
const REASSERT_EVERY_TICKS = 8;

function sampleTectonicInflow(ventNormal: [number, number, number]): number {
  const info = boundaryInfo(ventNormal);
  if (info.boundaryKind !== 'convergent') return 0.01;
  const d = info.boundaryDistance / Math.max(1e-6, PLATE_BIAS_FALLOFF);
  const proximity = Math.exp(-(d * d));
  return 0.01 + 0.09 * proximity;
}

function sampleVentOutflow(pressure: number, ventAmp: number): number {
  const ampNorm = (ventAmp - VENT_AMP_BASE) / Math.max(1e-6, VENT_AMP_MAX - VENT_AMP_BASE);
  return Math.max(0, pressure) * (0.02 + 0.12 * Math.max(0, Math.min(1, ampNorm)));
}

/**
 * Chemical-aware vent emission. Mirrors `sampleVentOutflow`'s scalar
 * rate but tags it with the vent gas compound so renderer + HUD can
 * report which gases are venting (H₂O + CO₂ + SO₂) instead of an
 * abstract pressure number.
 *
 * Pure read — no field writes, no time term. Reads the live mantle
 * pressure integrated by `updateLavaMantlePin`.
 */
export interface VentEmission {
  /** Normalised emission rate in [0, ~0.14]. */
  rate: number;
  /** Normalised mantle pressure in [0, 1]. */
  pressure: number;
  /** Chemical signature of the emitted gas blend. */
  compound: CosmoCompound;
}

export function sampleVentEmission(): VentEmission {
  const ventAmp = VENT_AMP_BASE + (VENT_AMP_MAX - VENT_AMP_BASE) * _mantlePressure;
  return {
    rate: sampleVentOutflow(_mantlePressure, ventAmp),
    pressure: _mantlePressure,
    compound: COSMO_COMPOUNDS.vent_gas,
  };
}

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

  const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
  const ventNormal = organ.centerNormal;
  const ventFalloff = organ.pressureRadius;

  // Integrate mantle pressure from ACTUAL tectonic inflow under the shared
  // volcano seam and bleed it via ACTUAL vent throughput. The previous
  // constant-rate loop was only a buffer: it could change response time,
  // but it did not represent build-up/release from the same organ.
  const dt = _lastPressureT > 0 ? Math.max(0, Math.min(1.0, t - _lastPressureT)) : 0;
  _lastPressureT = t;
  const tectonicInflow = sampleTectonicInflow(ventNormal);
  const ventAmp = VENT_AMP_BASE + (VENT_AMP_MAX - VENT_AMP_BASE) * _mantlePressure;
  const ventOutflow = sampleVentOutflow(_mantlePressure, ventAmp);
  _mantlePressure += dt * (tectonicInflow - ventOutflow);
  if (_mantlePressure < 0) _mantlePressure = 0;
  if (_mantlePressure > 1) _mantlePressure = 1;

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
  void t;
  for (let dk = -stamp; dk <= stamp; dk++) {
    for (let dj = -stamp; dj <= stamp; dj++) {
      for (let di = -stamp; di <= stamp; di++) {
        const dCells = Math.sqrt(di * di + dj * dj + dk * dk);
        // Mantle owns the full radial pin from r=0 → r=EARTH_RADIUS.
        // No other module writes this region anymore.
        if (dCells > outerCells + 0.5) continue;
        const r = dCells / cellsPerUnit;               // back to sim units
        const { depth: baseDepth, dynamicScale } = radialPin(r);
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
          // Spatial vent — single inward sink under the unified volcano
          // organ normal, strictly inside the dynamic band. Time-invariant.
          const dotV = Math.max(-1, Math.min(1,
            ventNormal[0] * (di / dCells) +
            ventNormal[1] * (dj / dCells) +
            ventNormal[2] * (dk / dCells)));
          const angV = Math.acos(dotV);
          const ventBias = Math.exp(
            -((angV / ventFalloff) * (angV / ventFalloff)),
          );
          if (ventBias > 0) {
            depth -= ventAmp * dynamicScale * Math.min(1.5, ventBias);
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
