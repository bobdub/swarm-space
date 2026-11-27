import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetPlayModeForTest } from '@/lib/world/playMode';

const coins = new Map<string, Record<string, unknown>>();
vi.mock('@/lib/store', () => ({
  getAll: async () => [...coins.values()],
  put: async (_s: string, v: { coinId: string }) => { coins.set(v.coinId, v as Record<string, unknown>); },
  get: async (_s: string, k: string) => coins.get(k),
}));

import {
  _resetHarvestedForTest,
  getHarvested,
  recordHarvestForResource,
  recordHarvestMany,
} from '@/lib/remix/harvestedInventory';
import {
  LAB_MATERIALS,
  compositionToMolecule,
  labMaterialStocks,
  refundLabMaterial,
  spendLabMaterial,
  unitsForStroke,
} from '@/lib/remix/labMaterials';
import {
  cancelCraft,
  depositMaterial,
  finalizeCraft,
  sealTierForMass,
} from '@/lib/remix/coinCraftingStore';
import { deriveForgedTool, forgedToolPrefab } from '@/lib/brain/toolForge';
import { prefabCostFor } from '@/lib/world/materials';
import { isWeightedCoin } from '@/lib/blockchain/weightedCoin';
import { sealedCoinHistory } from '@/lib/blockchain/sealedCoins';
import { MAIN_BRAIN_TARGET, labUrlFor, resolveDefaultLabTarget } from '@/lib/remix/labProjectBridge';
import { assetsForBrain } from '@/lib/remix/remixBrain';
import type { SwarmCoin } from '@/lib/blockchain/types';
import type { MintedRecord } from '@/lib/remix/mintedPrefabsStore';

function hollowCoin(id = 'coin-a'): SwarmCoin {
  const c = { coinId: id, ownerId: 'pool', status: 'pool', fill: 0, fillState: 'pool', weight: 0, maxWeight: 100, wrappedTokens: [] } as unknown as SwarmCoin;
  coins.set(id, c as unknown as Record<string, unknown>);
  return c;
}

beforeEach(() => {
  _resetHarvestedForTest();
  _resetPlayModeForTest({ online: true });
  coins.clear();
});

describe('Lab materials', () => {
  it('lists the seven gathered materials with their colours', () => {
    expect(LAB_MATERIALS.map((m) => [m.id, m.color])).toEqual([
      ['wood', '#8B5A2B'], ['stone', '#78716c'], ['fiber', '#d4a359'], ['water', '#38bdf8'],
      ['honey', '#f59e0b'], ['gem', '#ec4899'], ['gold', '#eab308'],
    ]);
  });

  it('reads live stock from the bag and spends from it', () => {
    recordHarvestForResource('wood', 5);
    recordHarvestForResource('fibre', 2);
    recordHarvestForResource('honey', 3);
    recordHarvestMany([{ symbol: 'good:gold', count: 2 }]);
    const s = labMaterialStocks();
    expect(s).toMatchObject({ wood: 5, fiber: 2, honey: 3, gold: 2, gem: 0 });

    expect(spendLabMaterial('wood', 2)).toBe(true);
    expect(spendLabMaterial('gold', 3)).toBe(false);
    expect(spendLabMaterial('gold', 2)).toBe(true);
    expect(labMaterialStocks()).toMatchObject({ wood: 3, gold: 0 });

    refundLabMaterial('gold', 1);
    refundLabMaterial('wood', 2);
    expect(labMaterialStocks()).toMatchObject({ wood: 5, gold: 1 });
  });

  it('charges one unit per ~100 px of stroke', () => {
    expect(unitsForStroke(0)).toBe(0);
    expect(unitsForStroke(30)).toBe(1);
    expect(unitsForStroke(260)).toBe(3);
  });

  it('turns a drawing into a molecule coloured by its main material', () => {
    const mol = compositionToMolecule({ stone: 3, wood: 1 }, 'Granite Axe', 1000)!;
    expect(mol.name).toBe('Granite Axe');
    expect(mol.color).toBe('#78716c');
    expect(mol.constituents.find((c) => c.symbol === 'Si')?.count).toBe(9);
    expect(compositionToMolecule({})).toBeNull();
  });
});

