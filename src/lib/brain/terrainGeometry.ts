import * as THREE from 'three';
import { EARTH_RADIUS } from './earth';
import { getTerrainGrid } from './terrainMesh';

/**
 * Earth geometry built from the baked terrain grid: a SphereGeometry
 * layout (same vertex order and triangle split as three.js) whose vertices
 * are already displaced to the heights physics walks on.
 */
export function buildTerrainGeometry(): THREE.BufferGeometry {
  const g = getTerrainGrid();
  const geom = new THREE.SphereGeometry(EARTH_RADIUS, g.W, g.H);
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const count = pos.count;
  const continents = new Float32Array(count);
  const volcano = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = EARTH_RADIUS + g.lift[i];
    pos.setXYZ(i, g.dirs[i * 3] * r, g.dirs[i * 3 + 1] * r, g.dirs[i * 3 + 2] * r);
    continents[i] = g.continents[i];
    volcano[i] = g.volcano[i];
  }
  pos.needsUpdate = true;
  geom.setAttribute('aContinents', new THREE.BufferAttribute(continents, 1));
  geom.setAttribute('aVolcano', new THREE.BufferAttribute(volcano, 1));
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}
