import { describe, it, expect, vi, beforeEach } from 'vitest';

type FakeBlock = {
  id: string;
  kind: string;
  bodyId: string;
  anchorPeerId: string;
  rightOffset: number;
  forwardOffset: number;
  meta: Record<string, unknown>;
};

const engineState = vi.hoisted(() => ({ blocks: new Map<string, FakeBlock>() }));
vi.mock('@/lib/brain/builderBlockEngine', () => ({
  getBuilderBlockEngine: () => ({
    placeBlock: (spec: Omit<FakeBlock, 'bodyId'> & { meta?: Record<string, unknown> }) => {
      const bodyId = `${spec.kind}:${spec.id}`;
      const existing = engineState.blocks.get(bodyId);
      if (existing) return existing;
      const b: FakeBlock = {
        id: spec.id,
        kind: spec.kind,
        bodyId,
        anchorPeerId: spec.anchorPeerId,
        rightOffset: spec.rightOffset ?? 0,
        forwardOffset: spec.forwardOffset ?? 0,
        meta: { ...(spec.meta ?? {}) },
      };
      engineState.blocks.set(bodyId, b);
      return b;
    },
    removeBlock: (id: string) => { engineState.blocks.delete(id); },
    getBlock: (id: string) => engineState.blocks.get(id),
    listBlocks: (f?: (b: FakeBlock) => boolean) => {
      const all = [...engineState.blocks.values()];
      return f ? all.filter(f) : all;
    },
    upgradeBlock: (id: string, patch: Partial<FakeBlock>) => {
      const b = engineState.blocks.get(id);
      if (!b) return null;
      if (patch.rightOffset !== undefined) b.rightOffset = patch.rightOffset;
      if (patch.forwardOffset !== undefined) b.forwardOffset = patch.forwardOffset;
      if (patch.meta) b.meta = { ...b.meta, ...patch.meta };
      return b;
    },
  }),
}));

import { seedDefaultBiome } from '@/lib/brain/nature/natureSeed';
import {
  getGrowthLayout,
  treeGrowth,
  isTreeGrown,
  flowerBloom,
  fruitAt,
  pickFruit,
  cycleAt,
  TREE_SPOTS,
  FLOWER_SPOTS,
  TREE_CYCLE_MS,
  TREE_LIFE_MS,
  TREE_GROW_MS,
  TREE_SEED_MS,
  FLOWER_LIFE_MS,
  FRUIT_PERIOD_MS,
  FRUIT_GROW_MS,
  FRUIT_PER_TREE,
  _resetNatureGrowthForTest,
} from '@/lib/brain/nature/natureGrowth';
import { syncNatureWorld, HIVE_BODY_ID } from '@/lib/brain/nature/natureWorld';
import { TREE_CLEAR_MS } from '@/lib/brain/nature/hiveRehome';
import { recordNatureEvent, _resetNatureEventsForTest } from '@/lib/world/natureEventsStore';
import { _resetTreeChopForTest } from '@/lib/world/treeChopStore';
import { collectHoney, canCollectHoney, HONEY_PER_DAY, _resetHoneyForTest } from '@/lib/world/honeyStore';

const ANCHOR = 'swarm-shared-village';
const grown = (kind: string) => [...engineState.blocks.values()].filter((b) => b.kind === kind && b.id.startsWith('grown-'));

function snapshot(now: number) {
  engineState.blocks.clear();
  _resetNatureGrowthForTest();
  _resetNatureEventsForTest();
  seedDefaultBiome(ANCHOR);
  syncNatureWorld(ANCHOR, now);
  return [...engineState.blocks.values()]
    .filter((b) => b.id.startsWith('grown-'))
    .map((b) => [b.bodyId, b.rightOffset, b.forwardOffset])
    .sort();
}

