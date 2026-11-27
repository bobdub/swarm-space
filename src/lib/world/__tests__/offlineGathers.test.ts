import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/featureFlags', () => ({ getFeatureFlags: () => ({ scaffoldBus: true }) }));
vi.mock('@/lib/uqrc/fieldEngine', () => ({ getSharedFieldEngine: () => ({ inject: () => {} }) }));
const store = new Map<string, unknown>();
vi.mock('@/lib/store', () => ({
  get: async (_s: string, k: string) => store.get(k),
  put: async (_s: string, v: { k: string }) => { store.set(v.k, v); },
}));

const auth = { id: 'creator' as string | null };
vi.mock('@/lib/auth', () => ({ getCurrentUser: () => (auth.id ? { id: auth.id } : null) }));
const projects = new Map<string, { id: string; owner: string; members: string[] }>();
vi.mock('@/lib/projects', () => ({ getProject: async (id: string) => projects.get(id) ?? null }));
const transfers: { from: string; to: string; amount: number; meta?: Record<string, unknown> }[] = [];
const balances = new Map<string, number>();
vi.mock('@/lib/blockchain/token', () => ({
  transferSwarm: async (p: { from: string; to: string; amount: number; meta?: Record<string, unknown> }) => {
    if ((balances.get(p.from) ?? 0) < p.amount) throw new Error('Insufficient SWARM balance');
    balances.set(p.from, (balances.get(p.from) ?? 0) - p.amount);
    transfers.push(p);
    return p;
  },
}));
vi.mock('@/lib/blockchain/poolLedger', () => ({ COMMUNITY_POOL: 'community-pool' }));

import { subscribeScaffold, __resetScaffoldBusForTests } from '@/lib/uqrc/scaffoldBus';
import type { CoinFillEvent } from '@/lib/uqrc/scaffoldPorts';
import {
  _resetHarvestedForTest,
  getHarvested,
  listOfflineHarvested,
  listSeededHarvested,
  recordHarvestForResource,
  spendHarvested,
} from '@/lib/remix/harvestedInventory';
import { _resetHarvestJournalForTest } from '@/lib/remix/harvestJournal';
import { _resetLabReservationsForTest, refundLabMaterial, spendLabMaterial } from '@/lib/remix/labMaterials';
import { _resetPlayModeForTest, setActiveBrainProject, setMeshOnline } from '../playMode';
import { recordPlayerHarvest } from '../playerHarvest';
import { materialTotals, spendMaterials } from '../materials';
import { giveGood, heldGood, shortGoodMessage, takeGood } from '../tradingStand/goods';
import {
  PROJECT_SEED_FEE_SWARM,
  seedProjectWithOfflineGathers,
  seedRefusal,
} from '../offlineProjectSeed';

beforeEach(() => {
  localStorage.clear();
  store.clear();
  projects.clear();
  transfers.length = 0;
  balances.clear();
  auth.id = 'creator';
  __resetScaffoldBusForTests();
  _resetHarvestJournalForTest();
  _resetHarvestedForTest();
  _resetLabReservationsForTest();
  _resetPlayModeForTest({ online: false });
});

describe('offline gathers stay in local play', () => {
  it('keeps an offline gather for offline play and locks it away online', () => {
    recordPlayerHarvest('honey', 3, 'me');
    expect(getHarvested('good:honey')).toBe(3);
    expect(getHarvested('good:honey', { onlineOnly: true })).toBe(0);

    setMeshOnline(true);
    expect(getHarvested('good:honey')).toBe(0);
    recordPlayerHarvest('honey', 2, 'me');
    expect(getHarvested('good:honey')).toBe(2);

    setMeshOnline(false);
    expect(getHarvested('good:honey')).toBe(5);
  });

  it('earns no labour for an offline gather, but does online', () => {
    const fills: CoinFillEvent[] = [];
    subscribeScaffold<CoinFillEvent>('coin', (e) => { fills.push(e); });
    recordPlayerHarvest('wood', 2, 'me');
    expect(fills).toHaveLength(0);
    setMeshOnline(true);
    recordPlayerHarvest('wood', 2, 'me');
    expect(fills).toHaveLength(1);
  });

  it('spends offline goods first in offline play, and only online goods online', () => {
    setMeshOnline(true);
    recordHarvestForResource('wood', 2);
    setMeshOnline(false);
    recordHarvestForResource('wood', 3);
    expect(materialTotals().wood).toBe(5);
    expect(spendMaterials({ wood: 3 })).toBe(true);
    // The three offline pieces went first; the two online ones are untouched.
    expect(materialTotals({ onlineOnly: true }).wood).toBe(2);
    expect(listOfflineHarvested()).toEqual([]);

    recordHarvestForResource('wood', 4);
    setMeshOnline(true);
    expect(spendMaterials({ wood: 3 })).toBe(false);
    expect(spendMaterials({ wood: 2 })).toBe(true);
    setMeshOnline(false);
    expect(materialTotals().wood).toBe(4);
  });

  it('gives a Lab drawing back to the bags it came from, even after reconnecting', () => {
    setMeshOnline(true);
    recordHarvestForResource('wood', 1);
    setMeshOnline(false);
    recordHarvestForResource('wood', 2);
    // Drawn while offline: two offline pieces first, then the online one.
    expect(spendLabMaterial('wood', 3)).toBe(true);
    setMeshOnline(true);
    refundLabMaterial('wood', 3);
    expect(materialTotals().wood).toBe(1);
    setMeshOnline(false);
    expect(materialTotals().wood).toBe(3);
    // Nothing on record (say, a refund after a reload) never lands online.
    refundLabMaterial('honey', 2);
    expect(getHarvested('good:honey', { onlineOnly: true })).toBe(0);
    expect(getHarvested('good:honey')).toBe(2);
  });

  it('never trades offline goods at a stand, even while offline', () => {
    recordPlayerHarvest('fish', 4, 'me');
    expect(heldGood('fish')).toBe(0);
    expect(takeGood('fish', 1)).toBe(false);
    expect(getHarvested('good:fish')).toBe(4);
    expect(shortGoodMessage('fish', 1)).toMatch(/gathered offline stay in local play/);

    // A stand buy is ledger-backed, so it lands in the online bag.
    giveGood('fish', 2);
    expect(heldGood('fish')).toBe(2);
    expect(takeGood('fish', 2)).toBe(true);
    expect(getHarvested('good:fish')).toBe(4);
  });
});

