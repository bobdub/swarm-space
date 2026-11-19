import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  hiveSpotOnTree,
  pickNewHiveTree,
  rehomeHivesFrom,
  hiveBuildProgress,
  HIVE_BUILD_MS,
  HIVE_REACH,
  HUSK_MS,
  _resetHiveRehomeForTest,
} from '@/lib/brain/nature/hiveRehome';
import { registerTreeHit, HITS_TO_FELL, _resetTreeChopForTest } from '@/lib/world/treeChopStore';

const hive = () => engineState.blocks.get('hive:hive-0')!;

/** Fell a tree and clear it away, the way chopping does. */
function fell(treeId: string, now: number): string[] {
  for (let i = 0; i < HITS_TO_FELL; i++) registerTreeHit(treeId);
  engineState.blocks.delete(treeId);
  return rehomeHivesFrom(treeId, now);
}

describe('bees rebuild their hive in a new tree', () => {
  beforeEach(() => {
    engineState.blocks.clear();
    _resetTreeChopForTest();
    vi.useFakeTimers();
  });
  afterEach(() => {
    _resetHiveRehomeForTest();
    vi.useRealTimers();
  });

  it('moves the hive to the nearest standing tree when its tree is felled', () => {
    seedDefaultBiome('swarm-shared-village');
    const oldTree = hive().meta.treeId as string;
    const from = { x: hive().rightOffset, z: hive().forwardOffset };
    const standing = [...engineState.blocks.values()]
      .filter((b) => b.kind === 'tree' && b.bodyId !== oldTree)
      .map((b) => ({ id: b.bodyId, x: b.rightOffset, z: b.forwardOffset }));
    const expected = pickNewHiveTree(from, standing)!;

    expect(fell(oldTree, 1000)).toEqual(['hive-0']);

    const h = hive();
    expect(h.meta.treeId).toBe(expected.id);
    expect(h.meta.builtAt).toBe(1000);
    const tree = engineState.blocks.get(expected.id)!;
    // Hangs one branch-length out from the new trunk, facing the village.
    expect(h.rightOffset + (h.meta.trunkRight as number)).toBeCloseTo(tree.rightOffset, 6);
    expect(h.forwardOffset + (h.meta.trunkForward as number)).toBeCloseTo(tree.forwardOffset, 6);
    expect(Math.hypot(h.meta.trunkRight as number, h.meta.trunkForward as number)).toBeCloseTo(HIVE_REACH, 6);
    // The queen moves in too.
    const queen = engineState.blocks.get('queen_bee:queen-0')!;
    expect([queen.rightOffset, queen.forwardOffset]).toEqual([h.rightOffset, h.forwardOffset]);
  });

  it('leaves the broken comb on the grass where the hive fell, then clears it', () => {
    seedDefaultBiome('swarm-shared-village');
    const at = [hive().rightOffset, hive().forwardOffset];
    fell(hive().meta.treeId as string, 1000);
    const husk = engineState.blocks.get('hive_husk:hive-0-husk-0')!;
    expect([husk.rightOffset, husk.forwardOffset]).toEqual(at);
    vi.advanceTimersByTime(HUSK_MS + 1);
    expect(engineState.blocks.has('hive_husk:hive-0-husk-0')).toBe(false);
  });

  it('keeps moving as each new tree is felled, never back to a fallen one', () => {
    seedDefaultBiome('swarm-shared-village');
    const used = new Set<string>();
    for (let n = 0; n < 4; n++) {
      const t = hive().meta.treeId as string;
      expect(used.has(t)).toBe(false);
      used.add(t);
      fell(t, 1000 + n);
      expect(engineState.blocks.has(`hive_husk:hive-0-husk-${n}`)).toBe(true);
    }
    expect(engineState.blocks.has(hive().meta.treeId as string)).toBe(true);
  });

  it('skips a tree that is already falling', () => {
    seedDefaultBiome('swarm-shared-village');
    const oldTree = hive().meta.treeId as string;
    const first = (() => {
      const standing = [...engineState.blocks.values()]
        .filter((b) => b.kind === 'tree' && b.bodyId !== oldTree)
        .map((b) => ({ id: b.bodyId, x: b.rightOffset, z: b.forwardOffset }));
      return pickNewHiveTree({ x: hive().rightOffset, z: hive().forwardOffset }, standing)!.id;
    })();
    for (let i = 0; i < HITS_TO_FELL; i++) registerTreeHit(first);
    fell(oldTree, 1000);
    expect(hive().meta.treeId).not.toBe(first);
  });

  it('stays on the grass when no tree is left standing', () => {
    seedDefaultBiome('swarm-shared-village');
    const at = [hive().rightOffset, hive().forwardOffset];
    for (const b of [...engineState.blocks.values()]) {
      if (b.kind === 'tree' && b.bodyId !== hive().meta.treeId) engineState.blocks.delete(b.bodyId);
    }
    expect(fell(hive().meta.treeId as string, 1000)).toEqual([]);
    expect(hive().meta.treeId).toBe('');
    expect([hive().rightOffset, hive().forwardOffset]).toEqual(at);
  });

  it('picks the same tree on every peer', () => {
    const runOnce = () => {
      engineState.blocks.clear();
      _resetTreeChopForTest();
      seedDefaultBiome('swarm-shared-village');
      fell(hive().meta.treeId as string, 5000);
      return { tree: hive().meta.treeId, x: hive().rightOffset, z: hive().forwardOffset };
    };
    expect(runOnce()).toEqual(runOnce());
  });
});

describe('hive helpers', () => {
  it('hangs the hive on the village side of the trunk', () => {
    const s = hiveSpotOnTree({ x: 10, z: 0 });
    expect(s.x).toBeCloseTo(10 - HIVE_REACH, 6);
    expect(s.z).toBeCloseTo(0, 6);
  });

  it('breaks distance ties by tree id', () => {
    const trees = [{ id: 'tree:b', x: 1, z: 0 }, { id: 'tree:a', x: -1, z: 0 }];
    expect(pickNewHiveTree({ x: 0, z: 0 }, trees)?.id).toBe('tree:a');
  });

  it('builds the comb up over time', () => {
    expect(hiveBuildProgress(undefined, 0)).toBe(1);
    expect(hiveBuildProgress(0, 0)).toBe(0);
    expect(hiveBuildProgress(0, HIVE_BUILD_MS / 2)).toBeCloseTo(0.5, 6);
    expect(hiveBuildProgress(0, HIVE_BUILD_MS * 2)).toBe(1);
  });
});
