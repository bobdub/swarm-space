import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEarthPose, quatRotate, setEarthPoseTime, spawnOnEarth, BODY_SHELL_RADIUS, EARTH_RADIUS } from '../earth';
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

  it('recaptures an Earth-attached avatar beyond the former atmosphere cutoff', () => {
    const physics = new UqrcPhysics();
    const pose = getEarthPose();
    const start = spawnOnEarth('outer-player', pose);
    const dx = start[0] - pose.center[0];
    const dy = start[1] - pose.center[1];
    const dz = start[2] - pose.center[2];
    const r = Math.hypot(dx, dy, dz);
    const outside = EARTH_RADIUS * 1.07;
    const k = outside / r;
    physics.addBody({
      id: 'outer-player', kind: 'self',
      pos: [pose.center[0] + dx * k, pose.center[1] + dy * k, pose.center[2] + dz * k],
      vel: [0, 0, 0], mass: 1.8, trust: 1,
      meta: { attachedTo: 'earth-surface' },
    });

    for (let i = 0; i < 600; i++) (physics as unknown as { tick(): void }).tick();
    const body = physics.getBody('outer-player');
    expect(body).toBeTruthy();
    if (!body) return;
    const finalR = Math.hypot(
      body.pos[0] - getEarthPose().center[0],
      body.pos[1] - getEarthPose().center[1],
      body.pos[2] - getEarthPose().center[2],
    );
    expect(finalR).toBeLessThan(outside - 20);
    expect(body.pos.every(Number.isFinite)).toBe(true);
    expect(body.vel.every(Number.isFinite)).toBe(true);
  });

  it('preserves mantle and overlapping support pins when one basin moves', () => {
    const physics = new UqrcPhysics();
    const field = physics.getField();
    const at = spawnOnEarth('support-overlap', getEarthPose());
    const before = field.pinTemplate.map((axis) => new Float32Array(axis));
    // Radius spans multiple cells so the Hermite bowl has a non-zero
    // interior sample in addition to its zero-depth rim.
    const first = physics.pinSupportBasin(at, 800, 0.6);
    const second = physics.pinSupportBasin(at, 800, 0.3);
    const overlapCells = [...second.cells];
    const withBoth = field.pinTemplate.map((axis) => new Float32Array(axis));

    physics.unpinSupportBasin(first);
    const afterFirst = field.pinTemplate.map((axis) => new Float32Array(axis));
    expect(overlapCells.some((flat) => (
      afterFirst[0][flat] !== before[0][flat] ||
      afterFirst[1][flat] !== before[1][flat] ||
      afterFirst[2][flat] !== before[2][flat]
    ))).toBe(true);
    expect(overlapCells.some((flat) => (
      afterFirst[0][flat] !== withBoth[0][flat] ||
      afterFirst[1][flat] !== withBoth[1][flat] ||
      afterFirst[2][flat] !== withBoth[2][flat]
    ))).toBe(true);

    physics.unpinSupportBasin(second);
    for (const flat of overlapCells) {
      expect(field.pinTemplate[0][flat]).toBeCloseTo(before[0][flat], 7);
      expect(field.pinTemplate[1][flat]).toBeCloseTo(before[1][flat], 7);
      expect(field.pinTemplate[2][flat]).toBeCloseTo(before[2][flat], 7);
    }
  });

  it('keeps a surface avatar bounded through several simulated minutes', () => {
    const physics = new UqrcPhysics();
    const pose = getEarthPose();
    const start = spawnOnEarth('long-idle', pose);
    physics.addBody({
      id: 'long-idle', kind: 'self', pos: [...start], vel: [0, 0, 0],
      mass: 1.8, trust: 1, meta: { attachedTo: 'earth-surface' },
    });
    physics.setIntent('long-idle', { fwd: 0, right: 0, yaw: 0 });

    for (let i = 0; i < PHYSICS_HZ * 180; i++) {
      (physics as unknown as { tick(): void }).tick();
    }
    const body = physics.getBody('long-idle');
    expect(body).toBeTruthy();
    if (!body) return;
    const finalR = Math.hypot(
      body.pos[0] - getEarthPose().center[0],
      body.pos[1] - getEarthPose().center[1],
      body.pos[2] - getEarthPose().center[2],
    );
    expect(Math.abs(finalR - BODY_SHELL_RADIUS)).toBeLessThan(5);
  }, 30_000);

  it('runs each 𝒞_light boundary once despite faster body ticks', () => {
    const physics = new UqrcPhysics();
    const tick = () => (physics as unknown as { tick(): void }).tick();

    let guard = 0;
    while (physics.getTicks() < 30 && guard < 500) {
      tick();
      guard++;
    }
    expect(physics.getTicks()).toBe(30);
    expect(physics.getCausalDiagnostics()).toMatchObject({
      probeFieldTick: 30,
      probeRuns: 1,
    });

    // Fourteen more body ticks still share field tick 30. The old modulo
    // gate re-ran the probe (and relax) on every one of these frames.
    for (let i = 0; i < 5; i++) tick();
    expect(physics.getTicks()).toBe(30);
    expect(physics.getCausalDiagnostics().probeRuns).toBe(1);

    while (physics.getTicks() < 31 && guard < 520) {
      tick();
      guard++;
    }
    expect(physics.getTicks()).toBe(31);
    expect(physics.getCausalDiagnostics().probeRuns).toBe(1);
  });
});