describe('seeding a project with offline gathers', () => {
  it('refuses anyone but the creator, and any project with members', () => {
    const project = { owner: 'creator', members: ['creator'] };
    expect(seedRefusal(project, 'creator', 1)).toBeNull();
    expect(seedRefusal(project, 'someone', 1)).toMatch(/creator/);
    expect(seedRefusal({ owner: 'creator', members: ['creator', 'friend'] }, 'creator', 1)).toMatch(/no members/);
    expect(seedRefusal(project, 'creator', 0)).toMatch(/no offline gathers/);
    expect(seedRefusal(project, null, 1)).toMatch(/Sign in/);
  });

  it('charges the fee and moves the offline bag into the project, usable only in its Brain', async () => {
    projects.set('p1', { id: 'p1', owner: 'creator', members: ['creator'] });
    balances.set('creator', 25);
    recordPlayerHarvest('honey', 3, 'creator');
    recordPlayerHarvest('wood', 2, 'creator');

    const result = await seedProjectWithOfflineGathers('p1', 'creator');
    expect(result.fee).toBe(PROJECT_SEED_FEE_SWARM);
    expect(transfers).toEqual([{
      from: 'creator', to: 'community-pool', amount: PROJECT_SEED_FEE_SWARM,
      meta: { projectSeed: 'p1', marketVault: true, direction: 'vault-sell' },
    }]);
    expect(balances.get('creator')).toBe(25 - PROJECT_SEED_FEE_SWARM);
    expect(listOfflineHarvested()).toEqual([]);
    expect(listSeededHarvested('p1')).toEqual([{ symbol: 'C', count: 4 }, { symbol: 'good:honey', count: 3 }]);

    // Outside the project's Brain the seed pool is out of reach.
    expect(getHarvested('good:honey')).toBe(0);
    setMeshOnline(true);
    setActiveBrainProject('p1');
    // Online, in the project's Brain: usable for local play...
    expect(materialTotals().wood).toBe(2);
    expect(getHarvested('good:honey')).toBe(3);
    // ...but never by a stand or coin.
    expect(heldGood('honey')).toBe(0);
    expect(spendHarvested([{ symbol: 'good:honey', count: 1 }], { onlineOnly: true })).toBe(false);
    expect(spendMaterials({ wood: 2 })).toBe(true);
    setActiveBrainProject('p2');
    expect(getHarvested('good:honey')).toBe(0);
  });

  it('moves nothing and charges nothing once the project has a member', async () => {
    projects.set('p1', { id: 'p1', owner: 'creator', members: ['creator', 'friend'] });
    balances.set('creator', 25);
    recordPlayerHarvest('honey', 3, 'creator');
    await expect(seedProjectWithOfflineGathers('p1', 'creator')).rejects.toThrow(/no members/);
    expect(transfers).toEqual([]);
    expect(listOfflineHarvested()).toEqual([{ symbol: 'good:honey', count: 3 }]);
  });

  it('moves nothing when the fee cannot be paid', async () => {
    projects.set('p1', { id: 'p1', owner: 'creator', members: ['creator'] });
    balances.set('creator', PROJECT_SEED_FEE_SWARM - 1);
    recordPlayerHarvest('honey', 3, 'creator');
    await expect(seedProjectWithOfflineGathers('p1', 'creator')).rejects.toThrow(/Insufficient/);
    expect(listOfflineHarvested()).toEqual([{ symbol: 'good:honey', count: 3 }]);
    expect(listSeededHarvested('p1')).toEqual([]);
  });

  it('refuses someone signed in as another account', async () => {
    projects.set('p1', { id: 'p1', owner: 'creator', members: ['creator'] });
    recordPlayerHarvest('honey', 1, 'creator');
    auth.id = 'other';
    await expect(seedProjectWithOfflineGathers('p1', 'creator')).rejects.toThrow(/Sign in/);
    expect(transfers).toEqual([]);
  });
});
