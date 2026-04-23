import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEarthPose, quatRotate, setEarthPoseTime, spawnOnEarth } from '../earth';
import { integrateCoRotatingBody, PHYSICS_HZ } from '../uqrcPhysics';

describe('uqrcPhysics co-rotating transport', () => {
  beforeEach(() => setEarthPoseTime(0));
  afterEach(() => setEarthPoseTime(null));

  it('keeps a resting surface body on the same Earth-local site across pose updates', () => {
    const prevPose = getEarthPose();
    const start = spawnOnEarth('alice', prevPose);
    const localStart = quatRotate(prevPose.invSpinQuat, [
      start[0] - prevPose.center[0],
      start[1] - prevPose.center[1],
      start[2] - prevPose.center[2],
    ]);

    setEarthPoseTime(1 / PHYSICS_HZ);
    const nextPose = getEarthPose();
    const next = integrateCoRotatingBody({
      pos: start,
      vel: [0, 0, 0],
      acc: [0, 0, 0],
      gamma: 0,
      maxSpeed: 999,
      prevPose,
      nextPose,
    });
    const localNext = quatRotate(nextPose.invSpinQuat, [
      next.pos[0] - nextPose.center[0],
      next.pos[1] - nextPose.center[1],
      next.pos[2] - nextPose.center[2],
    ]);

    expect(localNext[0]).toBeCloseTo(localStart[0], 5);
    expect(localNext[1]).toBeCloseTo(localStart[1], 5);
    expect(localNext[2]).toBeCloseTo(localStart[2], 5);
  });
});