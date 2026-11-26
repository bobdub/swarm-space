/**
 * Which Trading Stand the player is standing at, if any.
 */
export const STAND_PROMPT_RADIUS_M = 3.5;
export const STAND_TITLE = 'Trading Stand - Open Bazaar';

export interface StandPoint {
  placementId: string;
  pos: readonly [number, number, number];
}

/** The nearest stand within `radius` metres of `self`, or null. */
export function nearestStandWithin(
  self: readonly [number, number, number],
  stands: readonly StandPoint[],
  radius = STAND_PROMPT_RADIUS_M,
): StandPoint | null {
  let best: StandPoint | null = null;
  let bestD = radius;
  for (const s of stands) {
    const d = Math.hypot(s.pos[0] - self[0], s.pos[1] - self[1], s.pos[2] - self[2]);
    if (d <= bestD) { best = s; bestD = d; }
  }
  return best;
}
