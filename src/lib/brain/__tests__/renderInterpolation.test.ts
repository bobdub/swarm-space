import { describe, it, expect, afterEach } from 'vitest';
import { UqrcPhysics, PHYSICS_HZ } from '../uqrcPhysics';
import { beginEarthFrame, endEarthFrame, getEarthPose, setEarthPoseTime } from '../earth';

const STEP_MS = 1000 / PHYSICS_HZ;

function makePhysics(): UqrcPhysics {
  const p = new UqrcPhysics();
  p.addBody({
    id: 'self',
    kind: 'self',
    pos: [100, 0, 0],
    vel: [0, 0, 0],
    mass: 1,
    trust: 0.5,
  });
  return p;
}

describe('render-time body interpolation', () => {
  it('returns the raw position before any step has run', () => {
    const p = makePhysics();
    const pos = p.getBodyRenderPos('self', 0)!;
    expect(pos).toEqual([100, 0, 0]);
  });

  it('never overshoots the step endpoints', () => {
    const p = makePhysics();
    const body = p.getBody('self')!;
    body.prevPos = [0, 0, 0];
    body.pos = [10, 0, 0];
    // Alpha is clamped to [0, 1] no matter how stale or early the frame is.
    const early = p.getBodyRenderPos('self', -10_000)![0];
    const late = p.getBodyRenderPos('self', 10_000)![0];
    expect(early).toBeGreaterThanOrEqual(0);
    expect(early).toBeLessThanOrEqual(10);
    expect(late).toBeGreaterThanOrEqual(0);
    expect(late).toBeLessThanOrEqual(10);
  });

  it('interpolates monotonically between the two step endpoints', () => {
    const p = makePhysics();
    const body = p.getBody('self')!;
    body.prevPos = [0, 0, 0];
    body.pos = [10, 0, 0];
    let last = -Infinity;
    for (let i = 0; i <= 4; i++) {
      const x = p.getBodyRenderPos('self', (i / 4) * STEP_MS)![0];
      expect(x).toBeGreaterThanOrEqual(last);
      last = x;
    }
  });

  it('writes into the caller-provided scratch buffer', () => {
    const p = makePhysics();
    const out: [number, number, number] = [0, 0, 0];
    const res = p.getBodyRenderPos('self', 0, out);
    expect(res).toBe(out);
  });

  it('returns undefined for an unknown body', () => {
    const p = makePhysics();
    expect(p.getBodyRenderPos('nobody', 0)).toBeUndefined();
  });
});

describe('frame-pinned Earth pose', () => {
  afterEach(() => {
    endEarthFrame();
    setEarthPoseTime(null);
  });

  it('serves one identical pose to every consumer within a frame', () => {
    const pinned = beginEarthFrame();
    const a = getEarthPose();
    const b = getEarthPose();
    expect(a).toBe(pinned);
    expect(b).toBe(pinned);
  });

  it('falls back to live derivation once the frame ends', () => {
    const pinned = beginEarthFrame();
    endEarthFrame();
    expect(getEarthPose()).not.toBe(pinned);
  });

  it('respects the test pose-time override', () => {
    setEarthPoseTime(0);
    const a = getEarthPose();
    setEarthPoseTime(120);
    const b = getEarthPose();
    expect(b.center).not.toEqual(a.center);
  });
});
