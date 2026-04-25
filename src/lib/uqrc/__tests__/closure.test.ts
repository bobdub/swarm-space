import { describe, expect, it } from 'vitest';
import {
  runClosureProof,
  verifySpacingIdentity,
  verifyAntisymmetry,
  verifyFlatIdempotence,
  verifyLinearity,
  verifyCompositionBound,
  RESIDUAL_TOLERANCE,
} from '../closure';
import { createField, inject, pin, step } from '../field';

describe('UQRC ℓ_min closure — operator algebra invariance', () => {
  it('I₁ spacing identity: 𝒞_light(Δt_min) = ℓ_min', () => {
    const r = verifySpacingIdentity();
    expect(r.ok).toBe(true);
    expect(r.residual).toBeLessThan(RESIDUAL_TOLERANCE);
  });

  it('I₂ antisymmetry: [D_μ,D_ν] = −[D_ν,D_μ] on a perturbed field', () => {
    const f = createField(64);
    inject(f, 'duck waterfowl pond', 0.5, 0);
    inject(f, 'pond water bird', 0.4, 1);
    inject(f, 'reward signal', 0.3, 2);
    const r = verifyAntisymmetry(f);
    expect(r.ok).toBe(true);
  });

  it('I₃ flat-state idempotence: constant fields are operator-quiet', () => {
    const r = verifyFlatIdempotence(64);
    expect(r.ok).toBe(true);
  });

  it('I₄ linearity: 𝒟_μ and Δ are linear operators', () => {
    const r = verifyLinearity(64, 8);
    expect(r.ok).toBe(true);
  });

  it('I₅ composition bound: ‖W(u)‖ ≤ K(|W|)·‖u‖ for words of length ≤ 6', () => {
    const f = createField(64);
    inject(f, 'imagination network swarm', 0.4, 0);
    inject(f, 'context drift token', 0.3, 1);
    inject(f, 'reward bump', 0.2, 2);
    const r = verifyCompositionBound(f, { wordCount: 64, maxLen: 6, seed: 1234 });
    expect(r.ok, `worst word ${r.worstWord} ratio ${r.growthRatio}`).toBe(true);
    expect(r.growthRatio).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('runClosureProof on a freshly-evolved live engine state', () => {
    const f = createField(128);
    inject(f, 'alpha beta gamma', 0.4, 0);
    inject(f, 'delta epsilon', 0.3, 1);
    pin(f, 'definition anchor', 1.0, 0);
    for (let i = 0; i < 200; i++) step(f);
    const report = runClosureProof(f);
    expect(report.ok, JSON.stringify(report, null, 2)).toBe(true);
    expect(report.ellMin).toBe(1);
    expect(report.composition.growthRatio).toBeLessThanOrEqual(1 + 1e-6);
  });
});
