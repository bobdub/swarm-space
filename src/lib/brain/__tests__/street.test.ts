import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildStreet,
  registerStreetParticles,
  streetLocalToWorld,
  projectToStreet,
  INTERIOR_RADIUS,
  STANDING_RADIUS,
  LAND_RADIUS,
  resetStreetForTests,
  getStreet,
} from '../street';
import {
  getEarthPose,
  setEarthPoseTime,
  spawnOnStreet,
  getInteriorSurfaceFrame,
  HUMAN_HEIGHT,
} from '../earth';
import { createField3D } from '../../uqrc/field3D';

describe('street (UQRC interior patch)', () => {
  beforeEach(() => {
    setEarthPoseTime(0);
    resetStreetForTests();
  });

  it('every particle sits on the STANDING sphere (== where feet rest)', () => {
    const street = buildStreet();
    expect(street.particles.length).toBeGreaterThan(20);
    for (const p of street.particles) {
      const r = Math.hypot(p.local[0], p.local[1], p.local[2]);
      expect(Math.abs(r - STANDING_RADIUS)).toBeLessThan(1e-3);
    }
  });

  it('street tangent is orthogonal to the patch normal', () => {
    const s = buildStreet();
    const dot =
      s.normalLocal[0] * s.tangentLocal[0] +
      s.normalLocal[1] * s.tangentLocal[1] +
      s.normalLocal[2] * s.tangentLocal[2];
    expect(Math.abs(dot)).toBeLessThan(1e-5);
  });

  it('registerStreetParticles writes UQRC pins (mass becomes visible to the field)', () => {
    const field = createField3D(24);
    const street = buildStreet();
    const before = field.pins.size;
    registerStreetParticles(field, street, getEarthPose());
    expect(field.pins.size).toBeGreaterThan(before);
  });

  it('co-rotation: streetLocalToWorld at t=0 vs t=30s differs (Earth spun)', () => {
    setEarthPoseTime(0);
    const local = buildStreet().centerLocal;
    const w0 = streetLocalToWorld(local, getEarthPose());
    setEarthPoseTime(30);
    const w1 = streetLocalToWorld(local, getEarthPose());
    const moved = Math.hypot(w0[0] - w1[0], w0[1] - w1[1], w0[2] - w1[2]);
    expect(moved).toBeGreaterThan(0);
  });

  it('spawnOnStreet places the body INSIDE Earth (radius < INTERIOR_RADIUS)', () => {
    const pose = getEarthPose();
    const street = getStreet();
    const init = spawnOnStreet('alice', pose, street, 0);
    const dx = init.pos[0] - pose.center[0];
    const dy = init.pos[1] - pose.center[1];
    const dz = init.pos[2] - pose.center[2];
    const r = Math.hypot(dx, dy, dz);
    // Body center is HUMAN_HEIGHT/2 inward of the STANDING sphere; feet
    // touch STANDING_RADIUS exactly.
    const expected = STANDING_RADIUS - HUMAN_HEIGHT / 2;
    expect(r).toBeLessThan(STANDING_RADIUS);
    expect(r).toBeGreaterThan(STANDING_RADIUS - HUMAN_HEIGHT);
    expect(Math.abs(r - expected)).toBeLessThan(1e-3);
    expect(init.meta.attachedTo).toBe('earth-interior');
  });

  it('different peer ids produce different (but nearby) interior spawn points', () => {
    const pose = getEarthPose();
    const street = getStreet();
    const a = spawnOnStreet('alice', pose, street, 0).pos;
    const b = spawnOnStreet('bob', pose, street, 1).pos;
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(d).toBeGreaterThan(0.1);
    expect(d).toBeLessThan(LAND_RADIUS * 2.5);
  });

  it('getInteriorSurfaceFrame gives an inward-pointing up (opposite of outward radial)', () => {
    const pose = getEarthPose();
    const init = spawnOnStreet('alice', pose, getStreet(), 0);
    const { up, forward, right } = getInteriorSurfaceFrame(init.pos, pose);
    // up should point toward Earth center (i.e. cavity hollow).
    const dx = init.pos[0] - pose.center[0];
    const dy = init.pos[1] - pose.center[1];
    const dz = init.pos[2] - pose.center[2];
    const r = Math.hypot(dx, dy, dz) || 1;
    const dot = up[0] * (dx / r) + up[1] * (dy / r) + up[2] * (dz / r);
    expect(dot).toBeLessThan(-0.99);
    // Orthonormal basis.
    const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
    expect(len(up)).toBeCloseTo(1, 5);
    expect(len(forward)).toBeCloseTo(1, 5);
    expect(len(right)).toBeCloseTo(1, 5);
  });

  it('projectToStreet snaps any point onto the inner shell', () => {
    const pose = getEarthPose();
    const w = projectToStreet([pose.center[0] + 50, pose.center[1], pose.center[2]], pose);
    const r = Math.hypot(w[0] - pose.center[0], w[1] - pose.center[1], w[2] - pose.center[2]);
    expect(r).toBeCloseTo(STANDING_RADIUS, 5);
  });
});
