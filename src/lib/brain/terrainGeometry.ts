import * as THREE from 'three';
import { EARTH_RADIUS } from './earth';
import { getTerrainGrid } from './terrainMesh';
import { carvedGroundAt, getCraterCarve } from './craterCarve';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID, sampleVolcanoElevation } from './volcanoOrgan';
import { sampleContinents } from './surfaceProfile';

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

/** Rings across the crater bowl, neck to rim (≈0.55 m apart). */
export const CRATER_PATCH_RINGS = 40;
/** Segments around the crater; the conduit sleeve uses the same count so
 *  its top ring meets the bowl's neck vertex for vertex. */
export const CRATER_PATCH_SEGMENTS = 96;

/**
 * The carved summit crater (`craterCarve.ts`) as Earth-local geometry, with
 * the same attributes as the Earth mesh so it is drawn by the same shader.
 * An annulus from the vent's neck to the rim; the vent itself is open (the
 * conduit sleeve continues it downward). Ring vertex k sits at angle
 * φ = 2πk/S about the vent, measured like three.js LatheGeometry in the
 * crater frame (+y along the vent normal): (sin φ, 0, cos φ).
 */
export function buildCraterPatchGeometry(): THREE.BufferGeometry {
  const k = getCraterCarve();
  const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
  const n = new THREE.Vector3(...k.center);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  const ex = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const ez = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const R = CRATER_PATCH_RINGS;
  const S = CRATER_PATCH_SEGMENTS;
  const positions = new Float32Array((R + 1) * S * 3);
  const continents = new Float32Array((R + 1) * S);
  const volcano = new Float32Array((R + 1) * S);
  const t = new THREE.Vector3();
  let i = 0;
  for (let r = 0; r <= R; r++) {
    const s = k.neckR + ((k.rimR - k.neckR) * r) / R;
    const ang = s / EARTH_RADIUS;
    for (let j = 0; j < S; j++, i++) {
      const phi = (j / S) * Math.PI * 2;
      t.copy(ex).multiplyScalar(Math.sin(phi)).addScaledVector(ez, Math.cos(phi));
      const d: [number, number, number] = [
        n.x * Math.cos(ang) + t.x * Math.sin(ang),
        n.y * Math.cos(ang) + t.y * Math.sin(ang),
        n.z * Math.cos(ang) + t.z * Math.sin(ang),
      ];
      // The neck ring is exactly the floor level; the rim ring is exactly
      // the baked Earth surface it hands over to.
      const e = r === 0 ? k.floorElev : carvedGroundAt(d);
      const rad = EARTH_RADIUS + e;
      positions[i * 3] = d[0] * rad;
      positions[i * 3 + 1] = d[1] * rad;
      positions[i * 3 + 2] = d[2] * rad;
      continents[i] = sampleContinents(d);
      volcano[i] = sampleVolcanoElevation(organ, d);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < R; r++) {
    const a0 = r * S;
    const b0 = (r + 1) * S;
    for (let j = 0; j < S; j++) {
      const j1 = (j + 1) % S;
      // Wound to face outward (up the vent normal), like the Earth mesh.
      index.push(a0 + j, b0 + j, a0 + j1, a0 + j1, b0 + j, b0 + j1);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aContinents', new THREE.BufferAttribute(continents, 1));
  geom.setAttribute('aVolcano', new THREE.BufferAttribute(volcano, 1));
  geom.setIndex(index);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}
