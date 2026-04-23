/**
 * ═══════════════════════════════════════════════════════════════════════
 * 𝒞_collide — CAUSAL COLLIDE OPERATOR
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   Glyph              𝒞_collide(u, b) := −∇Π(u(x_b))
 *   Potential          Π(u) := exp( κ · ‖u(x)‖² / u_max² )
 *   Closure            ∇‖u(x_b)‖² = 0  ⇔  body at rest in field
 *
 * Formal UQRC primitive. Treats collision as the gradient of an exclusion
 * potential whose value rises with the field magnitude already present at
 * the body's location. Where the field is excited (mantle, pinned crust,
 * other bodies' wakes) the potential is high; the body is pushed down the
 * ‖u‖² gradient toward the nearest local minimum.
 *
 * SOURCE OF TRUTH:
 *   - u_max  ← FIELD3D_BOUND  (global regularity clamp, already the
 *              postulate's saturation value)
 *   - κ      ← FIELD3D_KAPPA_PIN  (same coupling the L_S^pin term uses;
 *              collision and pinning are the same family of operator)
 *   - sample ← sample3D / gradient3D from field3D (no new physics)
 *
 * No GRAVITY. No SURFACE_RESTORING_ACCEL. No radial assumption. No clamp.
 * The body never decides — it reads ∇‖u‖² and follows the gradient.
 *
 * Returns acceleration (per-mass), so the integrator multiplies by mass to
 * get force, identical to every other UQRC term.
 */

import {
  sample3D,
  FIELD3D_AXES,
  FIELD3D_BOUND,
  FIELD3D_KAPPA_PIN,
  type Field3D,
} from '../uqrc/field3D';

/**
 * κ in the exclusion potential. Reuses pin coupling — same operator family.
 * Exported so the field-level 𝒫_pressure term in step3D imports the same κ
 * that the body-level 𝒞_collide uses. Single source of truth, by construction.
 */
export const COLLIDE_KAPPA = FIELD3D_KAPPA_PIN;
/** u_max in the exclusion potential. Reuses the field's regularity clamp. */
export const COLLIDE_U_MAX = FIELD3D_BOUND;
/** Pre-computed normaliser for Π — exported for the field-pressure term. */
export const COLLIDE_U_MAX_SQ = (COLLIDE_U_MAX * COLLIDE_U_MAX) || 1;

/**
 * Pure scalar form of Π given the already-summed ‖u‖². Shared between the
 * body operator (𝒞_collide) and the field operator (𝒫_pressure) so both
 * pull from one definition. Π(u) = exp(κ · m² / u_max²).
 */
export function exclusionPotential(magnitudeSq: number): number {
  return Math.exp(COLLIDE_KAPPA * magnitudeSq / COLLIDE_U_MAX_SQ);
}

/** ‖u(x)‖² summed over field axes at lattice position (x,y,z). */
function fieldMagnitudeSq(field: Field3D, x: number, y: number, z: number): number {
  let s = 0;
  for (let a = 0; a < FIELD3D_AXES; a++) {
    const v = sample3D(field, a, x, y, z);
    s += v * v;
  }
  return s;
}

/** Exclusion potential Π(u) = exp(κ · ‖u‖² / u_max²) at lattice position. */
export function collidePotential(field: Field3D, x: number, y: number, z: number): number {
  return exclusionPotential(fieldMagnitudeSq(field, x, y, z));
}

/**
 * 𝒞_collide(u, b) := −∇Π(u(x_b)).
 *
 * Returns acceleration vector in lattice-space units. Caller converts to
 * world units by the same cellsPerUnit it already uses elsewhere.
 *
 * Closure relation: when the body sits at a local minimum of ‖u‖², all
 * three components are 0 — the body is at rest by the postulate, not by
 * a spring. That is the formal definition of "ground" in UQRC.
 */
export function causalCollide(
  field: Field3D,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const h = 0.5;
  const dPx = (collidePotential(field, x + h, y, z) - collidePotential(field, x - h, y, z)) / (2 * h);
  const dPy = (collidePotential(field, x, y + h, z) - collidePotential(field, x, y - h, z)) / (2 * h);
  const dPz = (collidePotential(field, x, y, z + h) - collidePotential(field, x, y, z - h)) / (2 * h);
  return [-dPx, -dPy, -dPz];
}
