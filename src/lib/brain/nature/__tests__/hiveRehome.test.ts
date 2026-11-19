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
  hiveSpotOnTree,
  pickNewHiveTree,
  hiveBuildProgress,
  resolveHive,
  HIVE_BUILD_MS,
  HIVE_REACH,
  HUSK_MS,
  TREE_CLEAR_MS,
} from '@/lib/brain/nature/hiveRehome';
import {
  getGrowthLayout,
  incarnationOf,
  _resetNatureGrowthForTest,
  STARTER_REGROW_MS,
  TREE_GROW_MS,
} from '@/lib/brain/nature/natureGrowth';
import { syncNatureWorld, readNatureEvents, HIVE_BODY_ID } from '@/lib/brain/nature/natureWorld';
import {
  acceptPeerNatureEvent,
  eventId,
  mergeNatureEvents,
  recordNatureEvent,
  listNatureEvents,
  _resetNatureEventsForTest,
  attachNatureEventGossip,
  type NatureEvent,
} from '@/lib/world/natureEventsStore';
import { isTreeFelled, _resetTreeChopForTest } from '@/lib/world/treeChopStore';

const ANCHOR = 'swarm-shared-village';
const T0 = Date.UTC(2026, 10, 20, 0, 0, 0);
const hive = () => engineState.blocks.get(HIVE_BODY_ID)!;

function freshPeer(): void {
  engineState.blocks.clear();
  _resetNatureGrowthForTest();
  _resetNatureEventsForTest();
  _resetTreeChopForTest();
  seedDefaultBiome(ANCHOR);
}

function fellEvent(blockId: string, at: number): NatureEvent {
  const b = engineState.blocks.get(blockId);
  return { id: eventId('fell', blockId, at), kind: 'fell', blockId, anchorPeerId: ANCHOR, at, x: b?.rightOffset ?? 0, z: b?.forwardOffset ?? 0 };
}

function hiveDownEvent(at: number): NatureEvent {
  return { id: eventId('hive-down', HIVE_BODY_ID, at), kind: 'hive-down', blockId: HIVE_BODY_ID, anchorPeerId: ANCHOR, at, x: 0, z: 0 };
}

/** The hive hangs from a grown tree, one branch-length from its trunk. */
function expectHungOn(treeId: string, now: number): void {
  const h = hive();
  expect(h.meta.treeId).toBe(treeId);
  const tree = engineState.blocks.get(treeId)!;
  expect(tree).toBeDefined();
  expect(h.rightOffset + (h.meta.trunkRight as number)).toBeCloseTo(tree.rightOffset, 6);
  expect(h.forwardOffset + (h.meta.trunkForward as number)).toBeCloseTo(tree.forwardOffset, 6);
  expect(Math.hypot(h.meta.trunkRight as number, h.meta.trunkForward as number)).toBeCloseTo(HIVE_REACH, 6);
  const inc = incarnationOf(getGrowthLayout(ANCHOR)!, treeId, readNatureEvents(ANCHOR).fells)!;
  expect(inc.grownAt).toBeLessThanOrEqual(now);
}

