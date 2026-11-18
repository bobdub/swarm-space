/**
 * One terrain manifold: the ground physics walks on must be the ground the
 * GPU draws, and a walker must ride the planet's rotation on top of it.
 *
 * UQRC framing: treat "where is the ground along this ray" as two
 * operators, D_render (the displaced Earth mesh) and D_physics (the floor
 * used by the integrator, avatars and camera). The bug was
 * ‖[D_render, D_physics]‖ ≠ 0 — up to a 6 m land plateau drawn where
 * physics saw ocean, and feet dipped 0.9 m under an ocean drawn as solid
 * ground. These tests pin the commutator to ~0.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { buildTerrainGeometry } from '../terrainGeometry';
import { getTerrainGrid, sampleTerrainLift } from '../terrainMesh';
import { feetRadiusAt, groundElevationAt } from '../groundHeight';
import {
  BODY_CENTER_HEIGHT,
  EARTH_RADIUS,
  EARTH_SPHERE_RINGS,
  EARTH_SPHERE_SEGMENTS,
  anchorOnEarth,
  BODY_SHELL_RADIUS,
  beginEarthFrame,
  endEarthFrame,
  getEarthLocalSiteFrame,
  getEarthPose,
  setEarthPoseTime,
  worldPosToLocalNormal,
} from '../earth';
import { sampleLandMask } from '../surfaceProfile';
import { UqrcPhysics, PHYSICS_HZ } from '../uqrcPhysics';
import { HORIZON_M } from '../horizonFade';

const VILLAGE = 'swarm-shared-village';
/** A realistic shared-epoch time (mid-November 2026), not t = 0. */
const T_NOV = (Date.UTC(2026, 10, 18) - Date.UTC(2026, 0, 1)) / 1000;

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

afterEach(() => {
  endEarthFrame();
  setEarthPoseTime(null);
});

describe('terrain manifold: render and physics share one ground', () => {
  it('baked grid matches three.js SphereGeometry vertex for vertex', () => {
    const g = getTerrainGrid();
    const sphere = new THREE.SphereGeometry(1, EARTH_SPHERE_SEGMENTS, EARTH_SPHERE_RINGS);
    const pos = sphere.attributes.position;
    expect(pos.count).toBe((g.W + 1) * (g.H + 1));
    for (let i = 0; i < pos.count; i += 97) {
      expect(g.dirs[i * 3]).toBeCloseTo(pos.getX(i), 6);
      expect(g.dirs[i * 3 + 1]).toBeCloseTo(pos.getY(i), 6);
      expect(g.dirs[i * 3 + 2]).toBeCloseTo(pos.getZ(i), 6);
    }
  });

  it('‖[D_render, D_physics]‖ ≈ 0: physics floor equals a raycast against the drawn mesh', () => {
    const geom = buildTerrainGeometry();
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    const rnd = seeded(12345);
    let worst = 0;
    let coast = 0;
    let samples = 0;
    for (let k = 0; k < 600; k++) {
      const d = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
      if (d.lengthSq() < 0.01) continue;
      d.normalize();
      ray.set(d.clone().multiplyScalar(EARTH_RADIUS + 300), d.clone().negate());
      const hit = ray.intersectObject(mesh)[0];
      if (!hit) continue;
      samples++;
      const lm = sampleLandMask([d.x, d.y, d.z]);
      if (lm > 0.02 && lm < 0.98) coast++;
      const drawn = hit.point.length() - EARTH_RADIUS;
      worst = Math.max(worst, Math.abs(drawn - sampleTerrainLift([d.x, d.y, d.z])));
    }
    expect(samples).toBeGreaterThan(500);
    // Float32 vertex storage is the only remaining difference (sub-mm).
    expect(worst).toBeLessThan(0.01);
    geom.dispose();
  });

  it('feetRadiusAt is the rendered ground plus the foot cushion', () => {
    const frame = getEarthLocalSiteFrame(VILLAGE);
    // feetRadiusAt is the rendered ground + cushion everywhere.
    const n = frame.normal;
    expect(feetRadiusAt(n)).toBeCloseTo(EARTH_RADIUS + groundElevationAt(n) + 0.05, 9);
  });
});

