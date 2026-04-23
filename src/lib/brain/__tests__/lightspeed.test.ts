import { describe, it, expect } from 'vitest';
import {
  C_LIGHT,
  LATTICE_CELL,
  TICK_DT,
  causalConvert,
  refractiveIndex,
  traceCausalRay,
  sunEarthRoundTrip,
} from '../lightspeed';
import { createField3D, FIELD3D_N, step3D } from '../../uqrc/field3D';
import { getEarthPose } from '../earth';
import { updateLavaMantlePin } from '../lavaMantle';

describe('𝒞_light — Causal Conversion Operator', () => {
  it('closure: 𝒞_light(Δt_min) = ℓ_min', () => {
    expect(causalConvert(TICK_DT)).toBeCloseTo(LATTICE_CELL, 6);
    expect(C_LIGHT * TICK_DT).toBeCloseTo(LATTICE_CELL, 6);
  });

  it('identity at zero: causalConvert(0) === 0', () => {
    expect(causalConvert(0)).toBe(0);
  });

  it('flat field ⇒ no delay, n = 1', () => {
    const f = createField3D(FIELD3D_N);
    const probe = sunEarthRoundTrip(f);
    expect(probe.delay).toBeCloseTo(0, 4);
    expect(probe.surfaceN).toBeCloseTo(1, 4);
    expect(probe.actualDt).toBeCloseTo(probe.flatDt, 4);
  });

  it('curved field (lava-mantle pin) ⇒ delay > 0, n_surface > 1', () => {
    const f = createField3D(FIELD3D_N);
    updateLavaMantlePin(f, getEarthPose(), 0.001);
    // Bake pinTemplate into field.axes so the optical sample sees curvature.
    for (let i = 0; i < 5; i++) step3D(f);
    const probe = sunEarthRoundTrip(f);
    expect(probe.surfaceN).toBeGreaterThan(1);
    expect(probe.delay).toBeGreaterThan(0);
  });

  it('traceCausalRay along zero-length segment returns flatDt = 0', () => {
    const f = createField3D(FIELD3D_N);
    const r = traceCausalRay(f, [0, 0, 0], [0, 0, 0], 8);
    expect(r.length).toBe(0);
    expect(r.actualDt).toBe(0);
  });

  it('refractiveIndex of empty field is exactly 1', () => {
    const f = createField3D(FIELD3D_N);
    expect(refractiveIndex(f, [0, 0, 0])).toBeCloseTo(1, 6);
  });
});
