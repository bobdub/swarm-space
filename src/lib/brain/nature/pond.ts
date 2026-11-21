/**
 * The village pond, in the shared village anchor's tangent frame (m).
 * Kept in its own tiny module so land rules can read it without pulling
 * in the biome seeder.
 */
export const POND_CENTRE = { right: 0, forward: -30 } as const;
export const POND_RADIUS = 5.5;
