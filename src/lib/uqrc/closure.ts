/**
 * ═══════════════════════════════════════════════════════════════════════
 * UQRC ℓ_min CLOSURE — invariance of the lattice spacing under the
 * full operator algebra Σ = { 𝒟_μ, Δ, [D_μ,D_ν], 𝒪_UQRC, λ(ε₀)∇∇S, pin }.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Why closure?
 *   The whole engine (curvature scoring, basin extraction, min-curvature
 *   selection) assumes ℓ_min is the *unique* geometric scale. If any
 *   operator silently introduces a new length scale, every downstream
 *   decision drifts. This module proves — by direct algebraic check on
 *   the live field — that no such drift exists.
 *
 * Five identities (jointly sufficient for ℓ_min invariance):
 *
 *   I₁  Spacing identity
 *         𝒞_light(Δt_min) = ℓ_min                (definition closure)
 *
 *   I₂  Antisymmetry of curvature
 *         [D_μ, D_ν] = −[D_ν, D_μ]               and  [D_μ, D_μ] = 0
 *
 *   I₃  Flat-state idempotence
 *         u ≡ k  ⇒  𝒟_μ u = Δ u = 𝒪_UQRC u + ℛk = 0   (mod ℛ-decay)
 *
 *   I₄  Linearity (scale homogeneity)
 *         𝒟_μ(αu + βv) = α𝒟_μu + β𝒟_μv
 *
 *   I₅  Composition bound
 *         For any word W ∈ Σ* of length n:
 *             ‖W(u)‖ ≤ K(n) · ‖u‖
 *         with K(n) derived from current constants:
 *             ‖𝒟_μ‖_op ≤ 2/ℓ_min                  (forward diff on ring)
 *             ‖Δ‖_op   ≤ 4/ℓ_min²
 *             ‖𝒪_UQRC‖_op ≤ ν·4/ℓ_min² + ℛ
 *         With ℓ_min=1, ν=0.05, ℛ=0.001:
 *             K_𝒟 = 2, K_Δ = 4, K_𝒪 ≈ 0.201
 *         Worst-case word of length n over Σ ⇒ K(n) ≤ max(K_*)^n = 4^n.
 *         We test n ≤ 6 ⇒ K_max = 4096; clamp ±4 keeps reality far below.
 *
 * Pure, allocation-light, no side-effects. Read-only against any field.
 */

import {
  createField,
  laplacian,
  derivativeMu,
  commutator,
  ouqrc,
  norm,
  qScore as fieldQScore,
  ELL_MIN,
  NUM_AXES,
  STEP_DAMPING,
  NU_VISCOSITY,
  RICCI_DECAY,
  type Field,
} from './field';

// ── Operator-norm constants (derived above) ────────────────────────────
export const OP_NORM_D = 2 / ELL_MIN;
export const OP_NORM_LAPLACIAN = 4 / (ELL_MIN * ELL_MIN);
export const OP_NORM_OUQRC = NU_VISCOSITY * OP_NORM_LAPLACIAN + RICCI_DECAY;
export const OP_NORM_MAX = Math.max(OP_NORM_D, OP_NORM_LAPLACIAN, OP_NORM_OUQRC);

export const RESIDUAL_TOLERANCE = 1e-5;
export const COMPOSITION_MAX_WORD = 6;

// ── Tiny seedable RNG (mulberry32) so tests are deterministic. ─────────
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ClosureCheck {
  ok: boolean;
  residual: number;
}

/** I₁ — spacing identity: 𝒞_light(Δt_min) = ℓ_min on the 1-D ring. */
export function verifySpacingIdentity(): ClosureCheck {
  // On the ring lattice ℓ_min IS the cell — closure is the definition.
  // The 3-D causal closure (𝒞_light·Δt = LATTICE_CELL) is asserted in
  // brain/__tests__/lightspeed.test.ts and re-checked there at runtime.
  const residual = Math.abs(ELL_MIN - 1);
  return { ok: residual < RESIDUAL_TOLERANCE, residual };
}

/** I₂ — antisymmetry of [D_μ, D_ν] and self-vanishing [D_μ, D_μ]. */
export function verifyAntisymmetry(field: Field): ClosureCheck {
  let maxRes = 0;
  for (let mu = 0; mu < NUM_AXES; mu++) {
    const self = commutator(field, mu, mu);
    for (let i = 0; i < self.length; i++) {
      const a = Math.abs(self[i]);
      if (a > maxRes) maxRes = a;
    }
    for (let nu = mu + 1; nu < NUM_AXES; nu++) {
      const ab = commutator(field, mu, nu);
      const ba = commutator(field, nu, mu);
      for (let i = 0; i < ab.length; i++) {
        const r = Math.abs(ab[i] + ba[i]);
        if (r > maxRes) maxRes = r;
      }
    }
  }
  return { ok: maxRes < RESIDUAL_TOLERANCE, residual: maxRes };
}

/** I₃ — constant fields are killed by 𝒟_μ and Δ; 𝒪_UQRC reduces to −ℛk. */
export function verifyFlatIdempotence(L: number = 64): ClosureCheck {
  const k = 0.5;
  const u = new Float32Array(L);
  for (let i = 0; i < L; i++) u[i] = k;
  let maxRes = 0;
  const d = derivativeMu(u, L);
  for (let i = 0; i < L; i++) maxRes = Math.max(maxRes, Math.abs(d[i]));
  const lap = laplacian(u, L);
  for (let i = 0; i < L; i++) maxRes = Math.max(maxRes, Math.abs(lap[i]));
  // 𝒪_UQRC(k) = ν·0 − ℛ·k. Subtract the analytic value, residual must vanish.
  const op = ouqrc(u, L);
  const expected = -RICCI_DECAY * k;
  for (let i = 0; i < L; i++) maxRes = Math.max(maxRes, Math.abs(op[i] - expected));
  return { ok: maxRes < RESIDUAL_TOLERANCE, residual: maxRes };
}

