import { FEET_SHELL_RADIUS, FOOT_CUSHION } from './earth';
import { sampleTerrainLift } from './terrainMesh';

/**
 * Metres above EARTH_RADIUS of the solid ground at an Earth-local unit
 * normal — the exact displaced triangle the Earth mesh draws there (land
 * lift + volcano cone). Water is solid underfoot: the ocean is drawn as an
 * opaque surface at the baseline, so feet rest on it rather than wading
 * below what the eye sees as ground.
 *
 * Physics floor, remote avatars, the camera and anything else that needs
 * "where is the ground" read this one function, so nothing can disagree
 * with what is rendered.
 */
export function groundElevationAt(localN: [number, number, number]): number {
  return sampleTerrainLift(localN);
}

/**
 * Radius (from Earth centre) where an avatar's FEET rest at an Earth-local
 * unit normal: the rendered ground plus the foot cushion. Identical math to
 * the physics floor, so every viewer puts feet in the same place.
 */
export function feetRadiusAt(localN: [number, number, number]): number {
  return FEET_SHELL_RADIUS + groundElevationAt(localN) + FOOT_CUSHION;
}
