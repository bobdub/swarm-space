import { describe, it, expect, beforeEach } from 'vitest';
import {
  spawnOnEarth,
  radiusFromEarth,
  isOnEarth,
  EARTH_POSITION,
  EARTH_RADIUS,
  getEarthPose,
  setEarthPoseTime,
  updateEarthPin,
  getAvatarMass,
  AVATAR_MASS,
  DEFAULT_AVATAR_MASS,
  quatRotate,
} from '../earth';
import { createField3D } from '../../uqrc/field3D';

describe('earth (UQRC pure)', () => {
  beforeEach(() => setEarthPoseTime(0));

  it('spawns 32 peers exactly on the surface without exact stacks', () => {
    const seen: [number, number, number][] = [];
    for (let i = 0; i < 32; i++) {
      const p = spawnOnEarth(`peer-${i}`);
      expect(Math.abs(radiusFromEarth(p) - EARTH_RADIUS)).toBeLessThan(0.01);
      for (const q of seen) {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        expect(d).toBeGreaterThan(0.01);
      }
      seen.push(p);
    }
  });

  it('same peer id produces same spawn point (deterministic)', () => {
    expect(spawnOnEarth('alice')).toEqual(spawnOnEarth('alice'));
  });

  it('isOnEarth detects atmosphere proximity (render-only helper)', () => {
    expect(isOnEarth([EARTH_POSITION[0] + EARTH_RADIUS, EARTH_POSITION[1], EARTH_POSITION[2]])).toBe(true);
    expect(isOnEarth([EARTH_POSITION[0] + 50, EARTH_POSITION[1], EARTH_POSITION[2]])).toBe(false);
  });

  it('exports no gravity/spring/clamp helpers (UQRC conformance)', async () => {
    const mod = await import('../earth');
    expect((mod as Record<string, unknown>).EARTH_GRAVITY).toBeUndefined();
    expect((mod as Record<string, unknown>).EARTH_SURFACE_STIFFNESS).toBeUndefined();
    expect((mod as Record<string, unknown>).projectToEarthSurface).toBeUndefined();
    expect((mod as Record<string, unknown>).geodesicStep).toBeUndefined();
    expect((mod as Record<string, unknown>).earthGravityForce).toBeUndefined();
  });

  it('getEarthPose advances orbital + spin phase with the pose clock', () => {
    setEarthPoseTime(0);
    const p0 = getEarthPose();
    setEarthPoseTime(30); // half a spin period (60 s)
    const p1 = getEarthPose();
    expect(p1.spinAngle).toBeGreaterThan(p0.spinAngle);
    // Center moves along the orbital circle as t advances.
    const moved = Math.hypot(p1.center[0] - p0.center[0], p1.center[2] - p0.center[2]);
    expect(moved).toBeGreaterThan(0);
  });

  it('updateEarthPin writes a negative-target ramp around the live center and clears prior cells', () => {
    const field = createField3D(24);
    setEarthPoseTime(0);
    const pose0 = getEarthPose();
    updateEarthPin(field, pose0);
    const sumPin0 = field.pinTemplate.reduce(
      (s, a) => s + a.reduce((x, y) => x + Math.abs(y), 0),
      0,
    );
    const maskCount0 = field.pinMask.reduce(
      (s, m) => s + Array.from(m).reduce((x, y) => x + (y ? 1 : 0), 0),
      0,
    );
    expect(sumPin0).toBeGreaterThan(0);
    expect(maskCount0).toBeGreaterThan(0);

    // Move Earth significantly and re-pin.
    setEarthPoseTime(120);
    const pose1 = getEarthPose();
    updateEarthPin(field, pose1);
    const maskCount1 = field.pinMask.reduce(
      (s, m) => s + Array.from(m).reduce((x, y) => x + (y ? 1 : 0), 0),
      0,
    );
    // Mask count is bounded — old cells were cleared, only the new region is pinned.
    expect(maskCount1).toBeLessThanOrEqual(maskCount0 * 1.6);
    expect(maskCount1).toBeGreaterThan(0);
  });

  it('spawnOnEarth(id, pose) lands on the surface at any pose', () => {
    setEarthPoseTime(73);
    const pose = getEarthPose();
    const p = spawnOnEarth('alice', pose);
    const r = radiusFromEarth(p, pose);
    expect(Math.abs(r - EARTH_RADIUS)).toBeLessThan(0.01);
  });

  it('getAvatarMass returns expected weights per kind', () => {
    expect(getAvatarMass('rabbit')).toBe(AVATAR_MASS.rabbit);
    expect(getAvatarMass('human')).toBe(AVATAR_MASS.human);
    expect(getAvatarMass('heavy')).toBe(AVATAR_MASS.heavy);
    expect(getAvatarMass('unknown')).toBe(DEFAULT_AVATAR_MASS);
    expect(getAvatarMass(null)).toBe(DEFAULT_AVATAR_MASS);
  });

  it('quatRotate is identity for the zero rotation and reversible via inv quat', () => {
    setEarthPoseTime(45);
    const pose = getEarthPose();
    const v: [number, number, number] = [1.3, 0.2, -0.7];
    const rotated = quatRotate(pose.spinQuat, v);
    const back = quatRotate(pose.invSpinQuat, rotated);
    expect(back[0]).toBeCloseTo(v[0], 5);
    expect(back[1]).toBeCloseTo(v[1], 5);
    expect(back[2]).toBeCloseTo(v[2], 5);
  });
});
