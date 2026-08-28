import { describe, it, expect } from 'vitest';
import { UqrcPhysics, PHYSICS_HZ } from '../uqrcPhysics';
import { blockWorldPos } from '../builderBlockEngine';
import { spawnOnEarth, getEarthPose, setEarthPoseTime, BODY_SHELL_RADIUS, endEarthFrame, beginEarthFrame } from '../earth';

describe('ground jitter: body stays in register with the rendered Earth', () => {
  it('Earth-local render track cuts altitude jerk vs raw world position', () => {
    const p = new UqrcPhysics();
    setEarthPoseTime(0);
    const pose0 = getEarthPose();
    const pos = spawnOnEarth('probe', pose0);
    p.addBody({ id: 'self', kind: 'self', pos: [...pos] as [number,number,number], vel: [0,0,0], mass: 1, trust: 0.5, meta: { attachedTo: 'earth-surface' } });
    p.setIntent('self', { fwd: 1, right: 0, yaw: 0 });
    const dtMs = 1000 / PHYSICS_HZ;
    let acc = 0, now = 0, simMs = 0;
    const rawAlt: number[] = [], locAlt: number[] = [];
    for (let f = 0; f < 400; f++) {
      const frameMs = 14 + (f % 9);
      now += frameMs; acc += frameMs;
      while (acc >= dtMs) {
        acc -= dtMs; simMs += dtMs;
        setEarthPoseTime(simMs / 1000); endEarthFrame();
        (p as unknown as { tick(): void }).tick();
      }
      (p as unknown as { lastStepAtMs: number }).lastStepAtMs = now - acc;
      // Frame pose is at real frame time — this is what the ground renders at.
      setEarthPoseTime(now / 1000); endEarthFrame(); beginEarthFrame();
      const c = getEarthPose().center;
      const b = p.getBody('self')!;
      const raw = Math.hypot(b.pos[0]-c[0], b.pos[1]-c[1], b.pos[2]-c[2]) - BODY_SHELL_RADIUS;
      const ip = p.getBodyRenderPos('self', now)!;
      const loc = Math.hypot(ip[0]-c[0], ip[1]-c[1], ip[2]-c[2]) - BODY_SHELL_RADIUS;
      if (f > 150) { rawAlt.push(raw); locAlt.push(loc); }
    }
    const jerk = (a: number[]) => { let m=0; for (let i=2;i<a.length;i++) m=Math.max(m, Math.abs((a[i]-a[i-1])-(a[i-1]-a[i-2]))); return m; };
    const rawJerk = jerk(rawAlt);
    const locJerk = jerk(locAlt);
    // Raw world sampling reads the body at the LAST TICK's Earth pose while
    // the ground is drawn at THIS FRAME's pose — the orbital offset shows up
    // as vertical shake. The local remap must be materially quieter.
    expect(locJerk).toBeLessThan(rawJerk * 0.6);
    // Absolute bound is generous: the avatar walks fast, so single-step
    // interpolation of its own acceleration dominates what is left.
    expect(locJerk).toBeLessThan(0.3);
    endEarthFrame(); setEarthPoseTime(null);
  });
});

describe('lateral jitter: structures stay in register with the camera', () => {
  it('frame-derived block position is quieter than the tick stamp', () => {
    const p = new UqrcPhysics();
    setEarthPoseTime(0);
    const pose0 = getEarthPose();
    const pos = spawnOnEarth('probe2', pose0);
    p.addBody({ id: 'self', kind: 'self', pos: [...pos] as [number,number,number], vel: [0,0,0], mass: 1, trust: 0.5, meta: { attachedTo: 'earth-surface' } });
    p.setIntent('self', { fwd: 1, right: 0, yaw: 0 });
    const spec = { anchorPeerId: 'probe2', rightOffset: 2.5, forwardOffset: 5, upOffset: 1.25 };
    const dtMs = 1000 / PHYSICS_HZ;
    let acc = 0, now = 0, simMs = 0;
    let stamped: [number, number, number] = blockWorldPos(spec);
    const rawOff: number[] = [], frameOff: number[] = [];
    for (let f = 0; f < 400; f++) {
      const frameMs = 14 + (f % 9);
      now += frameMs; acc += frameMs;
      while (acc >= dtMs) {
        acc -= dtMs; simMs += dtMs;
        setEarthPoseTime(simMs / 1000); endEarthFrame();
        (p as unknown as { tick(): void }).tick();
        // The engine re-stamps the block body once per tick.
        stamped = blockWorldPos(spec);
      }
      (p as unknown as { lastStepAtMs: number }).lastStepAtMs = now - acc;
      setEarthPoseTime(now / 1000); endEarthFrame(); beginEarthFrame();
      const cam = p.getBodyRenderPos('self', now)!;
      const live = blockWorldPos(spec);
      if (f > 150) {
        rawOff.push(Math.hypot(stamped[0]-cam[0], stamped[1]-cam[1], stamped[2]-cam[2]));
        frameOff.push(Math.hypot(live[0]-cam[0], live[1]-cam[1], live[2]-cam[2]));
      }
    }
    const jerk = (a: number[]) => { let m=0; for (let i=2;i<a.length;i++) m=Math.max(m, Math.abs((a[i]-a[i-1])-(a[i-1]-a[i-2]))); return m; };
    const rawJerk = jerk(rawOff);
    const frameJerk = jerk(frameOff);
    expect(frameJerk).toBeLessThan(rawJerk * 0.6);
    expect(frameJerk).toBeLessThan(0.1);
    endEarthFrame(); setEarthPoseTime(null);
  });

  it('render-time block position matches the tick stamp at the same pose', () => {
    setEarthPoseTime(12.5); endEarthFrame();
    const spec = { anchorPeerId: 'probe3', rightOffset: -1.25, forwardOffset: 7.5, upOffset: 0 };
    const a = blockWorldPos(spec);
    const b = blockWorldPos(spec);
    expect(a[0]).toBeCloseTo(b[0], 10);
    expect(a[1]).toBeCloseTo(b[1], 10);
    expect(a[2]).toBeCloseTo(b[2], 10);
    setEarthPoseTime(null); endEarthFrame();
  });
});
