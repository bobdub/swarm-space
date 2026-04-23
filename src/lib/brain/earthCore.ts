/**
 * ═══════════════════════════════════════════════════════════════════════
 * EARTH'S CORE — the deeper anchor beneath updateEarthPin
 * ═══════════════════════════════════════════════════════════════════════
 *
 * `updateEarthPin` (earth.ts) writes Earth's *surface* basin every tick.
 * That keeps things on the ground but does not, by itself, prevent the
 * "flip upside down" pathology if the surface gradient ever inverts.
 *
 * The core is a *deeper, narrower* radial pin co-located with Earth's
 * centre that is always present after the surface stamp is written.
 * Because it is steeper than the surface basin, intent inside the body
 * always rotates inward — humans cannot fall through, and the field
 * itself slopes toward the planet's heart, not away from it.
 *
 * The core itself is now *amplitude-rigid* — the breath was moved to
 * the lava mantle (`lavaMantle.ts`) where it lives as a *spatial*
 * standing wave smoothed by the operator's own diffusion. That fixes
 * the per-frame ground tremor caused by re-stamping a sinusoidally
 * varying core every animation tick.
 *
 * `coreBreath(t)` is still exported as the global heartbeat clock —
 * Phase 4 (volcanoes) and future biology phases read it for timing.
 */

import { writePinTemplate, idx3, FIELD3D_AXES, type Field3D } from '../uqrc/field3D';
import {
  EARTH_PIN_AMPLITUDE,
  EARTH_RADIUS,
  getEarthPose,
  type EarthPose,
} from './earth';
import { worldToLattice, WORLD_SIZE } from './uqrcPhysics';

/** Inner core radius (sim units). ~35% of Earth's radius — geologically faithful. */
export const EARTH_CORE_RADIUS = EARTH_RADIUS * 0.35;
/** Outer mantle boundary (sim units). Region between this and EARTH_RADIUS is the crust. */
export const MANTLE_RADIUS = EARTH_RADIUS * 0.85;

/** Core basin amplitude — strictly deeper than the surface pin. */
const CORE_PIN_AMPLITUDE = EARTH_PIN_AMPLITUDE * 1.4;

/** Heartbeat period (seconds). */
const CORE_BREATH_PERIOD = 30;
/**
 * Heartbeat amplitude is **0** at the core itself. The breath now lives
 * in `lavaMantle.ts` as a spatial radial wave — see header note.
 * Kept as a named constant so the intent is explicit at the call site.
 */
const CORE_BREATH_AMP = 0;

/**
 * Slow sinusoidal pulse of the core, in [-1, 1]. Future phases (volcanoes,
 * biology seasons) read this for their own timing.
 */
export function coreBreath(t: number): number {
  return Math.sin((2 * Math.PI * t) / CORE_BREATH_PERIOD);
}

/** Cells written by the previous core stamp — cleared before the next write. */
const _lastCoreFlats = new Set<number>();

/**
 * Rewrite the core basin into pinTemplate at the live Earth centre.
 * MUST be called *after* `updateEarthPin` each tick so the deeper core
 * pin overrides the surface pin in the inner cells.
 */
export function updateEarthCorePin(
  field: Field3D,
  pose: EarthPose = getEarthPose(),
  t: number = (Date.now() / 1000),
): void {
  const N = field.N;

  // Clear previous-tick core cells.
  if (_lastCoreFlats.size > 0) {
    for (const flat of _lastCoreFlats) {
      for (let a = 0; a < FIELD3D_AXES; a++) {
        field.pinTemplate[a][flat] = 0;
        field.pinMask[a][flat] = 0;
      }
    }
    _lastCoreFlats.clear();
  }

  const cellsPerUnit = N / WORLD_SIZE;
  const stamp = Math.max(1, Math.ceil(EARTH_CORE_RADIUS * cellsPerUnit));
  const ei = Math.round(worldToLattice(pose.center[0], N));
  const ej = Math.round(worldToLattice(pose.center[1], N));
  const ek = Math.round(worldToLattice(pose.center[2], N));

  // Amplitude is rigid here — breath modulation has moved to the mantle
  // so the core stamp no longer flickers between ticks. See header.
  const breath = coreBreath(t);
  const amp = CORE_PIN_AMPLITUDE * (1 + CORE_BREATH_AMP * breath);

  for (let dk = -stamp; dk <= stamp; dk++) {
    for (let dj = -stamp; dj <= stamp; dj++) {
      for (let di = -stamp; di <= stamp; di++) {
        const d2 = di * di + dj * dj + dk * dk;
        const d = Math.sqrt(d2);
        if (d > stamp + 0.5) continue;
        const depth = -amp * Math.exp(-d2 / (stamp * stamp));
        const flat = idx3(ei + di, ej + dj, ek + dk, N);
        for (let a = 0; a < FIELD3D_AXES; a++) {
          const axisVec = a === 0 ? di : a === 1 ? dj : dk;
          const bias = depth * (d > 0 ? axisVec / d : 0);
          writePinTemplate(field, a, flat, bias);
        }
        _lastCoreFlats.add(flat);
      }
    }
  }
}

/**
 * One-shot init: writes the first core stamp so the field is born with a
 * heart, even before the first physics tick. Safe to call once at boot
 * alongside `applyRoundCurvature` / `applyGalaxyToField`.
 */
export function initEarthCore(field: Field3D): void {
  updateEarthCorePin(field, getEarthPose(), 0);
}

// `tectonicDamping` removed in Phase 2: the lava mantle's spatial wave +
// the operator's diffusion replace the global low-pass filter. If a
// future phase needs a per-plate damping it should live in tectonics.ts.