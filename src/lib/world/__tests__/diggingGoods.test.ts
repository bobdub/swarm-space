/**
 * Digging and the beach: the earth a dig step cuts through comes up as a
 * good (Dirt from the topsoil, Clay from the mixed earth, Gold from the
 * Gold Vein with a Stone Pick only), and a shovel on beach sand gathers
 * Salt, which is what a Salt Rock costs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastFns = vi.hoisted(() => ({ message: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastFns }));
vi.mock('@/lib/brain/builderBlockEngine', () => ({
  getBuilderBlockEngine: () => ({ getBlock: () => undefined, removeBlock: vi.fn(), listBlocks: () => [], upgradeBlock: vi.fn() }),
}));
vi.mock('@/lib/brain/toolCatalog', () => ({ getToolAny: (id: string) => ({ id, mass: 1.5 }) }));
const impact = vi.hoisted(() => ({ cut: true, calls: 0 }));
vi.mock('@/lib/brain/sculpting', () => ({
  applyImpact: () => {
    impact.calls += 1;
    return { cut: impact.cut, effectiveCut: 1, reason: impact.cut ? undefined : 'resisted' };
  },
  emitCellCarved: vi.fn(),
}));
const surface = vi.hoisted(() => ({ cls: 'land' }));
vi.mock('@/lib/brain/surfaceClass', () => ({ sampleSurfaceClass: () => surface.cls }));
vi.mock('@/lib/brain/nature/natureCatalog', () => ({ getNatureSpec: () => undefined }));
vi.mock('@/lib/brain/earth', () => ({
  EARTH_RADIUS: 100,
  getEarthPose: () => ({ center: [0, 0, 0], spinQuat: [0, 0, 0, 1], invSpinQuat: [0, 0, 0, 1] }),
  quatRotate: (_q: unknown, v: number[]) => v,
  worldPosToLocalNormal: (p: number[]) => { const r = Math.hypot(p[0], p[1], p[2]) || 1; return [p[0] / r, p[1] / r, p[2] / r]; },
}));
vi.mock('@/lib/world/landPermissions', () => ({ canBuildAtWorldPoint: () => ({ ok: true }) }));
vi.mock('@/lib/brain/uqrcPhysics', () => ({
  getBrainPhysics: () => ({
    getBody: () => ({ pos: [0, 100, 0] }),
    getIntent: () => undefined,
    sampleSwingAt: () => ({ intensity: 0.1, curvatureLoad: 0 }),
  }),
}));
vi.mock('@/lib/world/swingFxBus', () => ({ emitImpactFx: vi.fn(), emitSwingFx: vi.fn() }));
const floor = vi.hoisted(() => ({ shellId: 'soil' }));
vi.mock('@/lib/world/carvedCellsStore', () => ({
  carveCell: () => ({ cellKey: 'c1', depth: 5, shellId: floor.shellId }),
  shellAtDepth: () => ({ id: floor.shellId, label: floor.shellId, n: 1, sharpnessThreshold: 0 }),
  DIG_STEP_M: 0.5,
}));
vi.mock('@/lib/world/weather', () => ({ weatherCurvatureBoost: () => 0 }));
vi.mock('@/lib/world/henHunting', () => ({ tryCatchNearbyHen: () => false, tryTakeNestEgg: () => false }));

import { applyToolToTarget, digYieldForShell, goldToolRefusal } from '@/lib/world/toolActions';
import { _resetHarvestedForTest, getHarvested, recordHarvestForResource } from '@/lib/remix/harvestedInventory';
import { checkAffordable, formatCost, gatheredGoodTotals, GATHERED_GOODS, prefabCost, spendMaterials } from '@/lib/world/materials';
import { setToolTarget } from '@/lib/world/toolTargetStore';
import { _resetSwingFeedbackForTest } from '@/lib/world/swingFeedback';
import { getTradingGood } from '@/lib/world/tradingStand/pricing';
import { heldGood } from '@/lib/world/tradingStand/goods';
import type { ToolTarget } from '@/lib/world/toolTargets';

const SHOVEL = 'tool_shovel_stone';
const PICK = 'tool_pick_stone';
const BUCKET = 'tool_bucket_wood';

const ground: ToolTarget = {
  kind: 'shell', id: 'shell:c1', label: 'ground', point: [0, 100, 0],
  localNormal: [0, 1, 0], cellKey: 'c1', depth: 0, shellId: 'soil',
};
const beach: ToolTarget = { kind: 'surface', id: 'surface:beach', label: 'Beach', surfaceKind: 'water', point: [0, 100, 0] };

beforeEach(() => {
  _resetHarvestedForTest();
  _resetSwingFeedbackForTest();
  setToolTarget(null);
  impact.cut = true;
  impact.calls = 0;
  surface.cls = 'land';
  floor.shellId = 'soil';
});

describe('dig yields by shell', () => {
  it.each([
    ['grass', 'dirt'], ['soil', 'dirt'], ['dirt', 'dirt'], ['mixed_earth', 'clay'],
    ['gold', 'gold'], ['gold_mirror', 'gold'], ['bedrock', null], ['coal', null],
  ] as const)('%s → %s', (shell, good) => {
    expect(digYieldForShell(shell)).toBe(good);
  });

  it('a shovel digging soil collects +1 Dirt', async () => {
    expect(await applyToolToTarget(SHOVEL, ground)).toBe(true);
    expect(getHarvested('good:dirt')).toBe(1);
    expect(gatheredGoodTotals().dirt).toBe(1);
  });

  it('digging the mixed earth collects Clay', async () => {
    floor.shellId = 'mixed_earth';
    await applyToolToTarget(SHOVEL, { ...ground, shellId: 'mixed_earth' });
    expect(getHarvested('good:clay')).toBe(1);
    expect(getHarvested('good:dirt')).toBe(0);
  });

  it('a resisted swing yields nothing', async () => {
    impact.cut = false;
    await applyToolToTarget(SHOVEL, ground);
    expect(getHarvested('good:dirt')).toBe(0);
  });

  it('the Gold Vein refuses a shovel before any swing and yields nothing', async () => {
    floor.shellId = 'gold';
    expect(goldToolRefusal(SHOVEL, 'gold', 'Stone Shovel')).toMatch(/Stone Pick/);
    expect(await applyToolToTarget(SHOVEL, { ...ground, shellId: 'gold' })).toBe(true);
    expect(impact.calls).toBe(0);
    expect(getHarvested('good:gold')).toBe(0);
  });

  it('a Stone Pick at the Gold Vein collects +1 Gold', async () => {
    floor.shellId = 'gold';
    expect(goldToolRefusal(PICK, 'gold', 'Stone Pick')).toBeNull();
    await applyToolToTarget(PICK, { ...ground, shellId: 'gold' });
    expect(getHarvested('good:gold')).toBe(1);
  });
});

describe('beach sand is salt', () => {
  it('a shovel on the shore gathers +1 Salt', async () => {
    surface.cls = 'shore';
    expect(await applyToolToTarget(SHOVEL, beach)).toBe(true);
    expect(getHarvested('good:salt')).toBe(1);
  });

  it('a bucket on the shore still collects water, not salt', async () => {
    surface.cls = 'shore';
    await applyToolToTarget(BUCKET, beach);
    expect(getHarvested('good:salt')).toBe(0);
  });

  it('a shovel in open ocean gathers no salt', async () => {
    surface.cls = 'ocean';
    await applyToolToTarget(SHOVEL, beach);
    expect(getHarvested('good:salt')).toBe(0);
  });

  it('the Salt Rock costs 1 Salt and spending it draws the salt', () => {
    const cost = prefabCost('consumable_salt_rock');
    expect(cost).toEqual({ salt: 1 });
    expect(formatCost(cost)).toBe('Salt 1');
    expect(checkAffordable(cost).ok).toBe(false);
    recordHarvestForResource('salt', 2);
    expect(checkAffordable(cost).ok).toBe(true);
    expect(spendMaterials(cost)).toBe(true);
    expect(getHarvested('good:salt')).toBe(1);
  });
});

describe('new goods reach the tally and the stand', () => {
  it.each(['dirt', 'clay', 'gold', 'salt'] as const)('%s is a gathered good with a stand price', (id) => {
    expect(GATHERED_GOODS.some((g) => g.id === id)).toBe(true);
    expect(getTradingGood(id)).toBeDefined();
    recordHarvestForResource(id, 3);
    expect(heldGood(id)).toBe(3);
  });
});
