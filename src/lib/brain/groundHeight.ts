import { BODY_CENTER_HEIGHT, FEET_SHELL_RADIUS, FOOT_CUSHION } from './earth';
import { sampleTerrainLift } from './terrainMesh';
import { deckElevationAt } from './sea/deckSupport';
import { WATER_WADE_DEPTH, WATER_WALK_SCALE } from './surfaceProfile';
import { seaLevelAt } from './sea/seaSurface';

/** Water drag follows the same baked ground as the walker and renderer. */
export function groundWalkScaleAt(localN: [number, number, number], feet?: number): number {
  // Planks are dry: full walking speed on a jetty or deck.
  if (deckElevationAt(localN, feet) > -Infinity) return 1;
  const t = Math.min(1, Math.max(0, (groundElevationAt(localN) - seaLevelAt(localN) - 0.05) / (WATER_WADE_DEPTH - 0.05)));
  const dry = t * t * (3 - 2 * t);
  return WATER_WALK_SCALE + (1 - WATER_WALK_SCALE) * dry;
}

/**
 * Metres above sea level (EARTH_RADIUS) of the solid ground at an
 * Earth-local unit normal — the exact displaced triangle the Earth mesh
 * draws there. On land: land lift + volcano cone. Out at sea: negative,
 * the sea floor (beach shelf → shelf → slope → deep ocean bed). Solid
 * everywhere, so nothing can fall into the planet.
 */
export function groundElevationAt(localN: [number, number, number]): number {
  return sampleTerrainLift(localN);
}

/**
 * How far a swimmer floats with their body centre below the water
 * surface (m). The eye sits EYE_LIFT (0.75 m) above the body centre, so
 * the head stays out of the water: shoulders in, eyes ~0.3 m above it.
 */
export const SWIM_BODY_DEPTH = 0.45;

/**
 * Lowest elevation the FEET can be held at by the water: a swimmer's feet
 * hang this far below sea level. Where the sea floor is shallower than
 * this, the walker wades on the floor instead.
 */
export const SWIM_FEET_DEPTH = SWIM_BODY_DEPTH + BODY_CENTER_HEIGHT + FOOT_CUSHION;

/**
 * Elevation (m above sea level) that supports a walker's feet: the solid
 * ground, the water's buoyancy in deep water (riding the shared tide,
 * `sea/seaSurface.ts`, the same surface the sea is drawn at), or a deck standing over the
 * sea (the jetty, `sea/deckSupport.ts`) — whichever is highest. Land and
 * shallows: you stand on the ground. Deep water: you float and swim at
 * the surface with your head out. On a deck: you walk on its planks.
 *
 * Pass the walker's current `feet` elevation where it is known (the
 * physics does): a deck then only counts when the feet are at its level,
 * so a swimmer under the jetty or beside a hull stays in the water.
 */
export function supportElevationAt(localN: [number, number, number], feet?: number): number {
  return Math.max(groundElevationAt(localN), seaLevelAt(localN) - SWIM_FEET_DEPTH, deckElevationAt(localN, feet));
}

/** True when the walker at this point is swimming rather than standing. */
export function isSwimmingAt(localN: [number, number, number], feet?: number): boolean {
  return groundElevationAt(localN) < seaLevelAt(localN) - SWIM_FEET_DEPTH && deckElevationAt(localN, feet) === -Infinity;
}

/**
 * Radius (from Earth centre) where an avatar's FEET rest at an Earth-local
 * unit normal: the supporting ground (or swim level) plus the foot
 * cushion. Identical math to the physics floor, so every viewer puts feet
 * in the same place.
 */
export function feetRadiusAt(localN: [number, number, number], feet?: number): number {
  return FEET_SHELL_RADIUS + supportElevationAt(localN, feet) + FOOT_CUSHION;
}
