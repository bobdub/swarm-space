import { describe, it, expect, afterEach } from 'vitest';
import { setEarthPoseTime, getEarthPose, spawnOnEarth, EARTH_ORBIT_PERIOD } from '../earth';
import { UqrcPhysics, AVATAR_WALK_SPEED_MPS, PHYSICS_HZ, WORLD_SIZE } from '../uqrcPhysics';
import { createField3D, step3D, FIELD3D_N, type Field3D } from '../../uqrc/field3D';
import { initLavaMantle } from '../lavaMantle';

const tickOf = (p: UqrcPhysics) => (p as unknown as { tick(): void }).tick();
function maskCount(f: Field3D): number {
  let n = 0;
  for (const m of f.pinMask) for (let i = 0; i < m.length; i++) n += m[i];
  return n;
}

describe('UQRC hotspot regressions', () => {
  afterEach(() => setEarthPoseTime(null));

  it('moves a whole village of support basins across a lattice cell without re-walking every basin, composing the same template', () => {
    setEarthPoseTime(0);
    const physics = new UqrcPhysics();
    const fresh = new UqrcPhysics();
    const base = spawnOnEarth('village', getEarthPose());
    const cell = WORLD_SIZE / FIELD3D_N;
    // Count every basin the composer visits. Before the per-cell sum, each
    // composed cell walked every live basin, so one village crossing cost
    // O(N²) visits (and ~140 ms for 300 builds).
    let visited = 0;
    class CountingMap<K, V> extends Map<K, V> {
      *values(): MapIterator<V> { for (const v of super.values()) { visited++; yield v; } }
    }
    const internals = physics as unknown as { supportBasins: Map<number, unknown> };
    internals.supportBasins = new CountingMap(internals.supportBasins);
    const items = Array.from({ length: 300 }, (_, i) => {
      const pos: [number, number, number] = [base[0] + (i % 20) * 2, base[1], base[2] + Math.floor(i / 20) * 2];
      return { h: physics.pinSupportBasin(pos, 6, 0.6), pos };
    });
    visited = 0;
    for (const it of items) {
      const next: [number, number, number] = [it.pos[0] + cell, it.pos[1], it.pos[2]];
      it.h = physics.moveSupportBasin(it.h, it.pos, next, 6);
      it.pos = next;
      fresh.pinSupportBasin(next, 6, 0.6);
    }
    // Linear: no move re-walks the other basins.
    expect(visited).toBe(0);
    const a = physics.getField().pinTemplate;
    const b = fresh.getField().pinTemplate;
    for (let ax = 0; ax < 3; ax++) {
      for (let i = 0; i < a[ax].length; i++) expect(a[ax][i]).toBeCloseTo(b[ax][i], 5);
    }
  });

  it('does not bring back a ghost Earth basin when restoring a snapshot saved at another pose', () => {
    setEarthPoseTime(0);
    const saved = new UqrcPhysics();
    tickOf(saved);
    const snap = saved.snapshot();
    setEarthPoseTime(EARTH_ORBIT_PERIOD / 8);
    const fresh = new UqrcPhysics();
    const restored = new UqrcPhysics();
    restored.restore(snap);
    initLavaMantle(restored.getField());
    expect(maskCount(restored.getField())).toBe(maskCount(fresh.getField()));
    // The evolved field values still come back wherever no live pin re-seeds them.
    const f = restored.getField();
    let compared = 0;
    for (let i = 0; i < f.axes[0].length; i++) {
      if (f.pinMask[0][i]) continue;
      expect(f.axes[0][i]).toBe(Math.fround(snap.axes[0][i]));
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('keeps a light surface walker under the walk-speed cap through the ground settle', () => {
    setEarthPoseTime(0);
    const physics = new UqrcPhysics();
    const pose = getEarthPose();
    const pos = spawnOnEarth('walker', pose);
    const r = [pos[0] - pose.center[0], pos[1] - pose.center[1], pos[2] - pose.center[2]];
    const rl = Math.hypot(r[0], r[1], r[2]);
    const up = r.map((v) => v / rl) as [number, number, number];
    const t = [up[1], -up[0], 0];
    const tl = Math.hypot(t[0], t[1], t[2]);
    const forward = t.map((v) => v / tl) as [number, number, number];
    const right: [number, number, number] = [
      up[1] * forward[2] - up[2] * forward[1],
      up[2] * forward[0] - up[0] * forward[2],
      up[0] * forward[1] - up[1] * forward[0],
    ];
    physics.addBody({ id: 'walker', kind: 'self', pos, vel: [0, 0, 0], mass: 0.25, trust: 1, meta: { attachedTo: 'earth-surface' } });
    physics.setIntent('walker', { fwd: 1, right: 0, yaw: 0, basis: { up, forward, right } });
    let time = 0;
    let maxTangential = 0;
    for (let i = 0; i < PHYSICS_HZ * 10; i++) {
      time += 1 / PHYSICS_HZ;
      setEarthPoseTime(time);
      tickOf(physics);
      const b = physics.getBody('walker')!;
      const p = getEarthPose();
      const d = [b.pos[0] - p.center[0], b.pos[1] - p.center[1], b.pos[2] - p.center[2]];
      const m = Math.hypot(d[0], d[1], d[2]);
      const vr = (b.vel[0] * d[0] + b.vel[1] * d[1] + b.vel[2] * d[2]) / m;
      const speed2 = b.vel[0] ** 2 + b.vel[1] ** 2 + b.vel[2] ** 2;
      maxTangential = Math.max(maxTangential, Math.sqrt(Math.max(0, speed2 - vr * vr)));
    }
    // Was 64 m/s: the settle rebuilt velocity from the pre-cap tangent.
    expect(maxTangential).toBeLessThanOrEqual(AVATAR_WALK_SPEED_MPS + 1e-6);
  }, 30_000);

  it('keeps the gravitational potential bounded on the torus', () => {
    setEarthPoseTime(0);
    const field = createField3D();
    initLavaMantle(field);
    for (let i = 0; i < 4000; i++) step3D(field);
    let sum = 0;
    for (let i = 0; i < field.phi!.length; i++) sum += field.phi![i];
    // Was ≈ −9 after 4000 steps and falling linearly forever.
    expect(Math.abs(sum / field.phi!.length)).toBeLessThan(1e-3);
  }, 30_000);
});
