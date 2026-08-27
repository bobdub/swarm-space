import { describe, it } from 'vitest';
import { UqrcPhysics, PHYSICS_HZ } from '../uqrcPhysics';
import { spawnOnEarth, getEarthPose, setEarthPoseTime, BODY_SHELL_RADIUS, endEarthFrame, beginEarthFrame } from '../earth';

describe('jitter probe (frame pose advances with real time)', () => {
  it('compares altitude jitter: raw world pos vs Earth-local remap', () => {
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
    console.log('max frame-to-frame altitude jerk raw   =', (jerk(rawAlt)*1000).toFixed(2), 'mm');
    console.log('max frame-to-frame altitude jerk local =', (jerk(locAlt)*1000).toFixed(2), 'mm');
    endEarthFrame(); setEarthPoseTime(null);
  });
});
