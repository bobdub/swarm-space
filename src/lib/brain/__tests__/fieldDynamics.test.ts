/**
 * fieldDynamics.test.ts — property tests for the three new step3D terms:
 *   𝒜_advect  — −(u·∇)u   carries momentum
 *   𝒫_pressure — −∇Π(u)    bumps decay & spread
 *   𝒢_mass    — −∇Φ        pin density carves a basin in ‖u‖²
 */
import { describe, it, expect } from 'vitest';
import {
  createField3D,
  step3D,
  inject3D,
  writePinTemplate,
  idx3,
  sample3D,
  FIELD3D_AXES,
} from '@/lib/uqrc/field3D';
import { collidePotential } from '../collide';

function magnitudeSqAt(field: ReturnType<typeof createField3D>, x: number, y: number, z: number): number {
  let s = 0;
  for (let a = 0; a < FIELD3D_AXES; a++) {
    const v = sample3D(field, a, x, y, z);
    s += v * v;
  }
  return s;
}

describe('fieldDynamics — formal UQRC field terms', () => {
  it('𝒜_advect: a tracer bump on axis-y is transported by uniform u_x', () => {
    const f = createField3D(24);
    // Uniform velocity field on axis 0 (advector). Use a strong u_x so the
    // advection term dominates Laplacian smoothing within the test window.
    for (let i = 0; i < f.axes[0].length; i++) f.axes[0][i] = 1.5;
    // Tracer bump on axis 1 at (8, 12, 12)
    inject3D(f, 1, 8, 12, 12, 1.0, 1.2);
    // Centre-of-mass of axis-1 magnitude along x near the bump (windowed).
    const com = (): number => {
      let num = 0, den = 0;
      for (let i = 5; i <= 18; i++) {
        const m = Math.abs(sample3D(f, 1, i, 12, 12));
        num += i * m; den += m;
      }
      return den > 0 ? num / den : 0;
    };
    const x0 = com();
    for (let s = 0; s < 8; s++) step3D(f);
    const x1 = com();
    // Centre of mass must shift forward in +x — the formal test of advection.
    expect(x1).toBeGreaterThan(x0);
  });

  it('𝒫_pressure: tall ‖u‖² bumps relax toward lower potential', () => {
    const f = createField3D(24);
    // Tall bump: high ‖u‖² => high Π. Pressure should decay it.
    inject3D(f, 0, 12, 12, 12, 2.5, 1.0);
    const piBefore = collidePotential(f, 12, 12, 12);
    for (let s = 0; s < 8; s++) step3D(f);
    const piAfter = collidePotential(f, 12, 12, 12);
    expect(piAfter).toBeLessThan(piBefore);
  });

  it('𝒢_mass: pin density at the centre carves a basin in ‖u‖²', () => {
    const f = createField3D(24);
    // Cluster of mass at lattice centre via pinTemplate (no body)
    const N = f.N;
    for (let dk = -2; dk <= 2; dk++) {
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          const flat = idx3(12 + di, 12 + dj, 12 + dk, N);
          for (let a = 0; a < FIELD3D_AXES; a++) writePinTemplate(f, a, flat, 1.0);
        }
      }
    }
    for (let s = 0; s < 30; s++) step3D(f);
    const mNear = magnitudeSqAt(f, 12 + 3, 12, 12);
    const mFar  = magnitudeSqAt(f, 12 + 8, 12, 12);
    // Closer to the mass, ‖u‖² should be larger than far away — the basin
    // is carved, gradient points inward (𝒞_collide will read it).
    expect(mNear).toBeGreaterThan(mFar);
  });
});