describe('the hive is the same for every peer', () => {
  beforeEach(freshPeer);

  it('starts on the starter host tree', () => {
    syncNatureWorld(ANCHOR, T0);
    expect(hive().meta.treeId).toBe(getGrowthLayout(ANCHOR)!.hiveHost);
  });

  it('when its tree is felled, the hive falls, then the bees move to another grown tree', () => {
    syncNatureWorld(ANCHOR, T0);
    const host = hive().meta.treeId as string;
    const oldSpot = [hive().rightOffset, hive().forwardOffset];
    recordNatureEvent('fell', host, ANCHOR, 0, 0, T0 + 1000);

    // Falling: still on the old tree, which shows as felled.
    syncNatureWorld(ANCHOR, T0 + 2000);
    expect(hive().meta.treeId).toBe(host);
    expect(isTreeFelled(host)).toBe(true);

    // Cleared: tree gone, hive in a new tree, broken comb on the grass.
    const moved = T0 + 1000 + TREE_CLEAR_MS;
    syncNatureWorld(ANCHOR, moved + 10);
    expect(engineState.blocks.has(host)).toBe(false);
    expect(hive().meta.treeId).not.toBe(host);
    expect(hive().meta.builtAt).toBe(moved);
    expectHungOn(hive().meta.treeId as string, moved);
    const husk = engineState.blocks.get('hive_husk:hive-0-husk-0')!;
    expect([husk.rightOffset, husk.forwardOffset]).toEqual(oldSpot);
    const queen = engineState.blocks.get('queen_bee:queen-0')!;
    expect([queen.rightOffset, queen.forwardOffset]).toEqual([hive().rightOffset, hive().forwardOffset]);
    // The comb crumbles away.
    syncNatureWorld(ANCHOR, moved + HUSK_MS + 1);
    expect(engineState.blocks.has('hive_husk:hive-0-husk-0')).toBe(false);
  });

  it('when a player chops the hive itself, the bees build a new one in another tree', () => {
    syncNatureWorld(ANCHOR, T0);
    const host = hive().meta.treeId as string;
    recordNatureEvent('hive-down', HIVE_BODY_ID, ANCHOR, 0, 0, T0 + 5000);
    syncNatureWorld(ANCHOR, T0 + 5001);
    expect(hive().meta.treeId).not.toBe(host);
    expect(engineState.blocks.has(host)).toBe(true); // the old tree still stands
    expect(engineState.blocks.has('hive_husk:hive-0-husk-0')).toBe(true);
    expect(hiveBuildProgress(hive().meta.builtAt, T0 + 5001)).toBeLessThan(0.01);
    expect(hiveBuildProgress(hive().meta.builtAt, T0 + 5000 + HIVE_BUILD_MS)).toBe(1);
    expectHungOn(hive().meta.treeId as string, T0 + 5001);
  });

  it('a tree felled on another peer comes down here too, and the hive follows', () => {
    syncNatureWorld(ANCHOR, T0);
    const host = hive().meta.treeId as string;
    expect(acceptPeerNatureEvent(fellEvent(host, T0 + 1000), T0 + 1500)).toBe(true);
    syncNatureWorld(ANCHOR, T0 + 1500);
    expect(isTreeFelled(host)).toBe(true);
    syncNatureWorld(ANCHOR, T0 + 1000 + TREE_CLEAR_MS);
    expect(engineState.blocks.has(host)).toBe(false);
    expect(hive().meta.treeId).not.toBe(host);
  });

  it('every peer ends up with the same hive, whatever order the events arrive in', () => {
    syncNatureWorld(ANCHOR, T0);
    const layout = getGrowthLayout(ANCHOR)!;
    const host = hive().meta.treeId as string;
    const evts: NatureEvent[] = [fellEvent(host, T0 + 1000), hiveDownEvent(T0 + 60_000)];
    const now = T0 + 120_000;

    const a = (() => {
      freshPeer();
      mergeNatureEvents(evts, now);
      syncNatureWorld(ANCHOR, now);
      return { ...hive().meta, x: hive().rightOffset, z: hive().forwardOffset };
    })();
    const b = (() => {
      freshPeer();
      for (const e of [...evts].reverse()) acceptPeerNatureEvent(e, now);
      syncNatureWorld(ANCHOR, now);
      return { ...hive().meta, x: hive().rightOffset, z: hive().forwardOffset };
    })();
    expect(a).toEqual(b);
    expect(a.moves).toBe(2);
    expect(layout.starters?.length).toBeGreaterThan(0);
  });

  it('never moves back into a felled tree, and stays on the grass when no tree is left', () => {
    syncNatureWorld(ANCHOR, T0);
    const layout = getGrowthLayout(ANCHOR)!;
    // Fell every tree there is, one second apart.
    let t = T0 + 1000;
    const fells = new Map<string, number>();
    for (const b of engineState.blocks.values()) if (b.kind === 'tree') fells.set(b.bodyId, t++);
    // Each move goes to a tree that is still standing at the time.
    const mid = resolveHive(layout, new Map([...fells].slice(0, 1)), [], t + TREE_CLEAR_MS)!;
    expect(fells.has(mid.treeId) && mid.treeId === [...fells.keys()][0]).toBe(false);
    const st = resolveHive(layout, fells, [], t + TREE_CLEAR_MS + 1)!;
    expect(st.treeId).toBe('');
  });

  it('a felled starter tree grows back from a seed at its spot', () => {
    syncNatureWorld(ANCHOR, T0);
    const tree = 'tree:tree-0';
    recordNatureEvent('fell', tree, ANCHOR, 0, 0, T0);
    syncNatureWorld(ANCHOR, T0 + TREE_CLEAR_MS + 1);
    expect(engineState.blocks.has(tree)).toBe(false);
    const regrowAt = T0 + STARTER_REGROW_MS;
    syncNatureWorld(ANCHOR, regrowAt + 1);
    const seedling = engineState.blocks.get(`tree:tree-0~${T0}`)!;
    expect(seedling).toBeDefined();
    const orig = getGrowthLayout(ANCHOR)!.starters!.find((s) => s.id === tree)!;
    expect([seedling.rightOffset, seedling.forwardOffset]).toEqual([orig.x, orig.z]);
    expect((seedling.meta.growth as { start: number }).start).toBe(regrowAt);
    expect(incarnationOf(getGrowthLayout(ANCHOR)!, seedling.bodyId, readNatureEvents(ANCHOR).fells)!.grownAt).toBe(regrowAt + TREE_GROW_MS);
  });
});

describe('nature events', () => {
  beforeEach(freshPeer);

  it('are kept once and ignore malformed input', () => {
    const e = hiveDownEvent(T0);
    expect(acceptPeerNatureEvent(e, T0)).toBe(true);
    expect(acceptPeerNatureEvent(e, T0)).toBe(false);
    expect(acceptPeerNatureEvent({ ...e, id: 'forged' }, T0)).toBe(false);
    expect(acceptPeerNatureEvent({ kind: 'fell' }, T0)).toBe(false);
    expect(mergeNatureEvents('nope', T0)).toBe(0);
    expect(listNatureEvents(ANCHOR)).toHaveLength(1);
  });

  it('pass newly learned events on to other peers, once', () => {
    const sent: string[] = [];
    attachNatureEventGossip((e) => sent.push(e.id));
    const a = hiveDownEvent(T0);
    const b = fellEvent('tree:tree-1', T0 + 1);
    acceptPeerNatureEvent(a, T0);
    acceptPeerNatureEvent(a, T0);
    mergeNatureEvents([a, b], T0 + 2);
    expect(sent).toEqual([a.id, b.id]);
  });

  it('keep old history so regrown trees and the hive replay the same way', () => {
    const old = fellEvent('tree:tree-1', T0 - 30 * 24 * 60 * 60_000);
    expect(acceptPeerNatureEvent(old, T0)).toBe(true);
    expect(acceptPeerNatureEvent(fellEvent('tree:tree-2', T0 + 60 * 60_000), T0)).toBe(false); // from the future
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
