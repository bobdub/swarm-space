import * as THREE from 'three';
import { EARTH_RADIUS, EARTH_SPHERE_SEGMENTS, EARTH_SPHERE_RINGS, FOOT_CUSHION, type Vec3 } from './earth';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID, sampleVolcanoElevation, sampleTerrainDryMask } from './volcanoOrgan';
import { sampleSurfaceLift, WATER_WADE_DEPTH } from './surfaceProfile';

/**
 * Radius (from Earth centre) where an avatar's FEET rest at an Earth-local
 * unit normal: solid ground (volcano cone + land lift − seabed depth) plus the
 * foot cushion. Identical math to the physics floor, so every viewer puts
 * feet in the same place.
 */
function terrainElevationAt(localN: Vec3): number {
  const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
  const waterDip = (1 - sampleTerrainDryMask(organ, localN)) * WATER_WADE_DEPTH;
  return sampleVolcanoElevation(organ, localN) + sampleSurfaceLift(localN) - waterDip;
}

// One immutable solid surface: rendering and collision use the same vertices,
// including polygon curvature and the volcano's interpolated slopes.
let solidGround: THREE.SphereGeometry | undefined;
export function getGroundGeometry(): THREE.SphereGeometry {
  if (solidGround) return solidGround;
  const geometry = new THREE.SphereGeometry(EARTH_RADIUS, EARTH_SPHERE_SEGMENTS, EARTH_SPHERE_RINGS);
  const positions = geometry.getAttribute('position');
  const normal = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    normal.fromBufferAttribute(positions, i).normalize();
    const radius = EARTH_RADIUS + terrainElevationAt([normal.x, normal.y, normal.z]);
    positions.setXYZ(i, normal.x * radius, normal.y * radius, normal.z * radius);
  }
  positions.needsUpdate = true;
  geometry.computeBoundingSphere();
  solidGround = geometry;
  return geometry;
}

const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3());
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const hit = new THREE.Vector3();

export function groundElevationAt(localN: Vec3): number {
  const geometry = getGroundGeometry();
  const positions = geometry.getAttribute('position');
  ray.direction.set(...localN).normalize();
  const theta = Math.acos(THREE.MathUtils.clamp(ray.direction.y, -1, 1));
  const phi = (Math.atan2(ray.direction.z, -ray.direction.x) + Math.PI * 2) % (Math.PI * 2);
  const x = Math.min(EARTH_SPHERE_SEGMENTS - 1, Math.floor(phi / (Math.PI * 2) * EARTH_SPHERE_SEGMENTS));
  const y = Math.min(EARTH_SPHERE_RINGS - 1, Math.floor(theta / Math.PI * EARTH_SPHERE_RINGS));
  const stride = EARTH_SPHERE_SEGMENTS + 1;
  const read = (v: THREE.Vector3, ix: number, iy: number) => v.fromBufferAttribute(positions, iy * stride + ix);
  // The radial ray meets one of the two triangles in this sphere cell.
  read(a, x + 1, y); read(b, x, y); read(c, x + 1, y + 1);
  if (y !== 0 && ray.intersectTriangle(a, b, c, false, hit)) return hit.length() - EARTH_RADIUS;
  read(a, x, y); read(b, x, y + 1); read(c, x + 1, y + 1);
  if (y !== EARTH_SPHERE_RINGS - 1 && ray.intersectTriangle(a, b, c, false, hit)) return hit.length() - EARTH_RADIUS;
  // Pole/seam round-off: the exact shared vertex is the surface there.
  return positions.getY(y === 0 ? 0 : EARTH_SPHERE_RINGS * stride) * (y === 0 ? 1 : -1) - EARTH_RADIUS;
}

export function feetRadiusAt(localN: Vec3): number {
  return EARTH_RADIUS + groundElevationAt(localN) + FOOT_CUSHION;
}
