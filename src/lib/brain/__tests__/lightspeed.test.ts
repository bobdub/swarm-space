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
import { createField3D, FIELD3D_N, inject3D, FIELD3D_AXES } from '../../uqrc/field3D';
import { getEarthPose, EARTH_RADIUS, SUN_POSITION } from '../earth';

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
});
