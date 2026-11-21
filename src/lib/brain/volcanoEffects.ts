import { EARTH_RADIUS, type Vec3 } from './earth';
import { sampleTerrainLift } from './terrainMesh';
import type { VolcanoOrgan } from './volcanoOrgan';

/** A shallow horizontal melt surface, not a second terrain or a peak estimate. */
export const LAVA_DEPTH_M = 0.25;
export function volcanoLavaRadius(organ: VolcanoOrgan): number {
  return EARTH_RADIUS + sampleTerrainLift(organ.centerNormal) + LAVA_DEPTH_M;
}

export const ASH_LIFETIME_S = 14;
export const ASH_RISE_M_S = 4;
const WIND_COUPLING_S = 2;

/** Buoyant parcels entrain into the ambient wind; age comes from shared pose time. */
export function ashParcelAt(time: number, index: number, count: number, wind: Vec3) {
  const age = ((time + index * ASH_LIFETIME_S / count) % ASH_LIFETIME_S + ASH_LIFETIME_S) % ASH_LIFETIME_S;
  const driftSeconds = age - WIND_COUPLING_S * (1 - Math.exp(-age / WIND_COUPLING_S));
  const fadeIn = Math.min(1, age / 0.8);
  const fadeOut = Math.min(1, (ASH_LIFETIME_S - age) / 4);
  return {
    position: [wind[0] * driftSeconds, 1 + ASH_RISE_M_S * age, wind[2] * driftSeconds] as Vec3,
    radius: 2 + age * 0.8,
    opacity: 0.28 * fadeIn * fadeOut,
  };
}