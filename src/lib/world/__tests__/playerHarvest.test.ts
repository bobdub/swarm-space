import { describe, it, expect, beforeEach, vi } from 'vitest';
import { _resetPlayModeForTest } from '@/lib/world/playMode';

vi.mock('@/config/featureFlags', () => ({ getFeatureFlags: () => ({ scaffoldBus: true }) }));
vi.mock('@/lib/uqrc/fieldEngine', () => ({ getSharedFieldEngine: () => ({ inject: () => {} }) }));
const store = new Map<string, unknown>();
vi.mock('@/lib/store', () => ({
  get: async (_s: string, k: string) => store.get(k),
  put: async (_s: string, v: { k: string }) => { store.set(v.k, v); },
}));

import { subscribeScaffold, __resetScaffoldBusForTests } from '@/lib/uqrc/scaffoldBus';
import type { CoinFillEvent } from '@/lib/uqrc/scaffoldPorts';
import { recordPlayerHarvest } from '../playerHarvest';
import { readHarvestTally, flushHarvestJournal, _resetHarvestJournalForTest } from '@/lib/remix/harvestJournal';
import { _resetHarvestedForTest } from '@/lib/remix/harvestedInventory';
import { materialTotals } from '../materials';

beforeEach(() => {
  localStorage.clear();
  store.clear();
  __resetScaffoldBusForTests();
  _resetHarvestJournalForTest();
  _resetHarvestedForTest();
  _resetPlayModeForTest({ online: true });
});

describe('player harvest', () => {
  it('banks the goods, pays the player labour and journals it for engraving', async () => {
    const fills: CoinFillEvent[] = [];
    subscribeScaffold<CoinFillEvent>('coin', (e) => { fills.push(e); });
    recordPlayerHarvest('wood', 2, 'me');
    expect(materialTotals().wood).toBe(2);
    expect(fills).toHaveLength(1);
    expect(fills[0].coinId).toBe('labour:me');
    expect(fills[0].delta).toBeCloseTo(0.08);
    await flushHarvestJournal();
    const tally = await readHarvestTally('me');
    expect(tally.totals).toEqual({ wood: 2 });
    expect(tally.events).toBe(1);
  });

  it('survives a reload through the synchronous mirror', async () => {
    recordPlayerHarvest('food', 1, 'me');
    recordPlayerHarvest('food', 1, 'me');
    await flushHarvestJournal();
    store.clear(); // as if the IndexedDB write was dropped on unload
    _resetHarvestJournalForTest();
    expect((await readHarvestTally('me')).totals.food).toBe(2);
  });

  it('banks a guest harvest without paying labour', () => {
    const fills: CoinFillEvent[] = [];
    subscribeScaffold<CoinFillEvent>('coin', (e) => { fills.push(e); });
    recordPlayerHarvest('water', 1, null);
    expect(materialTotals().water).toBe(1);
    expect(fills).toHaveLength(0);
  });
});
