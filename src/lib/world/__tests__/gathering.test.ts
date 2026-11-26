/**
 * Gathering: every successful gather moves the tool menu's Gathered tally
 * by exactly one unit of the right material, and repeated resisted
 * strikes collapse into one updating toast instead of a stack of them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastFns = vi.hoisted(() => ({
  message: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: toastFns }));

const blocks = vi.hoisted(() => new Map<string, { bodyId: string; kind: string; meta: Record<string, unknown> }>());
vi.mock('@/lib/brain/builderBlockEngine', () => ({
  getBuilderBlockEngine: () => ({
    getBlock: (id: string) => blocks.get(id),
    removeBlock: (id: string) => { blocks.delete(id); },
    listBlocks: (pred: (b: unknown) => boolean) => [...blocks.values()].filter(pred),
    upgradeBlock: vi.fn(),
  }),
}));

vi.mock('@/lib/brain/prefabHouseCatalog', () => ({
  getPrefab: (id: string) => ({ id, label: id, color: '#888', mass: 1.5 }),
}));
vi.mock('@/lib/brain/toolCatalog', () => ({
  getToolAny: (id: string) => ({ id, mass: 1.5 }),
}));

const impact = vi.hoisted(() => ({ cut: true }));
vi.mock('@/lib/brain/sculpting', () => ({
  applyImpact: () => ({ cut: impact.cut, effectiveCut: impact.cut ? 0.9 : 0.2, reason: impact.cut ? undefined : 'resisted' }),
  emitCellCarved: vi.fn(),
}));
vi.mock('@/lib/brain/surfaceClass', () => ({ sampleSurfaceClass: () => 'ocean' }));
vi.mock('@/lib/brain/nature/natureCatalog', () => ({ getNatureSpec: () => undefined }));
vi.mock('@/lib/brain/earth', () => ({
  EARTH_RADIUS: 100,
  getEarthPose: () => ({ center: [0, 0, 0], spinQuat: [0, 0, 0, 1], invSpinQuat: [0, 0, 0, 1] }),
  quatRotate: (_q: unknown, v: number[]) => v,
}));
const land = vi.hoisted(() => ({ ok: true }));
vi.mock('@/lib/world/landPermissions', () => ({
  canBuildAtWorldPoint: () => (land.ok ? { ok: true } : { ok: false, reason: 'Not your land.' }),
}));
vi.mock('@/lib/brain/uqrcPhysics', () => ({
  getBrainPhysics: () => ({
    getBody: () => ({ pos: [0, 100, 0] }),
    getIntent: () => undefined,
    sampleSwingAt: () => ({ intensity: 0.1, curvatureLoad: 0 }),
  }),
}));
vi.mock('@/lib/world/swingFxBus', () => ({ emitImpactFx: vi.fn(), emitSwingFx: vi.fn() }));
vi.mock('@/lib/world/carvedCellsStore', () => ({ carveCell: vi.fn(), shellAtDepth: vi.fn(), DIG_STEP_M: 0.5 }));
vi.mock('@/lib/world/weather', () => ({ weatherCurvatureBoost: () => 0 }));
// No hens in this stubbed world (hen hunting has its own tests).
vi.mock('@/lib/world/henHunting', () => ({ tryCatchNearbyHen: () => false, tryTakeNestEgg: () => false }));

import { applyToolToTarget, WOOD_PER_TREE, FIBRE_PER_TREE } from '@/lib/world/toolActions';
import { _resetHarvestedForTest, getHarvested, recordHarvestForResource } from '@/lib/remix/harvestedInventory';
import { materialTotals } from '@/lib/world/materials';
import { _resetDropsForTest, collectDrop, listDrops, spawnDrop } from '@/lib/world/worldDropsStore';
import { _resetTreeChopForTest, HITS_TO_FELL, registerTreeHit, TOPPLE_MS, STUMP_FADE_MS } from '@/lib/world/treeChopStore';
import { _resetSwingFeedbackForTest, swingResisted, swingSuccess, swingToastId, RESIST_STREAK_GAP_MS } from '@/lib/world/swingFeedback';
import { getToolTarget, setToolTarget } from '@/lib/world/toolTargetStore';
import type { ToolTarget } from '@/lib/world/toolTargets';
import { _resetHoneyForTest, HONEY_PER_DAY } from '@/lib/world/honeyStore';
import { listNatureEvents, _resetNatureEventsForTest } from '@/lib/world/natureEventsStore';
import { _resetNatureGrowthForTest, fruitAt, FRUIT_PER_TREE, TREE_GROW_MS, TREE_LIFE_MS } from '@/lib/brain/nature/natureGrowth';

const AXE = 'tool_axe_stone';
const BUCKET = 'tool_bucket_wood';

function nature(id: string, kind: string): ToolTarget {
  blocks.set(id, { bodyId: id, kind, meta: {} });
  return { kind: 'nature', id, label: kind, natureKind: kind, blockId: id };
}

function collectAllDrops(): void {
  for (const d of listDrops()) collectDrop(d.id);
}

beforeEach(() => {
  vi.useFakeTimers();
  blocks.clear();
  impact.cut = true;
  toastFns.message.mockClear();
  toastFns.success.mockClear();
  _resetHarvestedForTest();
  _resetDropsForTest();
  _resetTreeChopForTest();
  _resetSwingFeedbackForTest();
  _resetHoneyForTest();
  _resetNatureGrowthForTest();
  _resetNatureEventsForTest();
  land.ok = true;
  setToolTarget(null);
});

describe('Gathered tally', () => {
  it.each([
    ['wood', 'wood'],
    ['stone', 'stone'],
    ['water', 'water'],
    ['fibre', 'fibre'],
    ['food', 'food'],
    ['animal', 'food'],
  ] as const)('one %s credits exactly +1 %s and nothing else', (kind, material) => {
    recordHarvestForResource(kind, 1);
    const totals = materialTotals();
    expect(totals[material]).toBe(1);
    for (const [m, n] of Object.entries(totals)) if (m !== material) expect(n).toBe(0);
  });

  it('a drop is banked exactly once', () => {
    const d = spawnDrop({ kind: 'wood', qty: 1, localDir: [0, 1, 0], upOffset: 0 });
    expect(collectDrop(d.id)).toBe(true);
    expect(collectDrop(d.id)).toBe(false);
    expect(materialTotals().wood).toBe(1);
  });

  it('a falling tree takes no more hits', () => {
    for (let i = 0; i < HITS_TO_FELL; i++) registerTreeHit('t');
    expect(registerTreeHit('t').hits).toBe(HITS_TO_FELL);
  });
});

describe('chopping a tree', () => {
  it('fells after enough cuts and yields exactly WOOD_PER_TREE wood and FIBRE_PER_TREE fibre, even if you keep swinging', async () => {
    const target = nature('tree-1', 'tree');
    for (let i = 0; i < HITS_TO_FELL; i++) await applyToolToTarget(AXE, target);
    // Keep swinging while the trunk is falling — must not fell it again.
    for (let i = 0; i < 5; i++) expect(await applyToolToTarget(AXE, target)).toBe(false);
    vi.advanceTimersByTime(TOPPLE_MS + 1);
    expect(listDrops().filter((d) => d.kind === 'wood')).toHaveLength(WOOD_PER_TREE);
    expect(listDrops().filter((d) => d.kind === 'fibre')).toHaveLength(FIBRE_PER_TREE);
    collectAllDrops();
    vi.advanceTimersByTime(STUMP_FADE_MS + 1);
    expect(materialTotals()).toEqual({ wood: WOOD_PER_TREE, stone: 0, water: 0, fibre: FIBRE_PER_TREE, food: 0 });
  });

  it('resisted strikes reuse one toast and count the streak', async () => {
    impact.cut = false;
    const target = nature('tree-2', 'tree');
    for (let i = 0; i < 6; i++) await applyToolToTarget(AXE, target);
    const ids = new Set(toastFns.message.mock.calls.map((c) => c[1]?.id));
    expect(ids).toEqual(new Set([swingToastId(AXE)]));
    expect(toastFns.message.mock.calls.at(-1)?.[1]?.description).toContain('resisted ×6');
    expect(materialTotals().wood).toBe(0);
  });
});

describe('collecting water and food', () => {
  it('bucket on open water adds exactly 1 Water per scoop', async () => {
    const surface: ToolTarget = {
      kind: 'surface', id: 's', label: 'Water', surfaceKind: 'water', point: [0, 100, 0],
    } as ToolTarget;
    await applyToolToTarget(BUCKET, surface);
    await applyToolToTarget(BUCKET, surface);
    expect(materialTotals().water).toBe(2);
    expect(materialTotals().fibre).toBe(0);
  });

  it('water block → +1 Water, fish → +1 Food, grass → +1 Fibre', async () => {
    await applyToolToTarget(BUCKET, nature('w', 'water'));
    await applyToolToTarget(BUCKET, nature('f', 'fish'));
    await applyToolToTarget(BUCKET, nature('g', 'grass'));
    expect(materialTotals()).toEqual({ wood: 0, stone: 0, water: 1, fibre: 1, food: 1 });
  });

  it('a stale target that was already collected does not pay out again', async () => {
    const fish = nature('f2', 'fish');
    setToolTarget(fish);
    expect(await applyToolToTarget(BUCKET, fish)).toBe(true);
    expect(getToolTarget()).toBeNull();
    expect(await applyToolToTarget(BUCKET, fish)).toBe(false);
    expect(materialTotals().food).toBe(1);
  });
});

describe('honey, fruit and young trees', () => {
  it('a bucket takes honey from the hive once a day', async () => {
    vi.setSystemTime(new Date(2026, 10, 20, 9, 0));
    const hive = nature('hive-0', 'hive');
    expect(await applyToolToTarget(BUCKET, hive)).toBe(true);
    expect(await applyToolToTarget(BUCKET, hive)).toBe(false);
    // Honey is its own good (traded at the Trading Stand), not Food.
    expect(getHarvested('good:honey')).toBe(HONEY_PER_DAY);
    expect(materialTotals().food).toBe(0);
    expect(blocks.has('hive-0')).toBe(true); // the hive stays
    vi.setSystemTime(new Date(2026, 10, 21, 9, 0));
    expect(await applyToolToTarget(BUCKET, hive)).toBe(true);
    expect(getHarvested('good:honey')).toBe(HONEY_PER_DAY * 2);
  });

  it('no honey while the bees are still building', async () => {
    const now = new Date(2026, 10, 20, 9, 0).getTime();
    vi.setSystemTime(now);
    blocks.set('hive-1', { bodyId: 'hive-1', kind: 'hive', meta: { builtAt: now - 1000 } });
    const t: ToolTarget = { kind: 'nature', id: 'hive-1', label: 'hive', natureKind: 'hive', blockId: 'hive-1' };
    expect(await applyToolToTarget(BUCKET, t)).toBe(false);
    expect(materialTotals().food).toBe(0);
  });

  it('a bucket picks ripe fruit from a grown tree, leaving the tree standing', async () => {
    let now = new Date(2026, 10, 20, 9, 0).getTime();
    while (!fruitAt('apple', now).ripe) now += 60_000;
    vi.setSystemTime(now);
    const tree = nature('apple', 'tree');
    expect(await applyToolToTarget(BUCKET, tree)).toBe(true);
    expect(await applyToolToTarget(BUCKET, tree)).toBe(false);
    expect(materialTotals().food).toBe(FRUIT_PER_TREE);
    expect(blocks.has('apple')).toBe(true);
  });

  it('felling a tree is shared with other peers', async () => {
    const target = nature('tree-9', 'tree');
    for (let i = 0; i < HITS_TO_FELL; i++) await applyToolToTarget(AXE, target);
    expect(listNatureEvents().map((e) => [e.kind, e.blockId])).toEqual([['fell', 'tree-9']]);
    vi.advanceTimersByTime(TOPPLE_MS + STUMP_FADE_MS + 1); // let its wood land
  });

  it('an axe breaks the hive itself, shared with other peers, and pays nothing', async () => {
    const hive = nature('hive-0', 'hive');
    expect(await applyToolToTarget(AXE, hive)).toBe(true);
    expect(listNatureEvents().map((e) => [e.kind, e.blockId])).toEqual([['hive-down', 'hive-0']]);
    expect(materialTotals().food).toBe(0);
  });

  it('cannot break a hive on land you may not alter', async () => {
    land.ok = false;
    const hive = nature('hive-0', 'hive');
    expect(await applyToolToTarget(AXE, hive, 'me')).toBe(false);
    expect(listNatureEvents()).toHaveLength(0);
  });

  it('a seedling cannot be chopped', async () => {
    const now = new Date(2026, 10, 20, 9, 0).getTime();
    vi.setSystemTime(now);
    blocks.set('sapling', { bodyId: 'sapling', kind: 'tree', meta: { growth: { start: now - 1000, life: TREE_LIFE_MS, grow: TREE_GROW_MS } } });
    const t: ToolTarget = { kind: 'nature', id: 'sapling', label: 'tree', natureKind: 'tree', blockId: 'sapling' };
    for (let i = 0; i < HITS_TO_FELL + 1; i++) expect(await applyToolToTarget(AXE, t)).toBe(false);
    vi.advanceTimersByTime(TOPPLE_MS + 1);
    expect(listDrops()).toHaveLength(0);
  });
});

describe('swingFeedback', () => {
  it('starts a fresh streak after a success or a long pause', () => {
    expect(swingResisted(AXE, 'Axe', 'The trunk', undefined, 0)).toBe(1);
    expect(swingResisted(AXE, 'Axe', 'The trunk', undefined, 500)).toBe(2);
    swingSuccess(AXE, 'Axe', 'ok');
    expect(swingResisted(AXE, 'Axe', 'The trunk', undefined, 600)).toBe(1);
    expect(swingResisted(AXE, 'Axe', 'The trunk', undefined, 600 + RESIST_STREAK_GAP_MS + 1)).toBe(1);
  });
});
