/**
 * natureWorld — keeps this peer's trees, flowers and honey hive in line
 * with the shared clock and the shared nature events.
 *
 * Which trees stand, which are falling, where the hive hangs and which
 * broken combs lie on the grass are all worked out from the same inputs on
 * every peer (see natureGrowth, hiveRehome, natureEventsStore). This
 * module only makes the local block engine match that answer. Safe to call
 * as often as you like.
 */
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { NATURE_CATALOG } from '@/lib/brain/nature/natureCatalog';
import {
  bareId,
  getGrowthLayout,
  syncFlowers,
  treesAt,
  STARTER_LIFE_MS,
  TREE_GROW_MS,
  TREE_LIFE_MS,
  type FellMap,
  type TreeIncarnation,
} from '@/lib/brain/nature/natureGrowth';
import { resolveHive, HUSK_MS, TREE_CLEAR_MS } from '@/lib/brain/nature/hiveRehome';
import { listNatureEvents } from '@/lib/world/natureEventsStore';
import { clearTreeChop, markTreeFelled } from '@/lib/world/treeChopStore';

const BIOME_TAG = 'nature.biome.v1';
export const HIVE_ID = 'hive-0';
export const HIVE_BODY_ID = `hive:${HIVE_ID}`;
const QUEEN_BODY_ID = 'queen_bee:queen-0';

/** Earliest felling of each tree, and every time the hive was chopped. */
export function readNatureEvents(anchorPeerId: string): { fells: Map<string, number>; hiveDowns: number[] } {
  const fells = new Map<string, number>();
  const hiveDowns: number[] = [];
  for (const e of listNatureEvents(anchorPeerId)) {
    if (e.kind === 'fell') {
      const prev = fells.get(e.blockId);
      if (prev === undefined || e.at < prev) fells.set(e.blockId, e.at);
    } else if (e.kind === 'hive-down' && e.blockId === HIVE_BODY_ID) {
      hiveDowns.push(e.at);
    }
  }
  return { fells, hiveDowns };
}

function treeMeta(inc: TreeIncarnation): Record<string, unknown> {
  if (!Number.isFinite(inc.appearsAt)) return { stage: 'mature' };
  if (inc.spot !== undefined) {
    return {
      stage: 'growing',
      spot: inc.spot,
      growth: { start: inc.appearsAt, life: TREE_LIFE_MS, grow: TREE_GROW_MS },
      // Parent trunk relative to this spot, for the falling seed.
      parentRight: (inc.parent?.x ?? inc.x) - inc.x,
      parentForward: (inc.parent?.z ?? inc.z) - inc.z,
    };
  }
  // A starter tree growing back from a seed at its old spot.
  return { stage: 'growing', growth: { start: inc.appearsAt, life: STARTER_LIFE_MS, grow: TREE_GROW_MS } };
}

function syncTrees(anchorPeerId: string, now: number, fells: FellMap): void {
  const layout = getGrowthLayout(anchorPeerId);
  if (!layout) return;
  const engine = getBuilderBlockEngine();
  const spec = NATURE_CATALOG.tree;
  const want = new Set<string>();

  for (const inc of treesAt(layout, now, fells, TREE_CLEAR_MS)) {
    want.add(inc.id);
    if (!engine.getBlock(inc.id)) {
      engine.placeBlock({
        id: bareId(inc.id),
        kind: 'tree',
        anchorPeerId,
        rightOffset: inc.x,
        forwardOffset: inc.z,
        mass: spec.mass,
        basin: spec.basin,
        meta: { ...treeMeta(inc), biome: BIOME_TAG, species: 'tree' },
      });
    }
    // Felled by another player: show it coming down here too.
    if (inc.felledAt !== undefined && now >= inc.felledAt) markTreeFelled(inc.id, inc.felledAt);
  }

  const starters = layout.starters ?? [];
  const ours = (bodyId: string, id: string) =>
    id.startsWith('grown-tree-')
    || starters.some((s) => bodyId === s.id || bodyId.startsWith(`${s.id}~`));
  for (const b of engine.listBlocks((x) =>
    x.kind === 'tree' && x.anchorPeerId === anchorPeerId && x.meta?.biome === BIOME_TAG)) {
    if (!ours(b.bodyId, b.id) || want.has(b.bodyId)) continue;
    engine.removeBlock(b.bodyId);
    clearTreeChop(b.bodyId);
  }
}

function syncHive(anchorPeerId: string, now: number, fells: FellMap, hiveDowns: number[]): void {
  const layout = getGrowthLayout(anchorPeerId);
  if (!layout) return;
  const st = resolveHive(layout, fells, hiveDowns, now);
  if (!st) return;
  const engine = getBuilderBlockEngine();

  const meta = {
    treeId: st.treeId,
    trunkRight: st.trunkRight,
    trunkForward: st.trunkForward,
    builtAt: st.builtAt,
    moves: st.moves,
  };
  const hive = engine.getBlock(HIVE_BODY_ID);
  if (!hive) {
    const spec = NATURE_CATALOG.hive;
    engine.placeBlock({
      id: HIVE_ID,
      kind: 'hive',
      anchorPeerId,
      rightOffset: st.x,
      forwardOffset: st.z,
      mass: spec.mass,
      basin: spec.basin,
      meta: { honey: 0, workerCap: 8, ...meta, biome: BIOME_TAG, species: 'hive' },
    });
  } else if (
    hive.meta?.treeId !== st.treeId
    || hive.meta?.builtAt !== st.builtAt
    || Math.abs(hive.rightOffset - st.x) > 1e-6
    || Math.abs(hive.forwardOffset - st.z) > 1e-6
  ) {
    engine.upgradeBlock(HIVE_BODY_ID, { rightOffset: st.x, forwardOffset: st.z, meta });
    const queen = engine.getBlock(QUEEN_BODY_ID);
    if (queen) engine.upgradeBlock(QUEEN_BODY_ID, { rightOffset: st.x, forwardOffset: st.z });
  }

  // Broken combs lie on the grass for a while after the bees leave them.
  const wantHusks = new Set<string>();
  for (const h of st.husks) {
    if (now - h.at >= HUSK_MS || now < h.at) continue;
    const id = `${HIVE_ID}-husk-${h.n}`;
    const bodyId = `hive_husk:${id}`;
    wantHusks.add(bodyId);
    if (engine.getBlock(bodyId)) continue;
    engine.placeBlock({
      id,
      kind: 'hive_husk',
      anchorPeerId,
      rightOffset: h.x,
      forwardOffset: h.z,
      mass: 1,
      basin: 0.1,
      meta: { biome: BIOME_TAG, species: 'hive_husk', abandonedAt: h.at, hiveId: HIVE_ID },
    });
  }
  for (const b of engine.listBlocks((x) => x.kind === 'hive_husk' && x.anchorPeerId === anchorPeerId)) {
    if (!wantHusks.has(b.bodyId)) engine.removeBlock(b.bodyId);
  }
}

/** Bring trees, flowers and the hive in line with the clock and the shared events. */
export function syncNatureWorld(anchorPeerId: string, now = Date.now()): void {
  const { fells, hiveDowns } = readNatureEvents(anchorPeerId);
  syncFlowers(anchorPeerId, now);
  syncTrees(anchorPeerId, now, fells);
  syncHive(anchorPeerId, now, fells, hiveDowns);
}
