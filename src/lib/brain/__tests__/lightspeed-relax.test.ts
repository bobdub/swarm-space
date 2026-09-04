import { describe, expect, it } from 'vitest';
import {
  createField3D,
  inject3D,
  pin3D,
  schedulePinRelaxation,
  step3D,
  FIELD3D_RELAX_PIN_SCALE,
} from '../../uqrc/field3D';
import { sunEarthRoundTrip, classifyCausalState, LATTICE_CELL, C_LIGHT, TICK_DT } from '../lightspeed';
import { SUN_POSITION, EARTH_RADIUS, getEarthPose } from '../earth';

describe('𝒞_light closure operator — surface relax', () => {
  it('I₆ spacing invariance: scheduled relax does not change ℓ_min or c', () => {
    // 𝒞_light(Δt_min) = ℓ_min must hold before and after the operator acts.
    const ellBefore = LATTICE_CELL;
    const cBefore = C_LIGHT;

    const field = createField3D();
    schedulePinRelaxation(field);
    step3D(field);

    expect(LATTICE_CELL).toBe(ellBefore);
    expect(C_LIGHT).toBe(cBefore);
    expect(C_LIGHT * TICK_DT).toBeCloseTo(LATTICE_CELL, 12);
  });

  it('leaves the light-speed probe observer-only', () => {
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
    const before = field.axes.map((axis) => new Float32Array(axis));
    const probe = sunEarthRoundTrip(field, pose);
    expect(classifyCausalState(probe)).toBe('saturated');
    for (let a = 0; a < before.length; a++) {
      expect(field.axes[a]).toEqual(before[a]);
    }
  });

  it('consumes reduced pin stiffness for exactly one operator step', () => {
    const field = createField3D(8);
    pin3D(field, 0, 4, 4, 4, 4);
    field.axes[0][4 + 8 * (4 + 8 * 4)] = 0;

    schedulePinRelaxation(field);
    expect(field.axes[0][4 + 8 * (4 + 8 * 4)]).toBe(0);
    step3D(field);
    expect(field.lastStepPinStiffnessScale).toBe(FIELD3D_RELAX_PIN_SCALE);
    expect(field.pendingPinStiffnessScale).toBeUndefined();
    step3D(field);
    expect(field.lastStepPinStiffnessScale).toBe(1);
  });
});
