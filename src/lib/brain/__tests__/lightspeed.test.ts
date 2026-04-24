import { describe, it, expect } from 'vitest';
import {
  C_LIGHT,
  LATTICE_CELL,
  TICK_DT,
  causalConvert,
  refractiveIndex,
  traceCausalRay,
  sunEarthRoundTrip,
  speedLimitFromMph,
  MPH_TO_MPS,
  classifyCausalState,
} from '../lightspeed';
import { createField3D, FIELD3D_N, inject3D, FIELD3D_AXES } from '../../uqrc/field3D';
import { getEarthPose, EARTH_RADIUS, SUN_POSITION } from '../earth';

describe('𝒞_light — dead-state classifier', () => {
  it('flat field ⇒ dead', () => {
    const f = createField3D(FIELD3D_N);
    const probe = sunEarthRoundTrip(f);
    expect(classifyCausalState(probe)).toBe('dead');
  });

  it('saturated ceiling with flat gradient ⇒ saturated', () => {
    const probe = {
      flatDt: 0.05,
      actualDt: 0.165,
      delay: 0.115,
      surfaceN: 5.0,
      surfaceGradMag: 0,
      rayLength: 1500,
    };
    expect(classifyCausalState(probe)).toBe('saturated');
  });

  it('ceiling with non-trivial gradient + tiny delta ⇒ creep', () => {
    const cur = {
      flatDt: 0.05, actualDt: 0.166, delay: 0.116,
      surfaceN: 5.0, surfaceGradMag: 0.01, rayLength: 1500,
    };
    const prev = { delay: 0.11598, surfaceN: 5.0, surfaceGradMag: 0.01 };
    expect(classifyCausalState(cur, prev)).toBe('creep');
  });

  it('evolving delay below ceiling ⇒ live', () => {
    const cur = {
      flatDt: 0.05, actualDt: 0.10, delay: 0.05,
      surfaceN: 2.0, surfaceGradMag: 0.5, rayLength: 1500,
    };
    const prev = { delay: 0.02, surfaceN: 1.5, surfaceGradMag: 0.4 };
    expect(classifyCausalState(cur, prev)).toBe('live');
  });
});

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
    // Inject a strong field bump at Earth's Sun-facing surface — this is
    // the same effect the lava-mantle pin would produce after the field
    // has settled. Bypassing step3D keeps the bake numerically stable.
    const pose = getEarthPose();
    const sx = SUN_POSITION[0] - pose.center[0];
    const sy = SUN_POSITION[1] - pose.center[1];
    const sz = SUN_POSITION[2] - pose.center[2];
    const r = Math.hypot(sx, sy, sz) || 1;
    const surface: [number, number, number] = [
      pose.center[0] + (sx / r) * EARTH_RADIUS,
      pose.center[1] + (sy / r) * EARTH_RADIUS,
      pose.center[2] + (sz / r) * EARTH_RADIUS,
    ];
    // Lattice coords for inject3D.
    const N = f.N;
    const WORLD_SIZE_LOCAL = 60 * 212.5;
    const lx = ((surface[0] / WORLD_SIZE_LOCAL + 0.5) * N + N) % N;
    const ly = ((surface[1] / WORLD_SIZE_LOCAL + 0.5) * N + N) % N;
    const lz = ((surface[2] / WORLD_SIZE_LOCAL + 0.5) * N + N) % N;
    for (let a = 0; a < FIELD3D_AXES; a++) {
      inject3D(f, a, lx, ly, lz, 1.5, 2.0);
    }
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

  it('speedLimitFromMph: 5 mph maps to ≈ 2.2352 m/s and respects 𝒞_light closure', () => {
    const v = speedLimitFromMph(5);
    expect(v).toBeCloseTo(5 * MPH_TO_MPS, 9);
    expect(v).toBeCloseTo(2.2352, 4);
    // Per-tick step must be strictly under one lattice cell.
    expect(v * TICK_DT).toBeLessThan(LATTICE_CELL);
    // Sanity: walk speed is many orders of magnitude under c_sim.
    expect(v).toBeLessThan(C_LIGHT);
  });

  it('speedLimitFromMph throws when the per-tick step would breach the lattice cell', () => {
    // c_sim ≈ 31 875 m/s ≈ 71 295 mph — pick something well above that.
    expect(() => speedLimitFromMph(1_000_000)).toThrow(/𝒞_light closure/);
  });
});
