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
import { feetRadiusAt, groundElevationAt, isSwimmingAt, SWIM_BODY_DEPTH } from '../groundHeight';
import {
  BODY_CENTER_HEIGHT,
  EYE_LIFT,
  EARTH_RADIUS,
  EARTH_SPHERE_RINGS,
  EARTH_SPHERE_SEGMENTS,
  anchorOnEarth,
  BODY_SHELL_RADIUS,
  beginEarthFrame,
  earthLocalToWorld,
  endEarthFrame,
  getEarthLocalSiteFrame,
  getEarthPose,
  setEarthPoseTime,
  worldPosToLocalNormal,
} from '../earth';
import { sampleLandMask, OCEAN_FLOOR_DEPTH_M } from '../surfaceProfile';
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

  it('on land, feetRadiusAt is the rendered ground plus the foot cushion', () => {
    const frame = getEarthLocalSiteFrame(VILLAGE);
    // The village stands on land, so support = the drawn ground.
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

  function makeWalkerAt(t0: number, localN: [number, number, number]) {
    const p = new UqrcPhysics();
    setEarthPoseTime(t0);
    endEarthFrame();
    const pose = getEarthPose();
    const w = earthLocalToWorld(
      [localN[0] * BODY_SHELL_RADIUS, localN[1] * BODY_SHELL_RADIUS, localN[2] * BODY_SHELL_RADIUS],
      pose,
    );
    p.addBody({
      id: 'self', kind: 'self', pos: [...w] as [number, number, number],
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

  /** Deterministic scan (Fibonacci sphere) for a sea point whose floor
   *  depth satisfies `ok`; `skip` picks a later match for variety. */
  function findSeaPoint(skip: number, ok: (ground: number) => boolean): [number, number, number] {
    const N = 60000;
    const golden = Math.PI * (3 - Math.sqrt(5));
    let seen = 0;
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N;
      const rr = Math.sqrt(1 - y * y);
      const n: [number, number, number] = [Math.cos(golden * i) * rr, y, Math.sin(golden * i) * rr];
      if (sampleLandMask(n) < 0.05 && ok(groundElevationAt(n)) && seen++ >= skip) return n;
    }
    throw new Error('no sea point found');
  }

  function settle(p: UqrcPhysics, seconds: number) {
    const tick = (p as unknown as { tick(): void }).tick.bind(p);
    let worst = Infinity;
    for (let i = 0; i < PHYSICS_HZ * seconds; i++) {
      setEarthPoseTime(T_NOV + (i + 1) / PHYSICS_HZ);
      endEarthFrame(); beginEarthFrame();
      tick();
      if (i > PHYSICS_HZ) worst = Math.min(worst, clearance(p).feetAboveGround);
    }
    return worst;
  }

  function bodyRadius(p: UqrcPhysics) {
    const pose = getEarthPose();
    const b = p.getBody('self')!;
    return Math.hypot(b.pos[0] - pose.center[0], b.pos[1] - pose.center[1], b.pos[2] - pose.center[2]);
  }

  it('the sea has a real floor: shallows near the coast, deep ocean between continents', () => {
    const deep = findSeaPoint(3, (g) => g < -OCEAN_FLOOR_DEPTH_M + 1);
    expect(groundElevationAt(deep)).toBeGreaterThan(-OCEAN_FLOOR_DEPTH_M - 0.5);
    findSeaPoint(0, (g) => g < -0.3 && g > -1.2); // wadeable shallows exist
  });

  it('shallows: the walker wades on the sea floor, eyes above the water', () => {
    const shallow = findSeaPoint(1, (g) => g < -0.4 && g > -1.0);
    const p = makeWalkerAt(T_NOV, shallow);
    const worst = settle(p, 3);
    expect(isSwimmingAt(shallow)).toBe(false);
    expect(worst).toBeGreaterThan(-1e-6);
    expect(clearance(p).feetAboveGround).toBeLessThan(0.25);
    // Feet on the floor, below the water surface; eye above it.
    expect(bodyRadius(p) - BODY_CENTER_HEIGHT).toBeLessThan(EARTH_RADIUS);
    expect(bodyRadius(p) + EYE_LIFT).toBeGreaterThan(EARTH_RADIUS + 0.2);
  });

  it('deep water: the walker floats and swims at the surface, head out', () => {
    const deep = findSeaPoint(13, (g) => g < -10);
    const p = makeWalkerAt(T_NOV, deep);
    const worst = settle(p, 15);
    expect(isSwimmingAt(deep)).toBe(true);
    expect(worst).toBeGreaterThan(-1e-6);
    const r = bodyRadius(p);
    expect(r).toBeCloseTo(EARTH_RADIUS - SWIM_BODY_DEPTH, 0);
    expect(r + EYE_LIFT).toBeGreaterThan(EARTH_RADIUS + 0.2);
  });

  it('a walker shoved below the sea floor is put straight back on top', () => {
    const rnd = seeded(7);
    let sea: [number, number, number] | null = null;
    while (!sea) {
      const v = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
      const l = Math.hypot(v[0], v[1], v[2]);
      if (l < 0.1 || l > 1) continue;
      const n: [number, number, number] = [v[0] / l, v[1] / l, v[2] / l];
      if (sampleLandMask(n) === 0) sea = n;
    }
    const p = makeWalkerAt(T_NOV, sea);
    const b = p.getBody('self')!;
    const pose = getEarthPose();
    // Push 4 m under the bed, falling fast toward the core.
    const dx = b.pos[0] - pose.center[0], dy = b.pos[1] - pose.center[1], dz = b.pos[2] - pose.center[2];
    const r = Math.hypot(dx, dy, dz);
    const k = (r - 5) / r;
    b.pos = [pose.center[0] + dx * k, pose.center[1] + dy * k, pose.center[2] + dz * k];
    b.vel = [-dx / r * 20, -dy / r * 20, -dz / r * 20];
    setEarthPoseTime(T_NOV + 1 / PHYSICS_HZ);
    endEarthFrame(); beginEarthFrame();
    (p as unknown as { tick(): void }).tick();
    expect(clearance(p).feetAboveGround).toBeGreaterThan(-1e-6);
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
