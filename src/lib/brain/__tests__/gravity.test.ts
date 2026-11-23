/**
 * Falling and jumping follow real gravity: an airborne walker accelerates
 * at g = 9.81 m/s² (with quadratic air drag toward a human's ~53 m/s
 * terminal velocity), lands, and stands.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  BODY_SHELL_RADIUS,
  FOOT_CUSHION,
  beginEarthFrame,
  earthLocalToWorld,
  endEarthFrame,
  getEarthPose,
  setEarthPoseTime,
  worldPosToLocalNormal,
  type Vec3,
} from '../earth';
import { GRAVITY, JUMP_SPEED, PHYSICS_HZ, UqrcPhysics } from '../uqrcPhysics';
import { getCraterCarve } from '../craterCarve';
import { eruptionStateAt } from '../eruptionCycle';
import { supportElevationAt } from '../groundHeight';

afterEach(() => {
  endEarthFrame();
  setEarthPoseTime(null);
});

function quietTime(): number {
  for (let t = 10; ; t += 10) {
    if (eruptionStateAt(t).phase === 'quiet' && eruptionStateAt(t + 60).phase === 'quiet') return t;
  }
}

function sim(t0: number, n: Vec3, feet: number) {
  const p = new UqrcPhysics();
  setEarthPoseTime(t0);
  endEarthFrame();
  const r = BODY_SHELL_RADIUS + feet + FOOT_CUSHION;
  const w = earthLocalToWorld([n[0] * r, n[1] * r, n[2] * r], getEarthPose());
  p.addBody({
    id: 'self', kind: 'self', pos: [...w] as Vec3,
    vel: [0, 0, 0], mass: 1, trust: 0.5, meta: { attachedTo: 'earth-surface' },
  });
  p.setCoreRescue(() => {});
  const tick = (p as unknown as { tick(): void }).tick.bind(p);
  let i = 0;
  const feetNow = () => {
    const pose = getEarthPose();
    const b = p.getBody('self')!;
    return Math.hypot(b.pos[0] - pose.center[0], b.pos[1] - pose.center[1], b.pos[2] - pose.center[2])
      - BODY_SHELL_RADIUS - FOOT_CUSHION;
  };
  const step = () => {
    i++;
    setEarthPoseTime(t0 + i / PHYSICS_HZ);
    endEarthFrame(); beginEarthFrame();
    tick();
  };
  return { p, step, feetNow, support: () => supportElevationAt(worldPosToLocalNormal(p.getBody('self')!.pos, getEarthPose())) };
}

describe('real gravity', () => {
  it('a fall down the volcano vent drops ½·g·t²', () => {
    const k = getCraterCarve();
    const s = sim(quietTime(), k.center, k.floorElev + 0.5);
    const start = s.feetNow();
    for (let i = 0; i < PHYSICS_HZ; i++) s.step();
    const at1 = start - s.feetNow();
    expect(at1).toBeGreaterThan(0.5 * GRAVITY * 0.9);
    expect(at1).toBeLessThan(0.5 * GRAVITY * 1.1);
    for (let i = 0; i < PHYSICS_HZ; i++) s.step();
    const at2 = start - s.feetNow();
    // 19.6 m in vacuum; drag toward 53 m/s takes a little off.
    expect(at2).toBeGreaterThan(2 * GRAVITY * 0.9);
    expect(at2).toBeLessThan(2 * GRAVITY * 1.02);
  });

  it('a jump rises about a metre, lands in about 0.9 s, and stands', () => {
    const k = getCraterCarve();
    // Flat-ish ground on the crater floor ring, away from the vent.
    const c = k.center;
    const ref: Vec3 = Math.abs(c[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const e = [ref[1] * c[2] - ref[2] * c[1], ref[2] * c[0] - ref[0] * c[2], ref[0] * c[1] - ref[1] * c[0]];
    const l = Math.hypot(e[0], e[1], e[2]);
    const ang = (k.neckR + 1.2) / 1700;
    const n = [0, 1, 2].map((j) => c[j] * Math.cos(ang) + (e[j] / l) * Math.sin(ang)) as Vec3;
    const s = sim(quietTime(), n, k.floorElev);
    for (let i = 0; i < PHYSICS_HZ; i++) s.step();
    const ground = s.feetNow();
    expect(s.p.jump('self')).toBe(true);
    let peak = -Infinity;
    let landedAt = -1;
    for (let i = 1; i <= PHYSICS_HZ * 2; i++) {
      s.step();
      peak = Math.max(peak, s.feetNow() - ground);
      if (landedAt < 0 && i > 5 && !s.p.isAirborne('self')) landedAt = i / PHYSICS_HZ;
    }
    const ideal = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
    expect(peak).toBeGreaterThan(ideal * 0.85);
    expect(peak).toBeLessThan(ideal * 1.1);
    expect(landedAt).toBeGreaterThan(0.75);
    expect(landedAt).toBeLessThan(1.05);
    expect(Math.abs(s.feetNow() - ground)).toBeLessThan(0.1);
  });
});
