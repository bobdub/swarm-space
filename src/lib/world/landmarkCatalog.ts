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
  /** One-line description for the Builder Bar tooltip. */
  description: string;
  /** Footprint in plot cells (WALL_PITCH × WALL_PITCH each). */
  sizeCells: { w: number; d: number };
  /** Rarity tier — drives UI tinting and unlock cadence. */
  tier: 'common' | 'rare';
  /** SWARM cost to place. Undefined = free (unlocked by plot ownership). */
  priceSwarm?: number;
  /** Lifecycle status — gates UI rendering until wired. */
  status: 'planned' | 'beta' | 'shipped';
}

/**
 * Chartered landmarks for v1. All `planned` until placement + asset
 * pipelines land. Landmarks may only be placed on the owner's plotted
 * land; everything else can go anywhere.
 */
export const LANDMARK_CATALOG: ReadonlyArray<LandmarkPrefab> = [
  {
    id: 'trader-stand',
    label: 'Trader Stand',
    description: 'Sell collected items from in-world play.',
    sizeCells: { w: 1, d: 1 },
    tier: 'common',
    status: 'planned',
  },
  {
    id: 'avatar-statue',
    label: 'Statue',
    description: 'A rock statue rendering of a user\u2019s avatar.',
    sizeCells: { w: 1, d: 1 },
    tier: 'common',
    status: 'planned',
  },
  {
    id: 'weighted-coin-plinth',
    label: 'Weighted Coin',
    description: 'Display a personally crafted weighted coin.',
    sizeCells: { w: 1, d: 1 },
    tier: 'rare',
    status: 'planned',
  },
];

/**
 * Returns landmarks the given plot's owner can place. v1 returns the
 * full chartered catalog (all `planned`) so the Builder Bar can list
 * them with a "Coming soon" affordance. Returns [] when the player is
 * not standing on a plot they own.
 */
export function landmarksForPlot(plot: LandPlot | null): ReadonlyArray<LandmarkPrefab> {
  if (!plot || !plot.unlocksLandmarks) return [];
  return LANDMARK_CATALOG;
}

/** True once the catalog ships at least one non-`planned` landmark. */
export function hasLandmarkCatalog(): boolean {
  return LANDMARK_CATALOG.some((l) => l.status !== 'planned');
}