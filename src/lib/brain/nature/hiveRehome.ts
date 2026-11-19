/**
 * Hive rehoming — when a hive's host tree is felled, the colony moves.
 *
 * The hive falls with its tree (see `Hive` in NatureLayer). Once the
 * felled tree is cleared away (or an old tree has died back), the bees abandon the broken comb on the
 * grass and build a new hive on a branch of the nearest standing tree.
 *
 * The new home is a pure function of the world: the standing trees, their
 * ids and positions, and where the old hive was. Every peer that sees the
 * same trees standing picks the same tree and hangs the hive at the same
 * spot, the same way the starter biome placed the first one.
 */
import { getBuilderBlockEngine, type BuilderBlock } from '@/lib/brain/builderBlockEngine';
import { isTreeFelled } from '@/lib/world/treeChopStore';
import { isTreeGrown, treeLifeLeft } from '@/lib/brain/nature/natureGrowth';

/** How far out along its branch the hive hangs from the trunk (m). */
export const HIVE_REACH = 1.9;

/** How long the bees take to build the new comb up to full size. */
export const HIVE_BUILD_MS = 20_000;

/** Bees only move into a grown tree with at least this long left to live. */
export const MIN_HOST_LIFE_MS = 30 * 60_000;

/** How long the abandoned comb lies on the grass before it crumbles away. */
export const HUSK_MS = 30_000;

const BIOME_TAG = 'nature.biome.v1';

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

const huskTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Move every hive that hung from `felledTreeId` to a new tree. Called once
 * the felled (or dead) tree's block has been removed. Only grown trees
 * that are not about to die back are chosen. Leaves a broken comb where the
 * hive fell. Returns the ids of the hives that moved.
 */
export function rehomeHivesFrom(felledTreeId: string, now = Date.now()): string[] {
  const engine = getBuilderBlockEngine();
  const moved: string[] = [];
  const hives = engine.listBlocks((b) => b.kind === 'hive' && b.meta?.treeId === felledTreeId);
  for (const hive of hives) {
    if (rehomeHive(hive, felledTreeId, now)) moved.push(hive.id);
  }
  return moved;
}

function rehomeHive(hive: BuilderBlock, felledTreeId: string, now: number): boolean {
  const engine = getBuilderBlockEngine();
  // Trees that already carry a hive are taken.
  const taken = new Set<string>([felledTreeId]);
  for (const h of engine.listBlocks((b) => b.kind === 'hive' && b.bodyId !== hive.bodyId)) {
    if (typeof h.meta?.treeId === 'string') taken.add(h.meta.treeId);
  }
  const trees: TreeSpot[] = engine
    .listBlocks((b) =>
      b.kind === 'tree'
      && b.meta?.biome === BIOME_TAG
      && b.anchorPeerId === hive.anchorPeerId
      && !isTreeFelled(b.bodyId)
      && isTreeGrown(b, now)
      && treeLifeLeft(b, now) >= MIN_HOST_LIFE_MS)
    .map((b) => ({ id: b.bodyId, x: b.rightOffset, z: b.forwardOffset }));

  const target = pickNewHiveTree({ x: hive.rightOffset, z: hive.forwardOffset }, trees, taken);
  const moves = typeof hive.meta?.moves === 'number' ? (hive.meta.moves as number) : 0;

  // The broken comb stays on the grass where the hive fell, then crumbles.
  const huskId = `${hive.id}-husk-${moves}`;
  engine.placeBlock({
    id: huskId,
    kind: 'hive_husk',
    anchorPeerId: hive.anchorPeerId,
    rightOffset: hive.rightOffset,
    forwardOffset: hive.forwardOffset,
    mass: 1,
    basin: 0.1,
    meta: { biome: BIOME_TAG, species: 'hive_husk', abandonedAt: now, hiveId: hive.id },
  });
  const huskBodyId = `hive_husk:${huskId}`;
  const prev = huskTimers.get(huskBodyId);
  if (prev) clearTimeout(prev);
  huskTimers.set(huskBodyId, setTimeout(() => {
    huskTimers.delete(huskBodyId);
    try { engine.removeBlock(huskBodyId); } catch { /* already gone */ }
  }, HUSK_MS));

  if (!target) {
    // No standing tree left: the colony keeps working the fallen hive.
    engine.upgradeBlock(hive.bodyId, { meta: { treeId: '', moves: moves + 1 } });
    return false;
  }

  const spot = hiveSpotOnTree(target);
  engine.upgradeBlock(hive.bodyId, {
    rightOffset: spot.x,
    forwardOffset: spot.z,
    meta: {
      treeId: target.id,
      trunkRight: spot.trunkRight,
      trunkForward: spot.trunkForward,
      builtAt: now,
      moves: moves + 1,
    },
  });
  // The queen moves in with the colony.
  for (const q of engine.listBlocks((b) => b.kind === 'queen_bee' && b.meta?.hiveId === hive.id)) {
    engine.upgradeBlock(q.bodyId, { rightOffset: spot.x, forwardOffset: spot.z });
  }
  return true;
}

export function _resetHiveRehomeForTest(): void {
  for (const t of huskTimers.values()) clearTimeout(t);
  huskTimers.clear();
}
