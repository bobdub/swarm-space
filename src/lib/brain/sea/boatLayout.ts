/**
 * boatLayout — where things stand on the deck, in the boat frame (+x
 * starboard, +z aft, metres; the bow is at z = −HALF_L). Shared by the
 * mesh that draws them and the stations that hold the crew, so the bench
 * you see is the bench you sit at.
 *
 * Bow to stern: rod holders, the mast, the gates midships, three rowing
 * benches (a rower each side), then the wheel and the stern ladder. The
 * aisle down the middle stays clear for people to walk.
 */

import { MAX_ROWERS } from './vessel';

/** Mast step. */
export const MAST_Z = -1.4;
/** Rowing benches, forward to aft. */
export const BENCH_ZS: readonly number[] = [0.9, 1.9, 2.9];
/** A rower sits this far off the centreline, each side of a bench. */
export const ROWER_X = 0.8;
/** Wheel pedestal. */
export const WHEEL_Z = 4.25;

/** Helm station: just aft of the wheel, facing the bow. */
export const HELM_SPOT: [number, number] = [0, 4.7];

/**
 * Oar places, one rower each: port then starboard on each bench, forward
 * bench first. Rowers stand just aft of their bench.
 */
export const OAR_SPOTS: ReadonlyArray<[number, number]> = BENCH_ZS.flatMap(
  (z) => [[-ROWER_X, z + 0.35], [ROWER_X, z + 0.35]] as [number, number][],
).slice(0, MAX_ROWERS);

/** The first oar place (forward bench, port). */
export const OARS_SPOT: [number, number] = OAR_SPOTS[0];

/** The oar place nearest boat-frame (x, z), with its distance. */
export function nearestOarSpot(x: number, z: number): { spot: [number, number]; d: number } {
  let best = OAR_SPOTS[0];
  let bestD = Infinity;
  for (const s of OAR_SPOTS) {
    const d = Math.hypot(x - s[0], z - s[1]);
    if (d < bestD) { bestD = d; best = s; }
  }
  return { spot: [best[0], best[1]], d: bestD };
}
