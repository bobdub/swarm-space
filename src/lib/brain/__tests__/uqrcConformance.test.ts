import { describe, it, expect } from 'vitest';
import { createField3D, step3D, inject3D, commutatorNorm3D, FIELD3D_BOUND } from '../../uqrc/field3D';
import { applyRoundCurvature } from '../roundUniverse';
import { applyGalaxyToField, getGalaxy } from '../galaxy';

describe('UQRC conformance', () => {
  it('commutator norm stays bounded over 1000 ticks with random injections', () => {
    const f = createField3D(16);
    applyRoundCurvature(f, 1);
    applyGalaxyToField(f, getGalaxy());
    let maxC = 0;
    for (let t = 0; t < 1000; t++) {
      if (t % 50 === 0) {
        inject3D(f, 0, Math.random() * 16, Math.random() * 16, Math.random() * 16, 0.4, 1.5);
      }
      step3D(f);
      if (t % 100 === 0) maxC = Math.max(maxC, commutatorNorm3D(f));
    }
    expect(maxC).toBeLessThan(2.0);
    expect(Number.isFinite(maxC)).toBe(true);
  });

  it('global regularity: field stays smooth and bounded for 2000 ticks', () => {
    const f = createField3D(12);
    applyRoundCurvature(f, 1);
    for (let t = 0; t < 2000; t++) {
      step3D(f);
    }
    for (const axis of f.axes) {
      for (let i = 0; i < axis.length; i++) {
        expect(Number.isFinite(axis[i])).toBe(true);
        expect(Math.abs(axis[i])).toBeLessThanOrEqual(FIELD3D_BOUND + 0.01);
      }
    }
  });
});