import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS, earthLocalToWorld, getEarthPose, type EarthPose, type Vec3 } from '../earth';
import {
  canvasToMap, getNorthFrame, mapToCanvas, projectToMap, unprojectFromMap, worldToLocalNormal,
} from '../mapProjection';

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

function poseAtSpin(base: EarthPose, angle: number): EarthPose {
  const h = angle / 2;
  const q: [number, number, number, number] = [0, Math.sin(h), 0, Math.cos(h)];
  return { ...base, spinAngle: angle, spinQuat: q, invSpinQuat: [0, -q[1], 0, q[3]] };
}

describe('mapProjection', () => {
  const here = norm([0.6, 0.3, 0.74]);
  const frame = getNorthFrame(here);

  it('builds an orthonormal north-up frame', () => {
    const d = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(d(frame.east, frame.north)).toBeCloseTo(0, 9);
    expect(d(frame.east, frame.up)).toBeCloseTo(0, 9);
    expect(d(frame.north, frame.up)).toBeCloseTo(0, 9);
    // North leans toward the spin axis (+Y).
    expect(frame.north[1]).toBeGreaterThan(0);
  });

  it('round-trips map metres through the projection', () => {
    for (const [e, n] of [[0, 0], [120, -40], [-550, 300], [10, 590]] as const) {
      const p = projectToMap(frame, unprojectFromMap(frame, e, n));
      expect(p[0]).toBeCloseTo(e, 6);
      expect(p[1]).toBeCloseTo(n, 6);
    }
  });

  it('draws a point due north straight above the centre', () => {
    const north = unprojectFromMap(frame, 0, 200);
    const [px, py] = mapToCanvas(...projectToMap(frame, north), 280, 600);
    expect(px).toBeCloseTo(140, 6);
    expect(py).toBeLessThan(140);
    const [e, n] = canvasToMap(px, py, 280, 600);
    expect(e).toBeCloseTo(0, 6);
    expect(n).toBeCloseTo(200, 6);
  });

  it('keeps a spot on the ground fixed while Earth spins', () => {
    const base = getEarthPose();
    const spot = norm([0.2, -0.1, 0.97]);
    const world = (p: EarthPose) =>
      earthLocalToWorld([spot[0] * EARTH_RADIUS, spot[1] * EARTH_RADIUS, spot[2] * EARTH_RADIUS], p);
    const a = worldToLocalNormal(world(poseAtSpin(base, 0)), poseAtSpin(base, 0));
    const b = worldToLocalNormal(world(poseAtSpin(base, Math.PI)), poseAtSpin(base, Math.PI));
    for (let i = 0; i < 3; i++) {
      expect(a[i]).toBeCloseTo(spot[i], 9);
      expect(b[i]).toBeCloseTo(spot[i], 9);
    }
  });

  it('does not snap at a pole', () => {
    const prev = getNorthFrame(norm([0.01, 0.9999, 0]));
    const pole = getNorthFrame([0, 1, 0], prev);
    expect(Math.hypot(...pole.east)).toBeCloseTo(1, 9);
    expect(pole.east[0] * prev.east[0] + pole.east[1] * prev.east[1] + pole.east[2] * prev.east[2]).toBeGreaterThan(0.99);
  });
});
