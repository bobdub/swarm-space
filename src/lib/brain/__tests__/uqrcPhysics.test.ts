import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEarthPose, quatRotate, setEarthPoseTime, spawnOnEarth, BODY_SHELL_RADIUS } from '../earth';
import { integrateCoRotatingBody, PHYSICS_HZ, UqrcPhysics } from '../uqrcPhysics';

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

  it('pushes a surface body back out when it starts below the Earth shell', () => {
    const physics = new UqrcPhysics();
    const pose = getEarthPose();
    const start = spawnOnEarth('clip-test', pose);
    const dx = start[0] - pose.center[0];
    const dy = start[1] - pose.center[1];
    const dz = start[2] - pose.center[2];
    const r = Math.hypot(dx, dy, dz);
    const below = BODY_SHELL_RADIUS - 80;
    const k = below / r;

    physics.addBody({
      id: 'clip-test',
      kind: 'self',
      pos: [pose.center[0] + dx * k, pose.center[1] + dy * k, pose.center[2] + dz * k],
      vel: [0, 0, 0],
      mass: 1.8,
      trust: 1,
      meta: { attachedTo: 'earth-surface' },
    });

    for (let i = 0; i < 12; i++) {
      (physics as unknown as { tick(): void }).tick();
    }

    const body = physics.getBody('clip-test');
    expect(body).toBeTruthy();
    const bodyDx = body!.pos[0] - pose.center[0];
    const bodyDy = body!.pos[1] - pose.center[1];
    const bodyDz = body!.pos[2] - pose.center[2];
    const finalR = Math.hypot(bodyDx, bodyDy, bodyDz);

    expect(finalR).toBeGreaterThan(below);
  });

  it('does not move an idle surface avatar sideways without player intent', () => {
    const physics = new UqrcPhysics();
    const pose = getEarthPose();
    const start = spawnOnEarth('idle-player', pose);
    const startLocal = quatRotate(pose.invSpinQuat, [
      start[0] - pose.center[0],
      start[1] - pose.center[1],
      start[2] - pose.center[2],
    ]);

    physics.addBody({
      id: 'idle-player',
      kind: 'self',
      pos: [...start],
      vel: [0, 0, 0],
      mass: 1.8,
      trust: 1,
      meta: { attachedTo: 'earth-surface' },
    });
    physics.setIntent('idle-player', { fwd: 0, right: 0, yaw: 0 });

    for (let i = 0; i < 120; i++) {
      (physics as unknown as { tick(): void }).tick();
    }

    const body = physics.getBody('idle-player');
    expect(body).toBeTruthy();
    if (!body) return;
    const endLocal = quatRotate(getEarthPose().invSpinQuat, [
      body.pos[0] - getEarthPose().center[0],
      body.pos[1] - getEarthPose().center[1],
      body.pos[2] - getEarthPose().center[2],
    ]);
    const startRadius = Math.hypot(startLocal[0], startLocal[1], startLocal[2]);
    const endRadius = Math.hypot(endLocal[0], endLocal[1], endLocal[2]);
    const dot = (startLocal[0] * endLocal[0] + startLocal[1] * endLocal[1] + startLocal[2] * endLocal[2])
      / (startRadius * endRadius);
    const angularDrift = Math.acos(Math.max(-1, Math.min(1, dot)));

    expect(angularDrift * endRadius).toBeLessThan(0.01);
  });
});