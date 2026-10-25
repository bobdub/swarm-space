import { describe, it, expect, afterEach } from 'vitest';
import { BODY_CENTER_HEIGHT, EARTH_RADIUS, FOOT_CUSHION, getEarthPose, setEarthPoseTime, worldPosToLocalNormal, type Vec3 } from '../earth';
import { feetRadiusAt, groundElevationAt } from '../groundHeight';
import { sampleLandMask, WATER_WADE_DEPTH } from '../surfaceProfile';
import { UqrcPhysics } from '../uqrcPhysics';
import { surfaceHeading } from '../surfaceNavigation';
import * as THREE from 'three';
import { getGroundGeometry } from '../groundHeight';
import { blockWorldPos } from '../builderBlockEngine';

afterEach(() => setEarthPoseTime(null));

describe('solid globe floor', () => {
  it('provides a seabed below open water instead of supporting feet inside an unrendered shell', () => {
    let ocean: Vec3 | undefined;
    for (let i = 0; i < 360; i++) {
      const a = i * Math.PI / 180;
      const normal: Vec3 = [Math.cos(a), 0, Math.sin(a)];
      if (sampleLandMask(normal) === 0 && groundElevationAt(normal) < 0) { ocean = normal; break; }
    }
    expect(ocean).toBeDefined();
    if (!ocean) throw new Error('Expected an open ocean sample');
    expect(groundElevationAt(ocean)).toBeLessThanOrEqual(-WATER_WADE_DEPTH + 1e-4);
    expect(groundElevationAt(ocean)).toBeGreaterThan(-WATER_WADE_DEPTH - 0.3);
    expect(feetRadiusAt(ocean)).toBeCloseTo(EARTH_RADIUS + groundElevationAt(ocean) + FOOT_CUSHION, 8);
  });

  it('places feet on the actual rendered triangles across slopes, ocean, seams and poles', () => {
    const mesh = new THREE.Mesh(getGroundGeometry(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld();
    const raycaster = new THREE.Raycaster();
    // Slightly inside the polar cap: exact pole rays can miss Three's
    // degenerate pole fan and hit the opposite hemisphere instead.
    const samples: Vec3[] = [[1e-6, Math.sqrt(1 - 1e-12), 0], [1e-6, -Math.sqrt(1 - 1e-12), 0], [-1, 0, 0], [1, 0, 0]];
    for (let i = 0; i < 80; i++) {
      const v = new THREE.Vector3(Math.cos(i * 2.4), Math.sin(i * 0.7), Math.sin(i * 2.4)).normalize();
      samples.push([v.x, v.y, v.z]);
    }
    for (const n of samples) {
      const direction = new THREE.Vector3(...n);
      raycaster.set(direction.clone().multiplyScalar(EARTH_RADIUS * 2), direction.clone().negate());
      const intersection = raycaster.intersectObject(mesh)[0];
      if (!intersection) throw new Error('Missing solid globe floor');
      expect(feetRadiusAt(n) - intersection.point.length()).toBeCloseTo(FOOT_CUSHION, 4);
    }
  });

  it('uses the same ground for village builder bases and standing feet', () => {
    setEarthPoseTime(0);
    const pose = getEarthPose();
    const pos = blockWorldPos({ anchorPeerId: 'swarm-shared-village', rightOffset: 0, forwardOffset: 0, upOffset: 0 });
    const r = Math.hypot(pos[0] - pose.center[0], pos[1] - pose.center[1], pos[2] - pose.center[2]);
    expect(feetRadiusAt(worldPosToLocalNormal(pos, pose)) - r).toBeCloseTo(FOOT_CUSHION, 6);
  });

  it('keeps walking feet above the shared terrain at distant sites and ocean crossings', () => {
    setEarthPoseTime(0);
    const physics = new UqrcPhysics();
    const pose = getEarthPose();
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12;
      const up: Vec3 = [Math.cos(a), Math.sin(a), 0];
      const local = worldPosToLocalNormal([
        pose.center[0] + up[0], pose.center[1] + up[1], pose.center[2] + up[2],
      ], pose);
      const r = feetRadiusAt(local) + BODY_CENTER_HEIGHT;
      const id = `walker-${i}`;
      const forward = surfaceHeading(up, [0, 0, 1], [1, 0, 0]);
      const right: Vec3 = [forward[1] * up[2] - forward[2] * up[1], forward[2] * up[0] - forward[0] * up[2], forward[0] * up[1] - forward[1] * up[0]];
      physics.addBody({ id, kind: 'self', pos: [pose.center[0] + up[0] * r, pose.center[1] + up[1] * r, pose.center[2] + up[2] * r], vel: [0, 0, 0], mass: 1.8, trust: 1, meta: { attachedTo: 'earth-surface' } });
      physics.setIntent(id, { fwd: 1, right: 1, yaw: a, basis: { up, forward, right } });
    }
    for (let tick = 0; tick < 1200; tick++) {
      (physics as unknown as { tick(): void }).tick();
      for (const body of physics.getBodies()) {
        const r = Math.hypot(body.pos[0] - pose.center[0], body.pos[1] - pose.center[1], body.pos[2] - pose.center[2]);
        expect(r - BODY_CENTER_HEIGHT - feetRadiusAt(worldPosToLocalNormal(body.pos, pose))).toBeGreaterThanOrEqual(-1e-8);
        expect(body.pos.every(Number.isFinite)).toBe(true);
      }
    }
  }, 30_000);
});