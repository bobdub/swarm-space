/**
 * Landmark catalog — SCAFFOLD ONLY. Plot owners will unlock landmark
 * prefabs (flag, fountain, signpost, etc.) placeable inside their own
 * plot. The catalog is intentionally empty for v1; the type seam lets
 * the Builder Bar import `landmarksForPlot` today and render an empty
 * "Coming soon" state without a follow-up refactor.
 */
import type { LandPlot } from './landPlots';

export interface LandmarkPrefab {
  id: string;
  label: string;
  /** Footprint in plot cells (WALL_PITCH × WALL_PITCH each). */
  sizeCells: { w: number; d: number };
  /** Rarity tier — drives UI tinting and unlock cadence. */
  tier: 'common' | 'rare';
  /** SWARM cost to place. Undefined = free (unlocked by plot ownership). */
  priceSwarm?: number;
}

export const LANDMARK_CATALOG: ReadonlyArray<LandmarkPrefab> = [];

/**
 * Returns landmarks the given plot's owner can place. v1 returns [].
 * Builder Bar should render a "Coming soon" tile when this is empty
 * AND the player is standing inside one of their own plots.
 */
export function landmarksForPlot(plot: LandPlot | null): ReadonlyArray<LandmarkPrefab> {
  if (!plot || !plot.unlocksLandmarks) return [];
  return LANDMARK_CATALOG;
}

/** Convenience: true once the catalog ships any content. */
export function hasLandmarkCatalog(): boolean {
  return LANDMARK_CATALOG.length > 0;
}