describe('Tool purpose', () => {
  it('stamps the chosen action into the forged tool and its prefab', () => {
    const mol = compositionToMolecule({ stone: 2, wood: 2 }, 'Flint', 1)!;
    for (const [action, noun] of [['chop', 'Axe'], ['mine', 'Pickaxe'], ['dig', 'Shovel'], ['gather', 'Sickle']] as const) {
      const tool = deriveForgedTool(mol, { actionKind: action });
      expect(tool.actionKind).toBe(action);
      expect(tool.label).toBe(`Flint ${noun}`);
      expect(tool.id).toBe(`forge:${mol.id}:${action}`);
      const prefab = forgedToolPrefab(tool);
      expect(prefab.sectionId).toBe('tools');
      // Paid for at the bench, so free to equip.
      expect(prefabCostFor(prefab)).toEqual({});
    }
  });
});

describe('Forge sealing', () => {
  it('deposits gathered materials and refuses past the cap', () => {
    const coin = hollowCoin();
    recordHarvestForResource('stone', 20);
    const res = depositMaterial(coin, 'stone', 10); // 60 / 100
    expect(res.ok).toBe(true);
    expect(labMaterialStocks().stone).toBe(10);
    // 5 more stone = 90 > 85 cap: refused, nothing spent.
    expect(depositMaterial(coin, 'stone', 5)).toEqual({ ok: false, reason: 'at-cap' });
    expect(labMaterialStocks().stone).toBe(10);
  });

  it('cancel returns the materials', async () => {
    const coin = hollowCoin();
    recordHarvestMany([{ symbol: 'good:gem', count: 3 }]);
    depositMaterial(coin, 'gem', 2);
    expect(getHarvested('good:gem')).toBe(1);
    await cancelCraft(coin.coinId);
    expect(getHarvested('good:gem')).toBe(3);
  });

  it('engraves the seal so the coin counts as a sealed coin in the wallet', async () => {
    const coin = hollowCoin();
    recordHarvestForResource('stone', 12);
    depositMaterial(coin, 'stone', 12); // mass 72 → legendary
    const sealed = await finalizeCraft(coin.coinId, 'user-1');
    expect(sealed.ownerId).toBe('user-1');
    expect(sealed.status).toBe('wallet');
    expect(sealed.fillState).toBe('sealed');
    expect(sealed.fill).toBeCloseTo(0.72);
    expect(sealed.creatorProof?.tier).toBe('legendary');
    expect(isWeightedCoin(sealed)).toBe(true);
    const history = sealedCoinHistory([sealed], 'user-1');
    expect(history).toHaveLength(1);
    expect(history[0].tier).toBe('legendary');
  });

  it('sets the tier from deposited mass', () => {
    expect(sealTierForMass(10)).toBe('basic');
    expect(sealTierForMass(45)).toBe('rare');
    expect(sealTierForMass(61)).toBe('legendary');
  });
});

describe('Main Brain target and remix scope', () => {
  it('defaults to the project the Lab was opened from, else the Main Brain', () => {
    expect(resolveDefaultLabTarget({ projectId: 'p1' })).toBe('p1');
    expect(resolveDefaultLabTarget({ target: MAIN_BRAIN_TARGET })).toBe(MAIN_BRAIN_TARGET);
    expect(resolveDefaultLabTarget({})).toBe(MAIN_BRAIN_TARGET);
    expect(labUrlFor('p1')).toBe('/remix?projectId=p1');
    expect(labUrlFor(null)).toBe(`/remix?target=${MAIN_BRAIN_TARGET}`);
  });

  it('a Brain\'s assets are its tagged mints; the Main Brain owns the untagged ones', () => {
    const recs = [
      { id: 'a', projectId: 'p1' },
      { id: 'b' },
      { id: 'c', projectId: 'p2' },
    ] as unknown as MintedRecord[];
    expect(assetsForBrain(recs, 'p1').map((r) => r.id)).toEqual(['a']);
    expect(assetsForBrain(recs, null).map((r) => r.id)).toEqual(['b']);
  });
});
