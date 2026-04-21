/**
 * ═══════════════════════════════════════════════════════════════════════
 * ROUND UNIVERSE — boundary curvature shell
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The lattice already wraps toroidally at the index level, but visually
 * we want trajectories to *bend back* before reaching the world clamp.
 * applyRoundCurvature writes a soft cosine ramp into the field at the
 * outer ring so 𝒟_μ u quietly rotates near the edge — bodies experience
 * a gentle global curvature instead of a wall.
 *
 * No mesh, no skybox, no teleport. Just curvature.
 */

import { idx3, FIELD3D_AXES, type Field3D } from '../uqrc/field3D';

const RING_INNER_FRAC = 0.78;   // curvature ramp begins at 78% of the lattice
const RING_AMPLITUDE = 0.35;    // peak field bias at the outermost shell

/**
 * Adds a cosine-shaped potential well at the lattice boundary. Called once
 * at field init and re-asserted every ~4 s by the physics loop so live
 * dynamics don't erode it.
 */
export function applyRoundCurvature(field: Field3D, weight: number = 1.0): void {
  const N = field.N;
  const center = (N - 1) / 2;
  const innerR = (N / 2) * RING_INNER_FRAC;
  const outerR = N / 2;
  for (let k = 0; k < N; k++) {
    const dz = k - center;
    for (let j = 0; j < N; j++) {
      const dy = j - center;
      for (let i = 0; i < N; i++) {
        const dx = i - center;
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (r < innerR) continue;
        const t = Math.min(1, (r - innerR) / Math.max(1e-6, outerR - innerR));
        // Cosine ramp 0 → 1; alternates sign across axes to bend trajectories.
        const ramp = 0.5 - 0.5 * Math.cos(t * Math.PI);
        const bias = RING_AMPLITUDE * ramp * weight;
        const id = idx3(i, j, k, N);
        // Write a small bias on each axis so the gradient points inward.
        const inv = 1 / Math.max(1e-6, r);
        field.axes[0][id] += bias * dx * inv;
        field.axes[1][id] += bias * dy * inv;
        if (FIELD3D_AXES > 2) field.axes[2][id] += bias * dz * inv;
      }
    }
  }
}