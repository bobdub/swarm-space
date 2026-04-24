/**
 * surfaceClass — physics truth about an Earth surface point.
 *
 * Color is an *observation*, not a property. Two observers (desktop sRGB,
 * mobile P3, colorblind palette, the bare physics spectrum) will paint
 * the same SurfaceClass with different colors. This module exposes only
 * the invariant classification; per-channel colors live in
 * `observationBias.ts`.
 *
 * The classification fuses three physical sources of truth:
 *   1. landMask noise          (continents vs. ocean basin)
 *   2. volcano elevation       (uplift even inside an ocean cell)
 *   3. polar latitude          (ice caps)
 *
 * This makes a volcano raised in the middle of an ocean read as
 * `volcLand` for both physics (full walking speed) and any color LUT
 * that consults the class.
 */
import type { Vec3 } from './earth';
import { sampleLandMask, WATER_WADE_DEPTH, sampleSurfaceLift } from './surfaceProfile';
import { sampleVolcanoElevation, type VolcanoOrgan } from './volcanoOrgan';

export type SurfaceClass =
  | 'ocean'    // open water, full wade
  | 'shore'    // landMask transition band, half drag
  | 'land'     // dry continent, full speed
  | 'volcLand' // volcanic uplift (may be over an ocean cell)
  | 'ice';     // polar cap

const ICE_LATITUDE_ABS = 0.92; // |n.y| above this counts as polar cap
const SHORE_BAND = 0.15;       // landMask band counted as shoreline

function classify(landMask: number, volcLift: number, absLat: number): SurfaceClass {
  if (absLat >= ICE_LATITUDE_ABS) return 'ice';
  if (volcLift >= WATER_WADE_DEPTH) return 'volcLand';
  if (landMask >= 0.5 + SHORE_BAND) return 'land';
  if (landMask >= 0.5 - SHORE_BAND) return 'shore';
  return 'ocean';
}

/**
 * Classify an Earth-LOCAL unit normal. Pass the village's `VolcanoOrgan`
 * if present so volcanic uplift contributes; otherwise the call still
 * returns a sane class from landMask + latitude alone.
 */
export function sampleSurfaceClass(
  localNormal: Vec3,
  volcano?: VolcanoOrgan,
): SurfaceClass {
  const landMask = sampleLandMask(localNormal);
  const surfaceLift = sampleSurfaceLift(localNormal);
  const volcLift = volcano ? sampleVolcanoElevation(volcano, localNormal) : 0;
  // Total dry uplift relative to wade depth — this is what the physics
  // dryness mask already consults, so the color follows the same source.
  const totalLift = surfaceLift + volcLift;
  const absLat = Math.abs(localNormal[1]);
  return classify(landMask, totalLift, absLat);
}

/** Numeric tag for shader/uniform consumption. Stable ordering. */
export const SURFACE_CLASS_INDEX: Record<SurfaceClass, number> = {
  ocean: 0,
  shore: 1,
  land: 2,
  volcLand: 3,
  ice: 4,
};