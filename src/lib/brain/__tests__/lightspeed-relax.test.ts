import { describe, expect, it } from 'vitest';
import { createField3D, inject3D, step3D } from '../../uqrc/field3D';
import { sunEarthRoundTrip, classifyCausalState, relaxSurfaceBasin, LATTICE_CELL, C_LIGHT, TICK_DT } from '../lightspeed';
import { SUN_POSITION, EARTH_RADIUS, getEarthPose } from '../earth';

describe('𝒞_light closure operator — surface relax', () => {
  it('I₆ spacing invariance: relax does not change ℓ_min or c', () => {
    // 𝒞_light(Δt_min) = ℓ_min must hold before and after the operator acts.
    const ellBefore = LATTICE_CELL;
    const cBefore = C_LIGHT;

    const field = createField3D();
    const pose = getEarthPose();
    relaxSurfaceBasin(field, pose);

    expect(LATTICE_CELL).toBe(ellBefore);
    expect(C_LIGHT).toBe(cBefore);
    expect(C_LIGHT * TICK_DT).toBeCloseTo(LATTICE_CELL, 12);
  });

  it('drives a saturated basin back toward live', () => {
    const field = createField3D();
    const pose = getEarthPose();
    const sx = SUN_POSITION[0]-pose.center[0], sy = SUN_POSITION[1]-pose.center[1], sz = SUN_POSITION[2]-pose.center[2];
    const r = Math.hypot(sx,sy,sz);
    const surf:[number,number,number] = [
      pose.center[0]+(sx/r)*EARTH_RADIUS,
      pose.center[1]+(sy/r)*EARTH_RADIUS,
      pose.center[2]+(sz/r)*EARTH_RADIUS,
    ];
    const N = field.N;
    // Saturate the surface
    for (let t=0; t<70; t++) {
      for (let a=0; a<3; a++) {
        inject3D(field, a, (surf[0]/12750+0.5)*N, (surf[1]/12750+0.5)*N, (surf[2]/12750+0.5)*N, 0.8, 1.8);
      }
      const next = step3D(field);
      for (let a=0; a<3; a++) field.axes[a] = next.axes[a];
    }
    const before = sunEarthRoundTrip(field, pose);
    expect(classifyCausalState(before)).toBe('saturated');
    const nBefore = before.surfaceN;

    // Apply relax 5 times then step a few ticks
    for (let i=0; i<5; i++) relaxSurfaceBasin(field, pose);
    for (let t=0; t<5; t++) {
      const next = step3D(field);
      for (let a=0; a<3; a++) field.axes[a] = next.axes[a];
    }
    const after = sunEarthRoundTrip(field, pose);
    // n_surface must drop strictly below pre-relax value
    expect(after.surfaceN).toBeLessThan(nBefore);
  });
});
