/**
 * mapSurface — what a map should paint at an Earth-local point.
 *
 * Reads the same solid ground the walker stands on and the Earth mesh
 * draws (`groundElevationAt`, metres above sea level), so the map's
 * coastline is the world's coastline. Kept apart from `surfaceClass`,
 * which drives gameplay rules (water gathering, boundary markers,
 * weather) and must not change behaviour because of a map.
 */
import type { Vec3 } from './earth';
import { groundElevationAt } from './groundHeight';
import { BEACH_TOP_M } from './beach';
import { SHELF_DEPTH_M, WATER_WADE_DEPTH } from './surfaceProfile';
import { sampleVolcanoElevation, type VolcanoOrgan } from './volcanoOrgan';

export type MapSurface = 'deep' | 'shallow' | 'beach' | 'land' | 'volcano' | 'ice';

/** |n.y| at and above which dry ground reads as polar ice (matches surfaceClass). */
const ICE_LATITUDE_ABS = 0.92;

export function sampleMapSurface(localNormal: Vec3, volcano?: VolcanoOrgan): MapSurface {
  const e = groundElevationAt(localNormal);
  if (e < -SHELF_DEPTH_M) return 'deep';
  if (e < 0) return 'shallow';
  if (volcano && sampleVolcanoElevation(volcano, localNormal) >= WATER_WADE_DEPTH) return 'volcano';
  if (Math.abs(localNormal[1]) >= ICE_LATITUDE_ABS) return 'ice';
  // The same sand band the Earth draws and a shovel scoops salt from.
  if (e < BEACH_TOP_M) return 'beach';
  return 'land';
}

/** Map paint for each surface. */
export const MAP_SURFACE_FILL: Record<MapSurface, string> = {
  deep: 'hsl(212, 62%, 20%)',
  shallow: 'hsl(198, 58%, 38%)',
  beach: 'hsl(45, 52%, 62%)',
  land: 'hsl(118, 34%, 36%)',
  volcano: 'hsl(15, 55%, 34%)',
  ice: 'hsl(200, 30%, 85%)',
};