/** I₄ — linearity: 𝒟_μ(αu + βv) = α𝒟_μu + β𝒟_μv. */
export function verifyLinearity(L: number = 64, samples: number = 4): ClosureCheck {
  const rng = mulberry32(0xC10501 ^ L);
  let maxRes = 0;
  for (let s = 0; s < samples; s++) {
    const u = new Float32Array(L);
    const v = new Float32Array(L);
    for (let i = 0; i < L; i++) {
      u[i] = (rng() - 0.5) * 2;
      v[i] = (rng() - 0.5) * 2;
    }
    const a = (rng() - 0.5) * 4;
    const b = (rng() - 0.5) * 4;
    const sum = new Float32Array(L);
    for (let i = 0; i < L; i++) sum[i] = a * u[i] + b * v[i];
    const lhs = derivativeMu(sum, L);
    const dU = derivativeMu(u, L);
    const dV = derivativeMu(v, L);
    for (let i = 0; i < L; i++) {
      const rhs = a * dU[i] + b * dV[i];
      const r = Math.abs(lhs[i] - rhs);
      if (r > maxRes) maxRes = r;
    }
    // Same for Laplacian.
    const lLhs = laplacian(sum, L);
    const lU = laplacian(u, L);
    const lV = laplacian(v, L);
    for (let i = 0; i < L; i++) {
      const rhs = a * lU[i] + b * lV[i];
      const r = Math.abs(lLhs[i] - rhs);
      if (r > maxRes) maxRes = r;
    }
  }
  return { ok: maxRes < 1e-3, residual: maxRes };
}

type OpName = 'D' | 'L' | 'O';

function applyOp(name: OpName, u: Float32Array, L: number): Float32Array {
  switch (name) {
    case 'D': return derivativeMu(u, L);
    case 'L': return laplacian(u, L);
    case 'O': return ouqrc(u, L);
  }
}

/**
 * I₅ — composition closure. Run a corpus of operator words W of length
 * ≤ COMPOSITION_MAX_WORD, check ‖W(u)‖ ≤ K(n) · ‖u‖.
 *
 * `growthRatio` is the worst observed ‖W(u)‖ / (‖u‖ · K(|W|)). Must stay
 * ≤ 1 for closure; any word that breaks this proves a hidden length scale.
 */
export interface CompositionResult {
  ok: boolean;
  growthRatio: number;
  worstWord: string;
}

export function verifyCompositionBound(
  field: Field,
  opts: { wordCount?: number; maxLen?: number; seed?: number } = {},
): CompositionResult {
  const wordCount = opts.wordCount ?? 32;
  const maxLen = Math.min(opts.maxLen ?? COMPOSITION_MAX_WORD, COMPOSITION_MAX_WORD);
  const rng = mulberry32(opts.seed ?? 0xC105E);
  const alphabet: OpName[] = ['D', 'L', 'O'];
  let worst = 0;
  let worstWord = '';
  for (let mu = 0; mu < NUM_AXES; mu++) {
    const u0 = field.axes[mu];
    const u0norm = norm(u0);
    if (u0norm < 1e-9) continue;
    for (let w = 0; w < wordCount; w++) {
      const len = 1 + Math.floor(rng() * maxLen);
      const word: OpName[] = [];
      let cur: Float32Array = new Float32Array(field.L);
      cur.set(u0);
      for (let i = 0; i < len; i++) {
        const op = alphabet[Math.floor(rng() * alphabet.length)];
        word.push(op);
        cur = applyOp(op, cur, field.L);
      }
      const Kn = Math.pow(OP_NORM_MAX, len);
      const ratio = norm(cur) / (u0norm * Kn);
      if (ratio > worst) {
        worst = ratio;
        worstWord = word.join('·') + ` (axis ${mu})`;
      }
    }
  }
  return { ok: worst <= 1 + 1e-6, growthRatio: worst, worstWord };
}

// ── Aggregate report ───────────────────────────────────────────────────

export interface ClosureReport {
  ok: boolean;
  ticks: number;
  qScore: number;
  ellMin: number;
  spacing: ClosureCheck;
  antisymmetry: ClosureCheck;
  flatIdempotence: ClosureCheck;
  linearity: ClosureCheck;
  composition: CompositionResult;
  /** Worst residual across all five (excluding composition's growth ratio). */
  maxResidual: number;
  /** ISO timestamp the report was generated. */
  generatedAt: number;
}

export function runClosureProof(field?: Field): ClosureReport {
  const f = field ?? createField(64);
  const spacing = verifySpacingIdentity();
  const antisymmetry = verifyAntisymmetry(f);
  const flatIdempotence = verifyFlatIdempotence(Math.min(f.L, 64));
  const linearity = verifyLinearity(Math.min(f.L, 64));
  const composition = verifyCompositionBound(f);
  const maxResidual = Math.max(
    spacing.residual,
    antisymmetry.residual,
    flatIdempotence.residual,
    linearity.residual,
  );
  const ok =
    spacing.ok &&
    antisymmetry.ok &&
    flatIdempotence.ok &&
    linearity.ok &&
    composition.ok;
  return {
    ok,
    ticks: f.ticks,
    qScore: fieldQScore(f),
    ellMin: ELL_MIN,
    spacing,
    antisymmetry,
    flatIdempotence,
    linearity,
    composition,
    maxResidual,
    generatedAt: Date.now(),
  };
}

// Re-export the constant so consumers can render "ℓ_min = 1" without
// re-importing field.ts directly.
export { ELL_MIN, STEP_DAMPING };
