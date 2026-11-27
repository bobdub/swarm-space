/**
 * beach — the sandy strip round every coast, where a shovel scoops salt.
 *
 * The beach is one band of the solid ground the walker stands on and the
 * Earth mesh draws (`groundElevationAt`, metres above mean sea level): from
 * a little below the waterline, where the sand is wet, up to
 * `BEACH_TOP_M`, where the grass starts. The Earth shader paints sand on
 * exactly this band (`uBeachTop`/`uBeachLow` in EarthBody), the mini map
 * paints it tan (`mapSurface.ts`), and digging reads it here, so what you
 * see is where you get salt. Mean sea level, not the live tide, so the
 * beach never moves under your feet as the tide turns.
 *
 * Volcanic slopes (basalt) and polar ice are never beach.
 */
import type { Vec3 } from './earth';
import { groundElevationAt } from './groundHeight';
import { WATER_WADE_DEPTH } from './surfaceProfile';
import { sampleVolcanoElevation, type VolcanoOrgan } from './volcanoOrgan';

/** Top of the beach (m above mean sea level): grass above, sand below. */
export const BEACH_TOP_M = 2.0;
/** Wet sand runs this far below mean sea level (m) into the shallows. */
export const BEACH_LOW_M = -0.6;
/** |n.y| at and above which the ground is polar ice (matches surfaceClass). */
const ICE_LATITUDE_ABS = 0.92;

/** True for ground elevation `e` (m) inside the beach band. */
export function isBeachElevation(e: number): boolean {
  return e >= BEACH_LOW_M && e < BEACH_TOP_M;
}

/**
 * True when the ground at an Earth-local unit normal is beach sand. Pass
 * the volcano organ to keep its basalt slopes out of the beach.
 */
export function isBeachAt(localNormal: Vec3, volcano?: VolcanoOrgan): boolean {
  if (Math.abs(localNormal[1]) >= ICE_LATITUDE_ABS) return false;
  if (!isBeachElevation(groundElevationAt(localNormal))) return false;
  if (volcano && sampleVolcanoElevation(volcano, localNormal) >= WATER_WADE_DEPTH) return false;
  return true;
}
