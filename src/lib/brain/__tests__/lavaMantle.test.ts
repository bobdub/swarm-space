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

describe('lavaMantle — surface plateau is time-invariant', () => {
  it('cells in the outermost shell never change value as time advances', async () => {
    const { createField3D } = await import('@/lib/uqrc/field3D');
    const { initLavaMantle, updateLavaMantlePin } = await import('../lavaMantle');
    const { getEarthPose, EARTH_RADIUS } = await import('../earth');
    const { worldToLattice, WORLD_SIZE } = await import('../uqrcPhysics');

    const f = createField3D(24);
    initLavaMantle(f);
    // Pick a surface cell near pose.center + EARTH_RADIUS along +x.
    const pose = getEarthPose();
    const N = f.N;
    const cellsPerUnit = N / WORLD_SIZE;
    const ei = Math.round(worldToLattice(pose.center[0], N));
    const ej = Math.round(worldToLattice(pose.center[1], N));
    const ek = Math.round(worldToLattice(pose.center[2], N));
    const surfaceOffset = Math.floor(EARTH_RADIUS * cellsPerUnit);
    const idx =
      ((ei + surfaceOffset + N) % N) +
      N * ((ej + N) % N) +
      N * N * ((ek + N) % N);
    const v0 = f.pinTemplate[0][idx];

    // Advance time + ticks past the re-assert window several times.
    for (let step = 1; step <= 5; step++) {
      f.ticks += 100;
      updateLavaMantlePin(f, pose, step * 6); // 6, 12, 18, 24, 30 s
      const v = f.pinTemplate[0][idx];
      // Surface plateau is time-invariant by construction.
      expect(Math.abs(v - v0)).toBeLessThan(1e-6);
    }
  });
});
