import { FEET_SHELL_RADIUS, FOOT_CUSHION } from './earth';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID, sampleVolcanoElevation, sampleTerrainDryMask } from './volcanoOrgan';
import { sampleSurfaceLift, WATER_WADE_DEPTH } from './surfaceProfile';

/**
 * Radius (from Earth centre) where an avatar's FEET rest at an Earth-local
 * unit normal: solid ground (volcano cone + land lift − wade dip) plus the
 * foot cushion. Identical math to the physics floor, so every viewer puts
 * feet in the same place.
 */
export function feetRadiusAt(localN: [number, number, number]): number {
  const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
  const waterDip = (1 - sampleTerrainDryMask(organ, localN)) * WATER_WADE_DEPTH;
  const elevation = sampleVolcanoElevation(organ, localN) + sampleSurfaceLift(localN) - waterDip;
  return FEET_SHELL_RADIUS + elevation + FOOT_CUSHION;
}
