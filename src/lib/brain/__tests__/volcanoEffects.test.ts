import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS } from '../earth';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from '../volcanoOrgan';
import { buildTerrainGeometry } from '../terrainGeometry';
import { sampleTerrainLift } from '../terrainMesh';
import { ashParcelAt, ASH_LIFETIME_S, volcanoLavaRadius } from '../volcanoEffects';

describe('terrain-bound volcanic melt', () => {
  it('rests a shallow 0.25 m above the actual rendered crater floor, not the estimated peak', () => {
    const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
    const geometry = buildTerrainGeometry();
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.updateMatrixWorld();
    const up = new THREE.Vector3(...organ.centerNormal);
    const ray = new THREE.Raycaster(up.clone().multiplyScalar(EARTH_RADIUS + 300), up.clone().negate());
    const hit = ray.intersectObject(mesh)[0];
    expect(hit).toBeDefined();
    if (!hit) throw new Error('Crater must intersect the shared terrain');
    expect(volcanoLavaRadius(organ) - hit.point.length()).toBeCloseTo(0.25, 2);
    expect(volcanoLavaRadius(organ)).toBeCloseTo(EARTH_RADIUS + sampleTerrainLift(organ.centerNormal) + 0.25, 9);
    geometry.dispose();
    material.dispose();
  });

  it('the baked volcano normals follow its slopes, not a radial billiard-ball normal', () => {
    const geometry = buildTerrainGeometry();
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const volcano = geometry.attributes.aVolcano;
    let sloped = 0;
    for (let i = 0; i < position.count; i++) {
      if (volcano.getX(i) < 8) continue;
      const radial = new THREE.Vector3().fromBufferAttribute(position, i).normalize();
      const surface = new THREE.Vector3().fromBufferAttribute(normal, i).normalize();
      if (radial.dot(surface) < 0.99) sloped++;
    }
    expect(sloped).toBeGreaterThan(5);
    geometry.dispose();
  });
});

describe('buoyant wind-driven ash', () => {
  it('rises in calm air without invented sideways wind', () => {
    const early = ashParcelAt(1, 0, 16, [0, 0, 0]);
    const later = ashParcelAt(4, 0, 16, [0, 0, 0]);
    expect(early.position).toEqual([0, 5, 0]);
    expect(later.position).toEqual([0, 17, 0]);
    expect(later.radius).toBeGreaterThan(early.radius);
  });

  it('entrains into the real wind direction without instant full-speed drift', () => {
    const puff = ashParcelAt(4, 0, 16, [2, 0, -3]);
    const driftSeconds = 4 - 2 * (1 - Math.exp(-2));
    expect(puff.position[0]).toBeCloseTo(2 * driftSeconds, 9);
    expect(puff.position[2]).toBeCloseTo(-3 * driftSeconds, 9);
    expect(puff.position[0]).toBeLessThan(2 * 4);
  });

  it('expands and dissipates before recycling, without a solid cone', () => {
    const mature = ashParcelAt(8, 0, 16, [1, 0, 0]);
    const old = ashParcelAt(13.9, 0, 16, [1, 0, 0]);
    expect(old.radius).toBeGreaterThan(mature.radius);
    expect(old.opacity).toBeLessThan(0.01);
    expect(ashParcelAt(0, 0, 16, [1, 0, 0]).opacity).toBe(0);
  });

  it('reconstructs parcels from shared time rather than elapsed render frames', () => {
    const a = ashParcelAt(1000, 3, 16, [2, 0, 1]);
    expect(ashParcelAt(1000 + ASH_LIFETIME_S, 3, 16, [2, 0, 1])).toEqual(a);
    expect(ashParcelAt(1000, 3, 16, [2, 0, 1])).toEqual(a);
  });
});