/**
 * ═══════════════════════════════════════════════════════════════════════
 * HORIZON FADE — "evolution horizon" coherence ramp
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Walking far in one direction on the small planet exposes the curvature
 * horizon (~76 m at current scale). Past it, the renderer was tearing
 * because geometry tried to resolve a region whose UQRC coherence loop
 * `||[D_μ, D_ν]||` already exceeded threshold for the local frame.
 *
 * Treat the horizon not as a clipping plane but as an *evolution horizon*:
 * the field is allowed to evolve out of view through a smooth alpha ramp,
 * not snap. Renderers and shaders consume `evolutionHorizonAlpha` as a
 * single source of truth so fog, LOD swap, and any future per-mesh
 * effects all share the same fade window.
 *
 * Pure module — no field, no React, no Three imports. The companion
 * `<HorizonFog>` component reads these constants and emits the actual
 * scene-graph node.
 */

import { EARTH_RADIUS, EYE_LIFT } from './earth';

/**
 * Geometric horizon distance for an observer of height `EYE_LIFT` above
 * the visible ground: `d = √(2·R·h)`. At R=1700 m, h≈0.75 m → ~50.5 m.
 * Computed lazily from the Earth scale so it tracks any future rescale.
 */
export const HORIZON_M: number = Math.sqrt(2 * EARTH_RADIUS * Math.max(0.1, EYE_LIFT));

/** Inner edge of the fade band (full opacity inside this radius). */
export const HORIZON_FADE_INNER: number = HORIZON_M * 0.85;
/** Outer edge of the fade band (zero opacity beyond this radius). */
export const HORIZON_FADE_OUTER: number = HORIZON_M * 1.15;

function smoothstep01(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u * u * (3 - 2 * u);
}

/**
 * Smooth `1 → 0` ramp over `[HORIZON_FADE_INNER, HORIZON_FADE_OUTER]`.
 * `1` means fully visible (inside the horizon), `0` means fully evolved
 * out (beyond the horizon).
 */
export function evolutionHorizonAlpha(distMetres: number): number {
  if (distMetres <= HORIZON_FADE_INNER) return 1;
  if (distMetres >= HORIZON_FADE_OUTER) return 0;
  const u = (distMetres - HORIZON_FADE_INNER) /
    Math.max(1e-6, HORIZON_FADE_OUTER - HORIZON_FADE_INNER);
  return 1 - smoothstep01(u);
}

/** Convenience predicate used by LOD switches. */
export function isBeyondHorizon(distMetres: number): boolean {
  return distMetres >= HORIZON_FADE_OUTER;
}