describe('walking: feet stay on the drawn ground and ride the planet', () => {
  function makeWalker(t0: number, anchor: string) {
    const p = new UqrcPhysics();
    setEarthPoseTime(t0);
    endEarthFrame();
    const pose = getEarthPose();
    const { worldPos } = anchorOnEarth(anchor, 0, 0, BODY_SHELL_RADIUS, pose);
    p.addBody({
      id: 'self', kind: 'self', pos: [...worldPos] as [number, number, number],
      vel: [0, 0, 0], mass: 1, trust: 0.5, meta: { attachedTo: 'earth-surface' },
    });
    return p;
  }

  function clearance(p: UqrcPhysics) {
    const pose = getEarthPose();
    const b = p.getBody('self')!;
    const r = Math.hypot(b.pos[0] - pose.center[0], b.pos[1] - pose.center[1], b.pos[2] - pose.center[2]);
    const n = worldPosToLocalNormal(b.pos, pose);
    return { feetAboveGround: r - BODY_CENTER_HEIGHT - feetRadiusAt(n), n };
  }

  it('the shared village (open ocean) no longer sinks feet under the drawn sea', () => {
    // The village anchor sits on open ocean — the spawn every player shares.
    expect(sampleLandMask(getEarthLocalSiteFrame(VILLAGE).normal)).toBeLessThan(0.1);
    const p = makeWalker(T_NOV, VILLAGE);
    const tick = (p as unknown as { tick(): void }).tick.bind(p);
    let worst = Infinity;
    for (let i = 0; i < PHYSICS_HZ * 3; i++) {
      setEarthPoseTime(T_NOV + (i + 1) / PHYSICS_HZ);
      endEarthFrame(); beginEarthFrame();
      tick();
      if (i > PHYSICS_HZ) worst = Math.min(worst, clearance(p).feetAboveGround);
    }
    // Previously −0.9 m (the wade dip): waist-deep inside what is drawn as ground.
    expect(worst).toBeGreaterThan(-1e-6);
    expect(clearance(p).feetAboveGround).toBeLessThan(0.25);
  });

  it('walking across coastlines never puts feet below the rendered ground', () => {
    for (const yaw of [0, 1.3, 2.6, 4.2]) {
      const p = makeWalker(T_NOV, VILLAGE);
      p.setIntent('self', { fwd: 2, right: 0, yaw });
      const tick = (p as unknown as { tick(): void }).tick.bind(p);
      let worst = Infinity;
      for (let i = 0; i < PHYSICS_HZ * 20; i++) {
        setEarthPoseTime(T_NOV + (i + 1) / PHYSICS_HZ);
        endEarthFrame(); beginEarthFrame();
        tick();
        worst = Math.min(worst, clearance(p).feetAboveGround);
      }
      expect(worst).toBeGreaterThan(-1e-6);
    }
  });

  it('an idle walker co-rotates with the planet (no slide over the land)', () => {
    const p = makeWalker(T_NOV, VILLAGE);
    const tick = (p as unknown as { tick(): void }).tick.bind(p);
    const settle = () => {
      for (let i = 0; i < PHYSICS_HZ; i++) {
        setEarthPoseTime(T_NOV + (i + 1) / PHYSICS_HZ);
        endEarthFrame(); beginEarthFrame();
        tick();
      }
    };
    settle();
    const a = clearance(p).n;
    // 30 s of game time: Earth turns ~0.9 m under a fixed world point.
    for (let i = 0; i < PHYSICS_HZ * 30; i++) {
      setEarthPoseTime(T_NOV + 1 + (i + 1) / PHYSICS_HZ);
      endEarthFrame(); beginEarthFrame();
      tick();
    }
    const b = clearance(p).n;
    const slideM = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * EARTH_RADIUS;
    expect(slideM).toBeLessThan(0.05);
  });
});

describe('horizon', () => {
  it('fade band sits at the real horizon for a 1.6 m eye, not the 0.75 m eye offset', () => {
    expect(HORIZON_M).toBeCloseTo(Math.sqrt(2 * EARTH_RADIUS * 1.6), 6);
    expect(HORIZON_M).toBeGreaterThan(70);
  });
});