describe('trees seed and grow, flowers spread', () => {
  beforeEach(() => {
    engineState.blocks.clear();
    _resetNatureGrowthForTest();
    _resetNatureEventsForTest();
    _resetTreeChopForTest();
  });

  it('lays out seed spots near parents, away from the pond and the village centre', () => {
    seedDefaultBiome(ANCHOR);
    const layout = getGrowthLayout(ANCHOR)!;
    expect(layout.trees).toHaveLength(TREE_SPOTS);
    expect(layout.flowers).toHaveLength(FLOWER_SPOTS);
    for (const s of layout.trees) {
      const d = Math.hypot(s.x - s.parent.x, s.z - s.parent.z);
      expect(d).toBeGreaterThanOrEqual(4.5 - 1e-9);
      expect(d).toBeLessThanOrEqual(9 + 1e-9);
      expect(Math.hypot(s.x, s.z + 30)).toBeGreaterThan(5.5 + 1.5);
      expect(Math.hypot(s.x, s.z)).toBeGreaterThan(8);
    }
  });

  it('every peer sees the same seedlings and flowers at the same time', () => {
    const t = Date.UTC(2026, 10, 20, 8, 0, 0);
    expect(snapshot(t)).toEqual(snapshot(t));
    expect(snapshot(t).length).toBeGreaterThan(0);
  });

  it('a seed sprouts and grows into a full tree, then dies back and a new seed falls', () => {
    seedDefaultBiome(ANCHOR);
    const spot = getGrowthLayout(ANCHOR)!.trees[0];
    // The moment a new cycle begins at spot 0.
    const c0 = cycleAt(Date.UTC(2026, 10, 20), spot.offset, TREE_CYCLE_MS, TREE_LIFE_MS);
    const birth = c0.start + TREE_CYCLE_MS;

    syncNatureWorld(ANCHOR, birth + 1000);
    const tree = engineState.blocks.get(`tree:grown-tree-0-c${c0.cycle + 1}`)!;
    expect(tree).toBeDefined();
    expect(treeGrowth(tree, birth + 1000)).toBe(0); // still a seed
    expect(treeGrowth(tree, birth + TREE_SEED_MS + (TREE_GROW_MS - TREE_SEED_MS) / 2)).toBeCloseTo(0.5, 6);
    expect(isTreeGrown(tree, birth + TREE_GROW_MS - 1)).toBe(false);
    expect(isTreeGrown(tree, birth + TREE_GROW_MS)).toBe(true);

    // Old age: gone after its life, back as a new seed next cycle.
    syncNatureWorld(ANCHOR, birth + TREE_LIFE_MS + 1000);
    expect(engineState.blocks.has(tree.bodyId)).toBe(false);
    syncNatureWorld(ANCHOR, birth + TREE_CYCLE_MS + 1000);
    expect(engineState.blocks.has(`tree:grown-tree-0-c${c0.cycle + 2}`)).toBe(true);
  });

  it('flowers bud, bloom and wilt', () => {
    seedDefaultBiome(ANCHOR);
    const t = Date.UTC(2026, 10, 20);
    syncNatureWorld(ANCHOR, t);
    const f = grown('flower')[0];
    const start = (f.meta.growth as { start: number }).start;
    expect(flowerBloom(f, start)).toBe(0);
    expect(flowerBloom(f, start + FLOWER_LIFE_MS / 2)).toBe(1);
    expect(flowerBloom(f, start + FLOWER_LIFE_MS)).toBe(0);
  });

  it('does not put back a tree or flower a player took this cycle', () => {
    seedDefaultBiome(ANCHOR);
    const t = Date.UTC(2026, 10, 20);
    syncNatureWorld(ANCHOR, t);
    const f = grown('flower')[0];
    engineState.blocks.delete(f.bodyId);
    syncNatureWorld(ANCHOR, t + 5000);
    expect(engineState.blocks.has(f.bodyId)).toBe(false);
  });

  it('bees only move into a grown tree', () => {
    seedDefaultBiome(ANCHOR);
    const t = Date.UTC(2026, 10, 20);
    syncNatureWorld(ANCHOR, t);
    const old = engineState.blocks.get(HIVE_BODY_ID)!.meta.treeId as string;
    recordNatureEvent('fell', old, ANCHOR, 0, 0, t);
    const moved = t + TREE_CLEAR_MS;
    syncNatureWorld(ANCHOR, moved);
    const hive = engineState.blocks.get(HIVE_BODY_ID)!;
    expect(hive.meta.treeId).not.toBe(old);
    const host = engineState.blocks.get(hive.meta.treeId as string)!;
    expect(isTreeGrown(host, moved)).toBe(true);
  });
});

describe('fruit', () => {
  beforeEach(() => _resetNatureGrowthForTest());
  const tree = { bodyId: 'tree:tree-3', meta: {} };

  it('ripens on a repeating timer and can be picked once per crop', () => {
    let t = Date.UTC(2026, 10, 20);
    // Walk forward to the moment this crop turns ripe.
    while (!fruitAt(tree.bodyId, t).ripe) t += 1000;
    expect(fruitAt(tree.bodyId, t - 1000).size).toBeLessThan(1);
    expect(pickFruit(tree, t)).toEqual({ ok: true, count: FRUIT_PER_TREE });
    expect(pickFruit(tree, t + 1000)).toMatchObject({ ok: false, reason: 'picked' });
    // The next crop grows green first, then can be picked again.
    const next = t + (FRUIT_PERIOD_MS - FRUIT_GROW_MS);
    expect(pickFruit(tree, next + 1000)).toMatchObject({ ok: false, reason: 'unripe' });
    expect(pickFruit(tree, next + FRUIT_GROW_MS + 1000).ok).toBe(true);
  });

  it('young trees bear no fruit', () => {
    const now = Date.UTC(2026, 10, 20);
    const young = { bodyId: 'tree:grown-tree-1-c9', meta: { growth: { start: now, life: TREE_LIFE_MS, grow: TREE_GROW_MS } } };
    expect(pickFruit(young, now + 1000)).toMatchObject({ ok: false, reason: 'young' });
  });
});

describe('honey', () => {
  beforeEach(() => _resetHoneyForTest());

  it('can be collected once a day', () => {
    const morning = new Date(2026, 10, 20, 8, 0).getTime();
    expect(collectHoney('hive-0', morning)).toBe(HONEY_PER_DAY);
    expect(canCollectHoney('hive-0', morning + 3_600_000)).toBe(false);
    expect(collectHoney('hive-0', new Date(2026, 10, 20, 23, 59).getTime())).toBe(0);
    expect(collectHoney('hive-0', new Date(2026, 10, 21, 0, 1).getTime())).toBe(HONEY_PER_DAY);
  });
});
