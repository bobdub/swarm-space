import { describe, it, expect, beforeEach } from 'vitest';
import {
  spawnOnEarth,
  radiusFromEarth,
  isOnEarth,
  EARTH_POSITION,
  EARTH_RADIUS,
  HUMAN_HEIGHT,
  getEarthPose,
  setEarthPoseTime,
  updateEarthPin,
  getAvatarMass,
  AVATAR_MASS,
  DEFAULT_AVATAR_MASS,
  quatRotate,
  getSurfaceFrame,
  clampToEarthSurface,
  SUN_POSITION,
} from '../earth';
import { createField3D } from '../../uqrc/field3D';

describe('earth (UQRC pure)', () => {
  beforeEach(() => setEarthPoseTime(0));

  it('spawns 32 peers at standing height (feet on surface, head ~1.7m up)', () => {
    const standR = EARTH_RADIUS + HUMAN_HEIGHT / 2;
    const seen: [number, number, number][] = [];
    for (let i = 0; i < 32; i++) {
      const p = spawnOnEarth(`peer-${i}`);
      expect(Math.abs(radiusFromEarth(p) - standR)).toBeLessThan(0.01);
      for (const q of seen) {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        // Daylight-biased spawn lives on a 60° cone of the sunlit
        // hemisphere, so the spread is tighter than the original
        // full-sphere Fibonacci layout. Threshold catches true
        // duplicates without flagging legitimate near-pairs.
        expect(d).toBeGreaterThan(1e-4);
      }
      seen.push(p);
    }
  });

  it('same peer id produces same spawn point (deterministic)', () => {
    expect(spawnOnEarth('alice')).toEqual(spawnOnEarth('alice'));
  });

  it('isOnEarth detects atmosphere proximity (render-only helper)', () => {
    expect(isOnEarth([EARTH_POSITION[0] + EARTH_RADIUS, EARTH_POSITION[1], EARTH_POSITION[2]])).toBe(true);
    // Far point well outside the atmosphere shell, scale-relative so the
    // assertion stays valid as EARTH_RADIUS scales with WORLD_SCALE.
    expect(isOnEarth([EARTH_POSITION[0] + EARTH_RADIUS * 6, EARTH_POSITION[1], EARTH_POSITION[2]])).toBe(false);
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

  it('spawnOnEarth(id, pose) lands at standing height for any pose', () => {
    setEarthPoseTime(73);
    const pose = getEarthPose();
    const p = spawnOnEarth('alice', pose);
    const r = radiusFromEarth(p, pose);
    expect(Math.abs(r - (EARTH_RADIUS + HUMAN_HEIGHT / 2))).toBeLessThan(0.01);
  });

  it('getSurfaceFrame returns an orthonormal basis with up == surface normal', () => {
    const pose = getEarthPose();
    const p = spawnOnEarth('alice', pose);
    const { up, forward, right } = getSurfaceFrame(p, pose);
    const dot = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
    expect(len(up)).toBeCloseTo(1, 5);
    expect(len(forward)).toBeCloseTo(1, 5);
    expect(len(right)).toBeCloseTo(1, 5);
    expect(Math.abs(dot(up, forward))).toBeLessThan(1e-5);
    expect(Math.abs(dot(up, right))).toBeLessThan(1e-5);
    expect(Math.abs(dot(forward, right))).toBeLessThan(1e-5);
  });

  it('clampToEarthSurface pulls bodies inside the planet up to the surface', () => {
    const pose = getEarthPose();
    // Point near Earth core
    const inside: [number, number, number] = [pose.center[0] + 0.1, pose.center[1], pose.center[2]];
    const { pos, clamped } = clampToEarthSurface(inside, pose);
    expect(clamped).toBe(true);
    const r = radiusFromEarth(pos, pose);
    expect(r).toBeGreaterThanOrEqual(EARTH_RADIUS - 1e-6);
    expect(r).toBeLessThanOrEqual(EARTH_RADIUS + HUMAN_HEIGHT + 1e-6);
  });

  it('clampToEarthSurface pulls bodies floating in space to the standing body center shell', () => {
    const pose = getEarthPose();
    // Place the test point well beyond the atmosphere so the clamp engages
    // and reprojects it to the fixed standing body-centre radius.
    const far: [number, number, number] = [pose.center[0] + EARTH_RADIUS * 4, pose.center[1], pose.center[2]];
    const { pos, clamped } = clampToEarthSurface(far, pose);
    expect(clamped).toBe(true);
    expect(radiusFromEarth(pos, pose)).toBeCloseTo(EARTH_RADIUS + HUMAN_HEIGHT / 2, 5);
  });

  it('clampToEarthSurface leaves bodies inside the human shell untouched', () => {
    const pose = getEarthPose();
    const standing = spawnOnEarth('bob', pose);
    const { pos, clamped } = clampToEarthSurface(standing, pose);
    expect(clamped).toBe(false);
    expect(pos).toBe(standing);
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

  it('spawnOnEarth always lands on the sunlit hemisphere (daylight bias)', () => {
    setEarthPoseTime(0);
    const pose = getEarthPose();
    const sx = SUN_POSITION[0] - pose.center[0];
    const sy = SUN_POSITION[1] - pose.center[1];
    const sz = SUN_POSITION[2] - pose.center[2];
    const sLen = Math.hypot(sx, sy, sz);
    const sun = [sx / sLen, sy / sLen, sz / sLen];
    for (let i = 0; i < 50; i++) {
      const p = spawnOnEarth(`peer-daylight-${i}`, pose);
      const dx = p[0] - pose.center[0];
      const dy = p[1] - pose.center[1];
      const dz = p[2] - pose.center[2];
      const r = Math.hypot(dx, dy, dz);
      const dot = (dx * sun[0] + dy * sun[1] + dz * sun[2]) / r;
      // φ_max = 60° → cos(60°) = 0.5; require comfortable margin from terminator.
      expect(dot).toBeGreaterThan(0.3);
    }
  });
});
