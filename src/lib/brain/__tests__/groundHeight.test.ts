import { describe, it, expect, afterEach } from 'vitest';
import { BODY_CENTER_HEIGHT, EARTH_RADIUS, FOOT_CUSHION, getEarthPose, setEarthPoseTime, worldPosToLocalNormal, type Vec3 } from '../earth';
import { feetRadiusAt, groundElevationAt } from '../groundHeight';
import { sampleLandMask, WATER_WADE_DEPTH } from '../surfaceProfile';
import { UqrcPhysics } from '../uqrcPhysics';
import { surfaceHeading } from '../surfaceNavigation';

afterEach(() => setEarthPoseTime(null));

describe('solid globe floor', () => {
  it('provides a seabed below open water instead of supporting feet inside an unrendered shell', () => {
    let ocean: Vec3 | undefined;
    for (let i = 0; i < 360; i++) {
      const a = i * Math.PI / 180;
      const normal: Vec3 = [Math.cos(a), 0, Math.sin(a)];
      if (sampleLandMask(normal) === 0 && groundElevationAt(normal) < 0) { ocean = normal; break; }
    }
    expect(ocean).toBeDefined();
    if (!ocean) throw new Error('Expected an open ocean sample');
    expect(groundElevationAt(ocean)).toBe(-WATER_WADE_DEPTH);
    expect(feetRadiusAt(ocean)).toBeCloseTo(EARTH_RADIUS - WATER_WADE_DEPTH + FOOT_CUSHION, 8);
  });

  it('keeps walking feet above the shared terrain at distant sites and ocean crossings', () => {
    setEarthPoseTime(0);
    const physics = new UqrcPhysics();
    const pose = getEarthPose();
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12;
      const up: Vec3 = [Math.cos(a), Math.sin(a), 0];
      const local = worldPosToLocalNormal([
        pose.center[0] + up[0], pose.center[1] + up[1], pose.center[2] + up[2],
      ], pose);
      const r = feetRadiusAt(local) + BODY_CENTER_HEIGHT;
      const id = `walker-${i}`;
      const forward = surfaceHeading(up, [0, 0, 1], [1, 0, 0]);
      const right: Vec3 = [forward[1] * up[2] - forward[2] * up[1], forward[2] * up[0] - forward[0] * up[2], forward[0] * up[1] - forward[1] * up[0]];
      physics.addBody({ id, kind: 'self', pos: [pose.center[0] + up[0] * r, pose.center[1] + up[1] * r, pose.center[2] + up[2] * r], vel: [0, 0, 0], mass: 1.8, trust: 1, meta: { attachedTo: 'earth-surface' } });
      physics.setIntent(id, { fwd: 1, right: 1, yaw: a, basis: { up, forward, right } });
    }
    for (let tick = 0; tick < 1200; tick++) {
      (physics as unknown as { tick(): void }).tick();
      for (const body of physics.getBodies()) {
        const r = Math.hypot(body.pos[0] - pose.center[0], body.pos[1] - pose.center[1], body.pos[2] - pose.center[2]);
        expect(r - BODY_CENTER_HEIGHT - feetRadiusAt(worldPosToLocalNormal(body.pos, pose))).toBeGreaterThanOrEqual(-1e-8);
        expect(body.pos.every(Number.isFinite)).toBe(true);
      }
    }
  }, 30_000);
});