import { beforeEach, describe, expect, it } from 'vitest';
import {
  STAND_FLOOR_SHARE,
  TRADING_GOODS,
  maxBuyQty,
  quoteStandBuy,
  quoteStandSell,
  standCreditsPerSwarm,
  standLayers,
  standPriceBoard,
  splitStandPayment,
  STAND_BUYBACK_SHARE,
  STAND_COMMUNITY_SHARE,
  STAND_OWNER_SHARE,
  STAND_STABILITY_SHARE,
  unitPriceSwarm,
  type StandVaultState,
} from '@/lib/world/tradingStand/pricing';
import {
  goodCurrency,
  sharedStandVaultState,
  spendableStandVaultState,
  donateToStandVault,
  standScopeFor,
  standVaultScope,
  standStock,
  standTotalsOf,
} from '@/lib/world/tradingStand/tradingStandStore';
import { nearestStandWithin, STAND_PROMPT_RADIUS_M, STAND_TITLE } from '@/lib/world/tradingStand/proximity';
import { spotCreditsPerSwarm } from '@/lib/blockchain/marketVaultPricing';
import { VAULT_CREDITS_CURRENCY } from '@/lib/blockchain/poolLedger';
import type { SwarmBlock, SwarmTransaction } from '@/lib/blockchain/types';
import { getPrefab, TRADING_STAND_ID } from '@/lib/brain/prefabHouseCatalog';
import { gatheredGoodTotals, prefabCost, materialTotals } from '@/lib/world/materials';
import {
  _resetHarvestedForTest,
  getHarvested,
  listHarvested,
  recordHarvestForResource,
} from '@/lib/remix/harvestedInventory';
import { giveGood, heldGood, takeGood } from '@/lib/world/tradingStand/goods';

function vault(over: Partial<StandVaultState> = {}): StandVaultState {
  return {
    swarmPool: 1000,
    creditReserve: 50_000,
    stock: { wood: 100, stone: 100, water: 100, fibre: 100, food: 100, egg: 50, chicken: 20, fish: 40, shark: 5, honey: 40, gem: 10 },
    market: { poolBalance: 1000, knownMined: 4000 },
    ...over,
  };
}

