import { describe, it, expect } from 'vitest';
import { createField3D } from '@/lib/uqrc/field3D';
import { initLavaMantle, updateLavaMantlePin } from '../lavaMantle';
import { getEarthPose } from '../earth';

describe('lavaMantle', () => {
  it('produces a finite, bounded pin field on init', () => {
    const f = createField3D(24);
    initLavaMantle(f);
    let max = 0;
    for (let a = 0; a < 3; a++) {
      for (let i = 0; i < f.pinTemplate[a].length; i++) {
        const v = f.pinTemplate[a][i];
        expect(Number.isFinite(v)).toBe(true);
        if (Math.abs(v) > max) max = Math.abs(v);
      }
    }
    expect(max).toBeGreaterThan(0);   // wrote something
    expect(max).toBeLessThan(10);     // not exploding
  });

  it('does not re-stamp on every call (uses diffusion between writes)', () => {
    const f = createField3D(24);
    initLavaMantle(f);
    const snap = new Float32Array(f.pinTemplate[0]);
    // Same tick → no rewrite, identical template.
    updateLavaMantlePin(f, getEarthPose(), 0.001);
    for (let i = 0; i < snap.length; i++) {
      expect(f.pinTemplate[0][i]).toBe(snap[i]);
    }
  });

  it('stamps with no per-frame amplitude jitter at a fixed cell', () => {
    const f = createField3D(24);
    initLavaMantle(f);
    // Pick the strongest cell and confirm successive writes (advancing
    // ticks past the re-assert window) change by a small amount only.
    let strongestIdx = 0;
    let strongestVal = 0;
    for (let i = 0; i < f.pinTemplate[0].length; i++) {
      const v = Math.abs(f.pinTemplate[0][i]);
      if (v > strongestVal) {
        strongestVal = v;
        strongestIdx = i;
      }
    }
    const v0 = f.pinTemplate[0][strongestIdx];
    f.ticks += 100;
    updateLavaMantlePin(f, getEarthPose(), 1.0);
    const v1 = f.pinTemplate[0][strongestIdx];
    // Frame-to-frame change must be tiny (spatial wave, not amplitude flicker).
    expect(Math.abs(v1 - v0)).toBeLessThan(Math.abs(v0) * 0.1 + 1e-3);
  });
});
