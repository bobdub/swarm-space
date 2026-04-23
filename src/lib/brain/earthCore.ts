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
 * No-op since Phase 3: the lava mantle now owns the full radial pin
 * from r=0 → r=EARTH_RADIUS, so the core stamp lived twice in the same
 * cells and produced the residual shake. Kept as an exported symbol so
 * existing call sites continue to compile and the per-frame ticker stays
 * legible. If a future phase needs an independent core defect, write it
 * *outside* the mantle's radial range.
 */
export function updateEarthCorePin(
  _field: Field3D,
  _pose: EarthPose = getEarthPose(),
  _t: number = Date.now() / 1000,
): void {
  /* mantle owns the radial pin */
}

/**
 * No-op since Phase 3 (mantle owns the radial pin). Kept for legacy
 * call sites. The mantle's `initLavaMantle` writes the first stamp.
 */
export function initEarthCore(_field: Field3D): void {
  /* mantle owns the radial pin */
}

// `tectonicDamping` removed in Phase 2: the lava mantle's spatial wave +
// the operator's diffusion replace the global low-pass filter. If a
// future phase needs a per-plate damping it should live in tectonics.ts.