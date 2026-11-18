import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks: keep the shared gather path real, stub only the I/O edges ──
const toasts = vi.hoisted(() => ({ calls: [] as { kind: string; title: string; description?: string }[] }));
vi.mock('sonner', () => {
  const push = (kind: string) => (title: string, opts?: { description?: string }) => {
    toasts.calls.push({ kind, title, description: opts?.description });
  };
  return { toast: { message: push('message'), success: push('success'), error: push('error') } };
});

const engineState = vi.hoisted(() => ({ blocks: new Map<string, { id: string; bodyId: string; kind: string; meta: Record<string, unknown> }>() }));
vi.mock('@/lib/brain/builderBlockEngine', () => ({
  getBuilderBlockEngine: () => ({
    getBlock: (id: string) => engineState.blocks.get(id),
    removeBlock: (id: string) => { engineState.blocks.delete(id); },
    upgradeBlock: () => {},
    listBlocks: (f?: (b: unknown) => boolean) => [...engineState.blocks.values()].filter((b) => (f ? f(b) : true)),
    placeBlock: (spec: { id: string; kind: string; meta?: Record<string, unknown> }) => {
      const b = { id: spec.id, bodyId: `${spec.kind}:${spec.id}`, kind: spec.kind, meta: spec.meta ?? {} };
      engineState.blocks.set(b.bodyId, b);
      return b;
    },
  }),
}));

vi.mock('@/lib/brain/uqrcPhysics', () => ({
  getBrainPhysics: () => ({
    getBody: () => ({ pos: [0, 100, 0] }),
    getIntent: () => null,
    sampleSwingAt: () => ({ intensity: 0.1, curvatureLoad: 0 }),
  }),
}));

vi.mock('@/lib/world/landPermissions', () => ({ canBuildAtWorldPoint: () => ({ ok: true }) }));

// Force every accepted swing to bite, so the test is about routing, not tuning.
const impact = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/lib/brain/sculpting', () => ({
  applyImpact: () => { impact.calls++; return { cut: true, resistance: 1, effectiveCut: 1.5, newSharpness: null }; },
  emitCellCarved: () => {},
}));

import { applyToolToTarget, rockToolRefusal, stoneYieldFor, resolveNearbyTarget } from '@/lib/world/toolActions';
import { HITS_TO_BREAK, BREAK_MS, _resetStoneMineForTest } from '@/lib/world/stoneMineStore';
import { listDrops, _resetDropsForTest } from '@/lib/world/worldDropsStore';
import { NATURE_CATALOG, STONE_CONSTITUENTS } from '@/lib/brain/nature/natureCatalog';
import { seedDefaultBiome, STONE_COUNT } from '@/lib/brain/nature/natureSeed';
import { recordHarvestForResource } from '@/lib/remix/harvestedInventory';
import { materialTotals } from '@/lib/world/materials';
import { boulderRadius, buildBoulderGeometry } from '@/lib/brain/nature/boulderGeometry';
import type { ToolTarget } from '@/lib/world/toolTargets';

function placeStone(id = 'stone-t', size = 0.8): ToolTarget {
  const bodyId = `stone:${id}`;
  engineState.blocks.set(bodyId, { id, bodyId, kind: 'stone', meta: { size, shapeSeed: 42 } });
  return { kind: 'nature', id: bodyId, label: 'Stone', natureKind: 'stone', blockId: bodyId };
}

describe('stone material', () => {
  it('is granite with a real chemical composition', () => {
    const spec = NATURE_CATALOG.stone;
    expect(spec.label).toBe('Stone');
    const formula = Object.fromEntries(spec.constituents.map((c) => [c.symbol, c.count]));
    // SiO2 + KAlSi3O8 = Si4 Al K O10
    expect(formula).toEqual({ Si: 4, Al: 1, K: 1, O: 10 });
    expect(spec.color).toMatch(/^#|^rgb|^hsl/);
  });

  it('every element of the formula is a mineral that folds into Stone', () => {
    const minerals = STONE_CONSTITUENTS.filter((c) => c.symbol !== 'O');
    expect(minerals.length).toBeGreaterThan(0);
    expect(minerals.every((c) => ['Si', 'Al', 'K'].includes(c.symbol))).toBe(true);
  });

  it('one picked-up stone adds exactly +1 Stone to the Gathered tally', () => {
    const before = materialTotals().stone;
    recordHarvestForResource('stone', 1);
    expect(materialTotals().stone).toBe(before + 1);
  });
});

describe('procedural boulders', () => {
  it('seeds gatherable stone into the starter biome with a shape seed', () => {
    engineState.blocks.clear();
    seedDefaultBiome('anchor-test');
    const stones = [...engineState.blocks.values()].filter((b) => b.kind === 'stone');
    expect(stones).toHaveLength(STONE_COUNT);
    for (const s of stones) {
      expect(typeof s.meta.size).toBe('number');
      expect(Number.isInteger(s.meta.shapeSeed)).toBe(true);
    }
  });

  it('builds a deterministic, lumpy mesh from the seed (no imported model)', () => {
    const a = buildBoulderGeometry(7).getAttribute('position').array;
    const b = buildBoulderGeometry(7).getAttribute('position').array;
    const c = buildBoulderGeometry(8).getAttribute('position').array;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    const radii = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0]].map((d) => boulderRadius(d as [number, number, number], 7));
    expect(new Set(radii.map((r) => r.toFixed(3))).size).toBeGreaterThan(1);
  });
});