describe('Trading Stand pricing', () => {
  it('never pays out of the 40% protected floor', () => {
    let pool = 1000;
    for (let i = 0; i < 200; i++) {
      const state = vault({ swarmPool: pool, stock: { gem: 0 } });
      const { swarmFloor, swarmLiquid } = standLayers(state);
      expect(swarmFloor).toBeCloseTo(pool * STAND_FLOOR_SHARE, 9);
      // Sell the largest gem lot that still quotes.
      let best = 0;
      for (let q = 1; q <= 5000; q *= 2) {
        const sell = quoteStandSell(state, 'gem', q, 'SWARM', q);
        if (sell.error) break;
        best = sell.swarm;
      }
      expect(best).toBeLessThanOrEqual(swarmLiquid * 0.1 + 1e-9);
      pool -= best;
      expect(pool).toBeGreaterThan(swarmFloor);
    }
    // The floor itself is never quoted: an all-floor vault pays nothing.
    const drained = quoteStandSell(vault({ swarmPool: 0 }), 'wood', 1, 'SWARM', 1);
    expect(drained.error).toMatch(/liquid SWARM/);
  });

  it('caps one trade at 10% of the liquid layer and 10% of stock', () => {
    const state = vault({ swarmPool: 10, stock: { gem: 0 } });
    const cap = standLayers(state).swarmTradeCap; // 0.6 SWARM
    expect(cap).toBeCloseTo(0.6, 9);
    const big = quoteStandSell(state, 'gem', 50, 'SWARM', 50);
    expect(big.swarm).toBeGreaterThan(cap);
    expect(big.error).toMatch(/at most/);
    expect(quoteStandSell(state, 'gem', 2, 'SWARM', 2).error).toBeNull();

    const credits = quoteStandSell(vault({ creditReserve: 1000 }), 'gem', 100, 'CREDITS', 100);
    expect(credits.error).toMatch(/at most 60 Credits/);

    expect(maxBuyQty(100)).toBe(10);
    expect(quoteStandBuy(vault(), 'wood', 10, 'SWARM', 1e9).error).toBeNull();
    expect(quoteStandBuy(vault(), 'wood', 11, 'SWARM', 1e9).error).toMatch(/10% of the stand's stock/);
  });

  it('raises the price after buys and lowers it after sells', () => {
    const before = unitPriceSwarm('wood', 100);
    const afterBuy = unitPriceSwarm('wood', 90);
    const afterSell = unitPriceSwarm('wood', 120);
    expect(afterBuy).toBeGreaterThan(before);
    expect(afterSell).toBeLessThan(before);
    const first = quoteStandBuy(vault({ stock: { wood: 100 } }), 'wood', 5, 'SWARM', 1e9).swarm;
    const second = quoteStandBuy(vault({ stock: { wood: 95 } }), 'wood', 5, 'SWARM', 1e9).swarm;
    expect(second).toBeGreaterThan(first);
    // A buy never costs less than selling the same units back pays.
    const back = quoteStandSell(vault({ stock: { wood: 95 } }), 'wood', 5, 'SWARM', 5).swarm;
    expect(first).toBeGreaterThanOrEqual(back);
  });

  it('can never be bought out to zero', () => {
    let stock = 60;
    for (let i = 0; i < 500; i++) {
      const cap = maxBuyQty(stock);
      if (cap === 0) break;
      const q = quoteStandBuy(vault({ stock: { honey: stock } }), 'honey', cap, 'SWARM', 1e9);
      expect(q.error).toBeNull();
      stock -= cap;
    }
    expect(stock).toBeGreaterThan(0);
    expect(quoteStandBuy(vault({ stock: { honey: 1 } }), 'honey', 1, 'SWARM', 1e9).error).toMatch(/no honey/);
  });

  it('quotes Credits at the SWARM quote times the live spot rate', () => {
    const state = vault();
    const spot = spotCreditsPerSwarm(state.market);
    expect(standCreditsPerSwarm(state)).toBe(spot);
    expect(spot).not.toBe(100);
    for (const g of TRADING_GOODS) {
      const buy = quoteStandBuy(state, g.id, 1, 'CREDITS', 1e12);
      expect(buy.error).toBeNull();
      expect(buy.credits).toBe(Math.ceil(buy.swarm * spot - 1e-9));
      const sell = quoteStandSell(state, g.id, 3, 'CREDITS', 3);
      expect(sell.credits).toBe(Math.floor(sell.swarm * spot + 1e-9));
      // The same trade is the same SWARM value in either currency.
      expect(quoteStandBuy(state, g.id, 1, 'SWARM', 1e12).swarm).toBe(buy.swarm);
    }
  });

  it('fails closed on unsupported payment', () => {
    // @ts-expect-error — not a stand currency
    expect(quoteStandBuy(vault(), 'wood', 1, 'MINTME', 1e9).error).toMatch(/only settles/);
    expect(quoteStandBuy(vault(), 'wood', 1.5, 'SWARM', 1e9).error).toMatch(/whole number/);
  });

  it('lists live Buy and Sell prices for every good', () => {
    const board = standPriceBoard(vault());
    expect(board.map((r) => r.good.id).sort()).toEqual(['chicken', 'egg', 'fibre', 'fish', 'food', 'gem', 'honey', 'shark', 'stone', 'water', 'wood']);
    // Food is sold as Fruit at the stand.
    expect(board.find((r) => r.good.id === 'food')?.good.label).toBe('Fruit');
    for (const row of board) {
      expect(row.buySwarm).not.toBeNull();
      expect(row.buySwarm!).toBeGreaterThan(row.sellSwarm);
      expect(row.sellCredits).toBeGreaterThan(0);
    }
  });
});

// ── Ledger-derived stand vault ───────────────────────────────────────

let n = 0;
function tx(from: string, to: string, amount: number, currency: string): SwarmTransaction {
  n += 1;
  return {
    id: `t${n}`, type: 'custom_token_transfer', from, to, amount, timestamp: new Date(0).toISOString(),
    signature: '', publicKey: from, nonce: n, fee: 0, meta: { currency, tradingStand: true },
  };
}

function fakeChain(mined: SwarmTransaction[], pending: SwarmTransaction[] = [], balances: Record<string, number> = {}) {
  const blocks = [{ index: 1, hash: `h${mined.length}`, transactions: mined } as unknown as SwarmBlock];
  return {
    getChain: () => blocks,
    getPendingTransactions: () => pending,
    getConfirmedBalance: (a: string) => balances[a] ?? 0,
    getBalance: (a: string) => balances[a] ?? 0,
    getTotalSupply: () => 4000,
  };
}

describe('Trading Stand vault state', () => {
  it('keys public rooms and Cells to the main vault, private Cells to their own', () => {
    const main = standScopeFor({ universeKey: 'global' });
    expect(main).toMatchObject({ key: 'room:global', settlesMain: true });
    expect(standScopeFor({ universeKey: 'global', cell: { cellId: 'u/pub', isPublic: true } }).settlesMain).toBe(true);
    const priv = standScopeFor({ universeKey: 'global', cell: { cellId: 'u/abc' } });
    expect(priv).toMatchObject({ key: 'cell:u/abc', address: 'trading-stand:cell:u/abc', settlesMain: false });
  });

  it('derives stock from goods legs on the ledger', () => {
    const at = 'trading-stand:room:global';
    const t = standTotalsOf([
      tx('alice', at, 30, goodCurrency('wood')),
      tx('bob', at, 5, goodCurrency('honey')),
      tx(at, 'carol', 4, goodCurrency('wood')),
      tx('alice', 'trading-stand:room:other', 99, goodCurrency('wood')),
      tx('alice', at, 9, 'GOOD:unobtanium'),
    ], at);
    expect(standStock(t)).toMatchObject({ wood: 26, honey: 5, gem: 0 });
  });

  it('prices from mined blocks and spends only what this device has not promised', () => {
    const scope = standScopeFor({ universeKey: 'global', cell: { cellId: 'u/abc' } });
    const chain = fakeChain(
      [tx('alice', scope.address, 50, goodCurrency('stone')), tx('alice', scope.address, 2000, VAULT_CREDITS_CURRENCY)],
      [tx(scope.address, 'me', 10, goodCurrency('stone'))],
      { [scope.address]: 12 },
    );
    const shared = sharedStandVaultState(chain, scope);
    expect(shared.stock.stone).toBe(50);
    expect(shared.creditReserve).toBe(2000);
    expect(shared.swarmPool).toBe(12);
    expect(spendableStandVaultState(chain, scope).stock.stone).toBe(40);
  });
});

describe("each stand is its own market", () => {
  it('splits every sale 40/40/15/5 like a creator market', () => {
    expect([STAND_BUYBACK_SHARE, STAND_STABILITY_SHARE, STAND_OWNER_SHARE, STAND_COMMUNITY_SHARE]).toEqual([0.4, 0.4, 0.15, 0.05]);
    expect(splitStandPayment(1, 'SWARM', 'owner')).toEqual({ owner: 0.15, community: 0.05, vault: 0.8 });
    expect(splitStandPayment(200, 'CREDITS', 'owner')).toEqual({ owner: 30, community: 10, vault: 160 });
    // Whole Credits: owner and community round down, the vault takes the rest.
    expect(splitStandPayment(7, 'CREDITS', 'owner')).toEqual({ owner: 1, community: 0, vault: 6 });
    const swarm = splitStandPayment(0.123457, 'SWARM', 'owner');
    expect(swarm.owner + swarm.community + swarm.vault).toBeCloseTo(0.123457, 9);
  });

  it("keeps the owner's share in the vault when the stand has no owner", () => {
    expect(splitStandPayment(100, 'CREDITS', null)).toEqual({ owner: 0, community: 5, vault: 95 });
  });

  it("gives every stand its own vault, and lets only the owner fund it", async () => {
    const own = standVaultScope('p1', 'Ada');
    expect(own).toMatchObject({ key: 'stand:p1', address: 'trading-stand:stand:p1', settlesMain: false });
    expect(standVaultScope('p2').address).not.toBe(own.address);
    const stand = { placementId: 'p1', ownerId: 'owner' };
    await expect(donateToStandVault('someone', own, stand, { kind: 'SWARM' }, 1)).rejects.toThrow(/Only the stand's owner/);
    await expect(donateToStandVault('owner', own, stand, { kind: 'SWARM' }, 0)).rejects.toThrow(/above zero/);
  });
});

describe('Trading Stand in the Brain', () => {
  beforeEach(() => _resetHarvestedForTest());

  it('is built from wood, stone and fibre', () => {
    expect(getPrefab(TRADING_STAND_ID)?.label).toBe('Trading Stand');
    const cost = prefabCost(TRADING_STAND_ID);
    expect(cost.wood).toBeGreaterThan(0);
    expect(cost.stone).toBeGreaterThan(0);
    expect(cost.fibre).toBeGreaterThan(0);
    expect(cost.water ?? 0).toBe(0);
  });

  it('opens within 3.5 m', () => {
    expect(STAND_TITLE).toBe('Trading Stand - Open Bazaar');
    const stands = [{ placementId: 'a', pos: [0, 0, 3.4] as const }, { placementId: 'b', pos: [0, 0, 9] as const }];
    expect(nearestStandWithin([0, 0, 0], stands)?.placementId).toBe('a');
    expect(nearestStandWithin([0, 0, -1], stands, STAND_PROMPT_RADIUS_M)).toBeNull();
  });

  it('counts honey, eggs, chickens, fish, sharks and gems in the Gathered tally', () => {
    for (const kind of ['honey', 'egg', 'chicken', 'fish', 'shark', 'gem']) recordHarvestForResource(kind, 2);
    expect(gatheredGoodTotals()).toEqual({ honey: 2, egg: 2, chicken: 2, fish: 2, shark: 2, gem: 2 });
    expect(heldGood('shark')).toBe(2);
    expect(materialTotals().food).toBe(0);
  });

  it('keeps honey and gems as their own goods in the bag', () => {
    recordHarvestForResource('honey', 3);
    giveGood('gem', 2);
    expect(getHarvested('good:honey')).toBe(3);
    expect(heldGood('honey')).toBe(3);
    expect(heldGood('gem')).toBe(2);
    expect(listHarvested().some((h) => h.symbol.startsWith('good:'))).toBe(false);
    expect(materialTotals().stone).toBe(0);
    expect(takeGood('gem', 3)).toBe(false);
    expect(takeGood('gem', 2)).toBe(true);
    expect(heldGood('gem')).toBe(0);
    giveGood('wood', 4);
    expect(heldGood('wood')).toBe(4);
    expect(takeGood('wood', 4)).toBe(true);
    expect(heldGood('wood')).toBe(0);
  });
});
