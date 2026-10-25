import { FEET_SHELL_RADIUS, FOOT_CUSHION } from './earth';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID, sampleVolcanoElevation, sampleTerrainDryMask } from './volcanoOrgan';
import { sampleSurfaceLift, WATER_WADE_DEPTH } from './surfaceProfile';

/**
 * Radius (from Earth centre) where an avatar's FEET rest at an Earth-local
 * unit normal: solid ground (volcano cone + land lift − seabed depth) plus the
 * foot cushion. Identical math to the physics floor, so every viewer puts
 * feet in the same place.
 */
export function groundElevationAt(localN: [number, number, number]): number {
  const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
  const waterDip = (1 - sampleTerrainDryMask(organ, localN)) * WATER_WADE_DEPTH;
  return sampleVolcanoElevation(organ, localN) + sampleSurfaceLift(localN) - waterDip;
}

export function feetRadiusAt(localN: [number, number, number]): number {
  return FEET_SHELL_RADIUS + groundElevationAt(localN) + FOOT_CUSHION;
}
