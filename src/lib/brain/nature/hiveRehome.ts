/**
 * Hive rehoming — where the honey hive hangs, worked out the same way on
 * every peer.
 *
 * The colony moves house when:
 *   - its tree is felled: the hive falls with it, and once the tree is
 *     cleared away the bees leave the broken comb on the grass;
 *   - its tree dies of old age;
 *   - a player chops the hive itself.
 * Each time, they build a new hive on a branch of the nearest grown tree
 * that is still standing (not the one they just left).
 *
 * `resolveHive` replays the shared nature events (felled trees, chopped
 * hives) in time order from the starter layout, so every peer with the
 * same events gets the same hive, at the same tree, built at the same
 * moment — no matter in which order the events reached it.
 */
import { TOPPLE_MS, STUMP_FADE_MS } from '@/lib/world/treeChopStore';
import {
  incarnationOf,
  treesAt,
  type FellMap,
  type GrowthLayout,
} from '@/lib/brain/nature/natureGrowth';

/** How far out along its branch the hive hangs from the trunk (m). */
export const HIVE_REACH = 1.9;

/** How long the bees take to build the new comb up to full size. */
export const HIVE_BUILD_MS = 20_000;

/** Bees only move into a grown tree with at least this long left to live. */
export const MIN_HOST_LIFE_MS = 30 * 60_000;

/** How long the abandoned comb lies on the grass before it crumbles away. */
export const HUSK_MS = 30_000;

/** From the felling cut to the felled tree being cleared away. */
export const TREE_CLEAR_MS = TOPPLE_MS + STUMP_FADE_MS;

/** A hive left on the grass with no tree to go to tries again this often. */
export const GROUNDED_RETRY_MS = 30 * 60_000;

export interface TreeSpot {
  /** Block body id, e.g. `tree:tree-3`. */
  id: string;
  /** Right / forward offset from the biome anchor (m). */
  x: number;
  z: number;
}

export interface HiveSpot {
  /** Hive right / forward offset from the biome anchor (m). */
  x: number;
  z: number;
  /** Trunk position relative to the hive, in the hive's right/forward frame. */
  trunkRight: number;
  trunkForward: number;
}

/**
 * Where a hive hangs on `tree`: HIVE_REACH out along a branch, on the side
 * facing the village anchor so it is in view.
 */
export function hiveSpotOnTree(tree: { x: number; z: number }): HiveSpot {
  const len = Math.hypot(tree.x, tree.z);
  // A tree right on the anchor has no "village side"; hang it to the south.
  const ux = len > 1e-6 ? tree.x / len : 0;
  const uz = len > 1e-6 ? tree.z / len : 1;
  const x = tree.x - ux * HIVE_REACH;
  const z = tree.z - uz * HIVE_REACH;
  return { x, z, trunkRight: tree.x - x, trunkForward: tree.z - z };
}

/**
 * The standing tree closest to `from`, skipping `exclude`. Ties go to the
 * lower id so every peer breaks them the same way.
 */
export function pickNewHiveTree(
  from: { x: number; z: number },
  trees: TreeSpot[],
  exclude: ReadonlySet<string> = new Set(),
): TreeSpot | null {
  let best: TreeSpot | null = null;
  let bestD = Infinity;
  for (const t of trees) {
    if (exclude.has(t.id)) continue;
    const d = Math.hypot(t.x - from.x, t.z - from.z);
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best && t.id < best.id)) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** 0 → just started, 1 → fully built. Hives without a build time are built. */
export function hiveBuildProgress(builtAt: unknown, now: number): number {
  if (typeof builtAt !== 'number' || !Number.isFinite(builtAt)) return 1;
  return Math.min(1, Math.max(0, (now - builtAt) / HIVE_BUILD_MS));
}

export interface HiveHuskRecord {
  /** Where the abandoned comb lies (anchor right / forward, m). */
  x: number;
  z: number;
  /** When the bees left it. */
  at: number;
  /** Which move this was (0 for the first), for a stable block id. */
  n: number;
}

export interface HiveState {
  /** Host tree body id; '' when the hive lies on the grass. */
  treeId: string;
  x: number;
  z: number;
  trunkRight: number;
  trunkForward: number;
  /** When the current comb was started (undefined for the starter hive). */
  builtAt?: number;
  moves: number;
  husks: HiveHuskRecord[];
}

/** Grown trees a colony could move into at time `t`. */
function hostsAt(layout: GrowthLayout, t: number, fells: FellMap): TreeSpot[] {
  return treesAt(layout, t, fells, TREE_CLEAR_MS)
    .filter((inc) =>
      inc.grownAt <= t
      && inc.diesAt - t >= MIN_HOST_LIFE_MS
      && (inc.felledAt === undefined || t < inc.felledAt))
    .map((inc) => ({ id: inc.id, x: inc.x, z: inc.z }));
}

/**
 * Where the hive is at `now`, given the shared events.
 *
 * @param fells     earliest felling time of each tree body id
 * @param hiveDowns times the hive itself was chopped
 */
export function resolveHive(
  layout: GrowthLayout,
  fells: FellMap,
  hiveDowns: number[],
  now: number,
): HiveState | null {
  const starter = layout.starters?.find((s) => s.id === layout.hiveHost);
  if (!starter) return null;
  const first = hiveSpotOnTree(starter);
  const state: HiveState = {
    treeId: starter.id,
    x: first.x,
    z: first.z,
    trunkRight: first.trunkRight,
    trunkForward: first.trunkForward,
    moves: 0,
    husks: [],
  };
  const downs = [...hiveDowns].sort((a, b) => a - b);
  let cursor = -Infinity;

  for (let guard = 0; guard < 1000; guard++) {
    // When does the colony next have to move?
    let next = Infinity;
    let leavesComb = true;
    if (state.treeId) {
      const host = incarnationOf(layout, state.treeId, fells);
      if (host) {
        if (host.felledAt !== undefined) next = Math.min(next, host.felledAt + TREE_CLEAR_MS);
        next = Math.min(next, host.diesAt);
      }
    } else if (Number.isFinite(cursor)) {
      next = cursor + GROUNDED_RETRY_MS;
      leavesComb = false;
    }
    const down = downs.find((t) => t > cursor);
    if (down !== undefined && down <= next) {
      next = down;
      leavesComb = true;
    }
    if (!Number.isFinite(next) || next > now) break;

    const target = pickNewHiveTree(
      { x: state.x, z: state.z },
      hostsAt(layout, next, fells),
      new Set(state.treeId ? [state.treeId] : []),
    );
    if (target) {
      if (leavesComb || state.treeId === '') {
        state.husks.push({ x: state.x, z: state.z, at: next, n: state.moves });
      }
      const spot = hiveSpotOnTree(target);
      state.treeId = target.id;
      state.x = spot.x;
      state.z = spot.z;
      state.trunkRight = spot.trunkRight;
      state.trunkForward = spot.trunkForward;
      state.builtAt = next;
      state.moves += 1;
    } else if (state.treeId) {
      // Nowhere to go: the colony stays with its comb on the grass.
      state.treeId = '';
    }
    cursor = next;
  }
  return state;
}
