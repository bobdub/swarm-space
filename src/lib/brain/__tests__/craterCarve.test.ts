import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BODY_SHELL_RADIUS,
  EARTH_RADIUS,
  FOOT_CUSHION,
  beginEarthFrame,
  earthLocalToWorld,
  endEarthFrame,
  getEarthPose,
  setEarthPoseTime,
  worldPosToLocalNormal,
  type Vec3,
} from '../earth';
import { PHYSICS_HZ, UqrcPhysics, type RescueReason } from '../uqrcPhysics';
import {
  carvedGroundAt,
  containInVent,
  craterArcAt,
  getCraterCarve,
  inMagmaAt,
  magmaSurfaceElevationAt,
} from '../craterCarve';
import { groundElevationAt, supportElevationAt } from '../groundHeight';
import { sampleTerrainLift } from '../terrainMesh';
import { eruptionStateAt } from '../eruptionCycle';
import { buildCraterPatchGeometry, CRATER_PATCH_RINGS, CRATER_PATCH_SEGMENTS } from '../terrainGeometry';

/** Earth-local unit normal `s` metres (arc) from the vent at azimuth `phi`. */
function at(s: number, phi: number): Vec3 {
  const c = getCraterCarve().center;
  const a: Vec3 = Math.abs(c[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = new THREE.Vector3(...a).cross(new THREE.Vector3(...c)).normalize();
  const e2 = new THREE.Vector3(...c).cross(e1);
  const t = e1.multiplyScalar(Math.cos(phi)).addScaledVector(e2, Math.sin(phi));
  const ang = s / EARTH_RADIUS;
  return [
    c[0] * Math.cos(ang) + t.x * Math.sin(ang),
    c[1] * Math.cos(ang) + t.y * Math.sin(ang),
    c[2] * Math.cos(ang) + t.z * Math.sin(ang),
  ];
}

/** A shared time when the volcano is quiet (and stays quiet for a minute). */
function quietTime(): number {
  for (let t = 10; t < 3000; t += 10) {
    if (eruptionStateAt(t).phase === 'quiet' && eruptionStateAt(t + 60).phase === 'quiet') return t;
  }
  throw new Error('no quiet time');
}

const AZ = [0, 1.1, 2.3, 3.6, 4.9];

describe('carved summit crater', () => {
  afterEach(() => {
    endEarthFrame();
    setEarthPoseTime(null);
  });

  it('is a bowl below the baked summit that meets it at the rim', () => {
    const k = getCraterCarve();
    for (const phi of AZ) {
      // Rim: no step where the Earth mesh takes over.
      const rim = at(k.rimR - 1e-6, phi);
      expect(Math.abs(carvedGroundAt(rim) - sampleTerrainLift(rim))).toBeLessThan(1e-3);
      // Neck: the flat floor ring, well below the baked summit.
      expect(carvedGroundAt(at(k.neckR, phi))).toBeCloseTo(k.floorElev, 6);
      expect(k.floorElev).toBeLessThan(sampleTerrainLift(k.center) - 10);
      // Never above the baked ground, and deepening toward the vent.
      let prev = Infinity;
      for (let s = k.neckR; s <= k.rimR; s += 1) {
        const d = at(s, phi);
        const e = carvedGroundAt(d);
        expect(e).toBeLessThanOrEqual(sampleTerrainLift(d) + 1e-9);
        if (s > k.neckR) expect(e).toBeGreaterThanOrEqual(prev - 0.6);
        prev = e;
      }
    }
    // Outside the rim the ground is the baked mesh, untouched.
    const out = at(k.rimR + 5, 0.4);
    expect(groundElevationAt(out)).toBe(sampleTerrainLift(out));
  });

  it('has no ground over the vent until the magma far down the shaft', () => {
    const t = quietTime();
    setEarthPoseTime(t);
    const k = getCraterCarve();
    const lava = magmaSurfaceElevationAt(t);
    expect(lava).toBeLessThan(k.floorElev - 20);
    expect(groundElevationAt(k.center)).toBeCloseTo(lava, 6);
    expect(groundElevationAt(at(k.neckR * 0.8, 2))).toBeCloseTo(lava, 6);
    // Standing on the bowl floor beside the vent you are on the floor ring.
    expect(groundElevationAt(at(k.neckR + 0.5, 2))).toBeCloseTo(k.floorElev, 1);
  });

  it('holds a body that fell down the shaft inside its walls', () => {
    const t = quietTime();
    setEarthPoseTime(t);
    const k = getCraterCarve();
    const deep = k.floorElev - 10;
    // Inside the shaft and clear of the wall: free.
    expect(containInVent(at(2, 1), deep)).toBeNull();
    // Pressed into the wall: pushed back inside.
    const fixed = containInVent(at(k.neckR + 0.5, 1), deep);
    expect(fixed).not.toBeNull();
    expect(craterArcAt(fixed!)).toBeLessThan(k.neckR);
    // A step past the wall never snaps the body up onto the bowl.
    expect(supportElevationAt(at(k.neckR + 0.5, 1), deep)).toBeLessThan(k.floorElev);
    // Up on the bowl floor the walls do not apply.
    expect(containInVent(at(k.neckR + 0.5, 1), k.floorElev)).toBeNull();
    expect(supportElevationAt(at(k.neckR + 0.5, 1), k.floorElev)).toBeCloseTo(k.floorElev, 1);
  });

  it('knows when feet are in the magma', () => {
    const t = quietTime();
    const k = getCraterCarve();
    const lava = magmaSurfaceElevationAt(t);
    expect(inMagmaAt(k.center, lava + 0.05, t)).toBe(true);
    expect(inMagmaAt(k.center, lava + 5, t)).toBe(false);
    // On the bowl floor while the magma rests deep: safe.
    expect(inMagmaAt(at(k.neckR + 2, 0.5), k.floorElev, t)).toBe(false);
    // Away from the volcano: never.
    expect(inMagmaAt(at(k.rimR + 50, 0.5), 0, t)).toBe(false);
  });

  it('draws the crater patch from the same carved heights', () => {
    const k = getCraterCarve();
    const g = buildCraterPatchGeometry();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    expect(pos.count).toBe((CRATER_PATCH_RINGS + 1) * CRATER_PATCH_SEGMENTS);
    const c = new THREE.Vector3(...k.center);
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 7) {
      p.fromBufferAttribute(pos, i);
      const r = p.length();
      const d: Vec3 = [p.x / r, p.y / r, p.z / r];
      const ring = Math.floor(i / CRATER_PATCH_SEGMENTS);
      const want = ring === 0 ? k.floorElev : carvedGroundAt(d);
      expect(Math.abs(r - EARTH_RADIUS - want)).toBeLessThan(0.01);
      // Faces point up out of the bowl.
      n.fromBufferAttribute(nrm, i);
      expect(n.dot(c)).toBeGreaterThan(0);
    }
    g.dispose();
  });
});

describe('walking into the crater', () => {
  afterEach(() => {
    endEarthFrame();
    setEarthPoseTime(null);
  });

  function walkerAt(t0: number, n: Vec3, feet: number) {
    const p = new UqrcPhysics();
    setEarthPoseTime(t0);
    endEarthFrame();
    const r = BODY_SHELL_RADIUS + feet + FOOT_CUSHION;
    const w = earthLocalToWorld([n[0] * r, n[1] * r, n[2] * r], getEarthPose());
    p.addBody({
      id: 'self', kind: 'self', pos: [...w] as Vec3,
      vel: [0, 0, 0], mass: 1, trust: 0.5, meta: { attachedTo: 'earth-surface' },
    });
    const rescues: RescueReason[] = [];
    p.setCoreRescue((_id, reason) => { rescues.push(reason); });
    const tick = (p as unknown as { tick(): void }).tick.bind(p);
    let i = 0;
    const run = (seconds: number, until?: () => boolean) => {
      for (let k = 0; k < PHYSICS_HZ * seconds; k++, i++) {
        setEarthPoseTime(t0 + (i + 1) / PHYSICS_HZ);
        endEarthFrame(); beginEarthFrame();
        tick();
        if (until?.()) return;
      }
    };
    const state = () => {
      const pose = getEarthPose();
      const b = p.getBody('self')!;
      const rr = Math.hypot(b.pos[0] - pose.center[0], b.pos[1] - pose.center[1], b.pos[2] - pose.center[2]);
      const ln = worldPosToLocalNormal(b.pos, pose);
      return { feet: rr - BODY_SHELL_RADIUS - FOOT_CUSHION, s: craterArcAt(ln) };
    };
    return { p, run, state, rescues };
  }

  it('stands on the bowl floor, well below the old summit lid', () => {
    const t0 = quietTime();
    const k = getCraterCarve();
    const w = walkerAt(t0, at(k.neckR + 1.5, 0.7), k.floorElev + 2);
    w.run(6);
    const { feet } = w.state();
    expect(Math.abs(feet - k.floorElev)).toBeLessThan(0.3);
    expect(w.rescues).toEqual([]);
  });

  it('falls down the vent into the magma and is rescued to the village', () => {
    const t0 = quietTime();
    const k = getCraterCarve();
    const w = walkerAt(t0, at(1, 0.7), k.floorElev);
    let lowest = Infinity;
    w.run(20, () => {
      lowest = Math.min(lowest, w.state().feet);
      return w.rescues.length > 0;
    });
    expect(lowest).toBeLessThan(k.floorElev - 15);
    expect(w.rescues).toContain('lava');
  });

  it('cannot walk out through the shaft wall while falling', () => {
    const t0 = quietTime();
    const k = getCraterCarve();
    const w = walkerAt(t0, at(k.neckR - 1, 0.7), k.floorElev - 3);
    w.p.setIntent('self', { fwd: 2, right: 0, yaw: 0 });
    let worstS = 0;
    w.run(4, () => {
      const st = w.state();
      if (st.feet < k.floorElev - 1) worstS = Math.max(worstS, st.s);
      return w.rescues.length > 0;
    });
    expect(worstS).toBeLessThan(k.neckR + 0.5);
    expect(w.state().feet).toBeLessThan(k.floorElev);
  });
});