describe('gathering stone', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    engineState.blocks.clear();
    toasts.calls = [];
    impact.calls = 0;
    _resetDropsForTest();
    _resetStoneMineForTest();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('only the Stone Pick may strike stone', () => {
    expect(rockToolRefusal('tool_pick_stone', 'stone', 'Stone Pick')).toBeNull();
    expect(rockToolRefusal('tool_axe_stone', 'stone', 'Stone Axe')).toMatch(/Stone Pick/);
    expect(rockToolRefusal('tool_knife_stone', 'stone', 'Stone Knife')).not.toBeNull();
    expect(rockToolRefusal('tool_shovel_stone', 'stone', 'Stone Shovel')).not.toBeNull();
    // Trees are unaffected.
    expect(rockToolRefusal('tool_axe_stone', 'tree', 'Stone Axe')).toBeNull();
  });

  it('the Stone Axe bounces off and the boulder is untouched', async () => {
    const target = placeStone();
    for (let i = 0; i < HITS_TO_BREAK + 2; i++) {
      expect(await applyToolToTarget('tool_axe_stone', target, 'peer-a')).toBe(false);
    }
    expect(impact.calls).toBe(0);
    expect(engineState.blocks.has(target.kind === 'nature' ? target.blockId : '')).toBe(true);
    expect(listDrops()).toHaveLength(0);
    expect(toasts.calls.at(-1)?.description).toMatch(/can't break stone/);
  });

  it('the Stone Pick breaks the boulder into stone drops', async () => {
    const target = placeStone('stone-p', 0.8);
    const blockId = target.kind === 'nature' ? target.blockId : '';
    for (let i = 0; i < HITS_TO_BREAK - 1; i++) {
      expect(await applyToolToTarget('tool_pick_stone', target, 'peer-a')).toBe(true);
      expect(listDrops()).toHaveLength(0);
    }
    expect(await applyToolToTarget('tool_pick_stone', target, 'peer-a')).toBe(true);
    const drops = listDrops();
    expect(drops.length).toBe(stoneYieldFor(0.8));
    expect(drops.every((d) => d.kind === 'stone')).toBe(true);
    expect(engineState.blocks.has(blockId)).toBe(true);
    vi.advanceTimersByTime(BREAK_MS + 10);
    expect(engineState.blocks.has(blockId)).toBe(false);
  });

  it('swings on a boulder that is already breaking do not pay out again', async () => {
    const target = placeStone('stone-twice', 0.8);
    for (let i = 0; i < HITS_TO_BREAK; i++) await applyToolToTarget('tool_pick_stone', target, 'peer-a');
    const n = listDrops().length;
    expect(await applyToolToTarget('tool_pick_stone', target, 'peer-a')).toBe(false);
    expect(listDrops()).toHaveLength(n);
  });

  it('walking up with a pick auto-targets a nearby boulder; an axe does not', () => {
    placeStone('stone-near');
    expect(resolveNearbyTarget('tool_pick_stone', 'peer-a')).toMatchObject({ natureKind: 'stone' });
    expect(resolveNearbyTarget('tool_axe_stone', 'peer-a')).toBeNull();
  });

  it('yields 2–4 stones depending on boulder size', () => {
    expect(stoneYieldFor(0.55)).toBeGreaterThanOrEqual(2);
    expect(stoneYieldFor(1.05)).toBeLessThanOrEqual(4);
    expect(stoneYieldFor(undefined)).toBeGreaterThanOrEqual(2);
  });
});
