import { describe, it } from 'vitest';
import { UqrcPhysics, PHYSICS_HZ } from '../uqrcPhysics';
import { spawnOnEarth, getEarthPose, BODY_SHELL_RADIUS, setEarthPoseTime } from '../earth';

describe('jitter probe', () => {
  it('measures altitude range raw vs interpolated', () => {
    const p = new UqrcPhysics();
    const pose = getEarthPose();
    const pos = spawnOnEarth('probe', pose);
    p.addBody({ id: 'self', kind: 'self', pos: [...pos] as [number,number,number], vel: [0,0,0], mass: 1, trust: 0.5, meta: { attachedTo: 'earth-surface' } });
    p.setIntent('self', { fwd: 1, right: 0, yaw: 0 });
    const dtMs = 1000 / PHYSICS_HZ;
    let simMs = 0, acc = 0;
    const rawAlt: number[] = [], interpAlt: number[] = [];
    // Emulate 300 display frames of jittered duration (14–22 ms).
    let now = 0;
    for (let f = 0; f < 300; f++) {
      const frameMs = 14 + (f % 9);
      now += frameMs;
      acc += frameMs;
      while (acc >= dtMs) { acc -= dtMs; simMs += dtMs; (p as unknown as { tick(): void }).tick(); }
      (p as unknown as { lastStepAtMs: number }).lastStepAtMs = now - acc;
      const b = p.getBody('self')!;
      const c = getEarthPose().center;
      const raw = Math.hypot(b.pos[0]-c[0], b.pos[1]-c[1], b.pos[2]-c[2]) - BODY_SHELL_RADIUS;
      const ip = p.getBodyRenderPos('self', now)!;
      const interp = Math.hypot(ip[0]-c[0], ip[1]-c[1], ip[2]-c[2]) - BODY_SHELL_RADIUS;
      if (f > 100) { rawAlt.push(raw); interpAlt.push(interp); }
    }
    const d = (a: number[]) => {
      let mx = -Infinity;
      for (let i = 1; i < a.length; i++) mx = Math.max(mx, Math.abs(a[i]-a[i-1]));
      return mx;
    };
    console.log('max per-frame altitude delta raw   =', d(rawAlt).toFixed(4), 'm');
    console.log('max per-frame altitude delta interp=', d(interpAlt).toFixed(4), 'm');
    console.log('altitude range', (Math.max(...interpAlt)-Math.min(...interpAlt)).toFixed(4), 'm');
    void setEarthPoseTime;
  });
});
