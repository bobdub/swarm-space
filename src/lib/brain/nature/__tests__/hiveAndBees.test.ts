import { describe, it, expect, vi, beforeEach } from 'vitest';

const engineState = vi.hoisted(() => ({
  blocks: new Map<string, { id: string; kind: string; rightOffset: number; forwardOffset: number; meta: Record<string, unknown> }>(),
}));
vi.mock('@/lib/brain/builderBlockEngine', () => ({
  getBuilderBlockEngine: () => ({
    placeBlock: (spec: { id: string; kind: string; rightOffset: number; forwardOffset: number; meta?: Record<string, unknown> }) => {
      const b = { ...spec, meta: spec.meta ?? {} };
      engineState.blocks.set(`${spec.kind}:${spec.id}`, b);
      return b;
    },
  }),
}));

import { seedDefaultBiome, HIVE_REACH, WORKER_BEES } from '@/lib/brain/nature/natureSeed';
import {
  beePoseAt,
  nearestFlowers,
  BEE_OUT_S,
  BEE_HOVER_S,
  BEE_TRIP_S,
  type V3,
} from '@/lib/brain/nature/beeFlight';

describe('honey hive placement', () => {
  beforeEach(() => engineState.blocks.clear());

  it('hangs the hive off a tree branch instead of the open meadow', () => {
    seedDefaultBiome('swarm-shared-village');
    const hive = engineState.blocks.get('hive:hive-0')!;
    const treeId = hive.meta.treeId as string;
    const tree = engineState.blocks.get(treeId)!;
    expect(tree?.kind).toBe('tree');
    // Trunk offset recorded in the hive's frame matches the real tree.
    expect(hive.rightOffset + (hive.meta.trunkRight as number)).toBeCloseTo(tree.rightOffset, 6);
    expect(hive.forwardOffset + (hive.meta.trunkForward as number)).toBeCloseTo(tree.forwardOffset, 6);
    // One branch-length out from the trunk.
    const reach = Math.hypot(hive.meta.trunkRight as number, hive.meta.trunkForward as number);
    expect(reach).toBeCloseTo(HIVE_REACH, 6);
  });

  it('gives the hive its full crew of workers', () => {
    seedDefaultBiome('swarm-shared-village');
    const workers = [...engineState.blocks.values()].filter((b) => b.kind === 'bee' && b.meta.hiveId === 'hive-0');
    expect(workers).toHaveLength(WORKER_BEES);
  });
});

describe('bee flight', () => {
  const door: V3 = [0.4, 1.8, 0];
  const flowers: V3[] = [[6, 0.45, 3], [-4, 0.5, 7], [9, 0.4, -2]];
  const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  it('leaves from the hive door and reaches a flower to pollinate', () => {
    const start = beePoseAt(0, 1, 0, door, flowers);
    expect(start.phase).toBe('out');
    expect(dist(start.pos, door)).toBeLessThan(1e-6);
    const hover = beePoseAt(0, 1, BEE_OUT_S + BEE_HOVER_S / 2, door, flowers);
    expect(hover.phase).toBe('hover');
    expect(dist(hover.pos, flowers[hover.flower])).toBeLessThan(0.5);
  });

  it('flies above the ground mid-trip and comes home', () => {
    const mid = beePoseAt(0, 1, BEE_OUT_S / 2, door, flowers);
    const f = flowers[mid.flower];
    expect(mid.pos[1]).toBeGreaterThan(Math.min(door[1], f[1]));
    const home = beePoseAt(0, 1, BEE_TRIP_S - 0.2, door, flowers);
    expect(home.phase).toBe('rest');
    expect(dist(home.pos, door)).toBeLessThan(0.05);
  });

  it('moves smoothly (no teleports between frames)', () => {
    for (let i = 0; i < 4; i++) {
      for (let t = 0; t < BEE_TRIP_S * 3; t += 1 / 60) {
        const a = beePoseAt(i, 4, t, door, flowers).pos;
        const b = beePoseAt(i, 4, t + 1 / 60, door, flowers).pos;
        expect(dist(a, b)).toBeLessThan(0.15);
      }
    }
  });

  it('forages the closest flowers', () => {
    const near = nearestFlowers(door, flowers, 2);
    expect(near).toEqual([flowers[0], flowers[1]]);
  });
});
