/**
 * ═══════════════════════════════════════════════════════════════════════
 * ROUND UNIVERSE — boundary curvature baked into pinTemplate
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Under UQRC the boundary cannot be a per-tick force — that would mutate
 * `u` outside 𝒪_UQRC and break the [𝒟_μ, 𝒟_ν] guarantee. Instead, the
 * cosine ramp is written *once* into `pinTemplate`. The operator's
 * L_S^pin term re-asserts it every tick, smoothly. The non-zero local
 * commutator near the shell is exactly what bends trajectories back —
 * curvature *is* the boundary, the postulate at work.
 */

import { idx3, FIELD3D_AXES, writePinTemplate, type Field3D } from '../uqrc/field3D';

const RING_INNER_FRAC = 0.78;
const RING_AMPLITUDE = 0.35;

/**
 * Bakes a cosine-shaped potential basin at the lattice boundary into
 * `pinTemplate`. Idempotent — calling twice with weight=1 produces the
 * same template (the second call simply overwrites the same cells).
 * Called once at field init; the operator carries it from there.
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
        const ramp = 0.5 - 0.5 * Math.cos(t * Math.PI);
        const bias = RING_AMPLITUDE * ramp * weight;
        const id = idx3(i, j, k, N);
        const inv = 1 / Math.max(1e-6, r);
        writePinTemplate(field, 0, id, bias * dx * inv);
        writePinTemplate(field, 1, id, bias * dy * inv);
        if (FIELD3D_AXES > 2) writePinTemplate(field, 2, id, bias * dz * inv);
      }
    }
  }
}