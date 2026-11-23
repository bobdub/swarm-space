import { EARTH_RADIUS, type Vec3 } from './earth';
import { sampleTerrainLift } from './terrainMesh';
import type { VolcanoOrgan } from './volcanoOrgan';
import type { VentEmissionState } from './eruptionCycle';

/**
 * Origin of the crater frame: 0.25 m above the baked ground at the vent.
 * The magma column's level (`eruptionCycle.ts`) is measured from here;
 * it rests far below it and only reaches it during an eruption.
 */
export const LAVA_DEPTH_M = 0.25;
export function volcanoLavaRadius(organ: VolcanoOrgan): number {
  return EARTH_RADIUS + sampleTerrainLift(organ.centerNormal) + LAVA_DEPTH_M;
}

export const ASH_LIFETIME_S = 14;
export const ASH_RISE_M_S = 4;
const WIND_COUPLING_S = 2;

/** Buoyant parcels entrain into the ambient wind; age comes from shared pose time. */
export function ashParcelAt(time: number, index: number, count: number, wind: Vec3, rise = ASH_RISE_M_S) {
  const age = ((time + index * ASH_LIFETIME_S / count) % ASH_LIFETIME_S + ASH_LIFETIME_S) % ASH_LIFETIME_S;
  const driftSeconds = age - WIND_COUPLING_S * (1 - Math.exp(-age / WIND_COUPLING_S));
  const fadeIn = Math.min(1, age / 0.8);
  const fadeOut = Math.min(1, (ASH_LIFETIME_S - age) / 4);
  return {
    position: [wind[0] * driftSeconds, 1 + rise * age, wind[2] * driftSeconds] as Vec3,
    radius: 2 + age * 0.8,
    opacity: 0.28 * fadeIn * fadeOut,
    age,
  };
}

/** Steam rises more gently than an ash-laden eruption column. */
export const STEAM_RISE_M_S = 2.2;

/**
 * One plume parcel coloured by what the vent emitted when it left
 * (`emissionAt`, normally `ventEmissionAt`, read at its birth time), so a change of state climbs the
 * column instead of repainting it. `ash` is the parcel's dark-ash share
 * (0 white steam … 1 grey ash); opacity 0 means nothing to draw.
 */
export function plumeParcelAt(
  time: number,
  index: number,
  count: number,
  wind: Vec3,
  emissionAt: (t: number) => VentEmissionState,
) {
  const probe = ashParcelAt(time, index, count, wind);
  const emitted = emissionAt(time - probe.age);
  const total = emitted.ash + emitted.steam;
  const ash = total > 0 ? emitted.ash / total : 0;
  // A vigorous eruption column is hotter, so it climbs faster and wider.
  const rise = STEAM_RISE_M_S + (ASH_RISE_M_S - STEAM_RISE_M_S) * ash + 3 * emitted.ash;
  const parcel = ashParcelAt(time, index, count, wind, rise);
  const size = (0.55 + 0.45 * ash) * (1 + 1.2 * emitted.ash);
  const strength = Math.min(1, 1.1 * emitted.ash + 0.4 * emitted.steam);
  return {
    position: parcel.position,
    radius: parcel.radius * size,
    opacity: (parcel.opacity / 0.28) * 0.3 * strength,
    ash,
  };
}