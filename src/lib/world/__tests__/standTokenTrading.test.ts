import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SwarmTransaction } from '@/lib/blockchain/types';

const DREAMS = 'MINTME:0x' + 'd'.repeat(40);

const h = vi.hoisted(() => ({
  pending: [] as SwarmTransaction[],
  mined: [] as SwarmTransaction[],
  tokenBalance: 1000,
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: () => ({ id: 'buyer' }) }));
vi.mock('@/lib/blockchain/creatorMarketOperation', () => ({ withCreatorMarketOperation: (_k: string, fn: () => unknown) => fn() }));
vi.mock('@/lib/blockchain/crypto', () => ({ generateTransactionId: () => `tx-${Math.random()}` }));
vi.mock('@/lib/blockchain/storage', () => ({ derivePoolFromChain: async () => {} }));
vi.mock('@/lib/blockchain/token', () => ({
  getSwarmBalance: async () => 1000,
  transferSwarm: async (p: { from: string; to: string; amount: number; meta?: Record<string, unknown> }) =>
    ({ id: `s-${Math.random()}`, type: 'token_transfer', ...p }) as unknown as SwarmTransaction,
}));
vi.mock('@/lib/blockchain/deposits/customTokens', () => ({ getAvailableTokenBalance: () => h.tokenBalance }));
vi.mock('@/lib/blockchain/chain', () => {
  const chain = {
    whenReady: async () => {},
    getChain: () => [{ index: 1, hash: `h-${h.mined.length}`, transactions: h.mined }],
    getPendingTransactions: () => h.pending,
    getConfirmedBalance: (a: string) => (a === 'community-pool' ? 1000 : a.startsWith('trading-stand:') ? 100 : 0),
    getBalance: (a: string) => (a === 'community-pool' ? 1000 : a.startsWith('trading-stand:') ? 100 : 0),
    getTotalSupply: () => 4000,
    addTransaction: (tx: SwarmTransaction) => { h.pending.push(tx); },
    hasTransaction: () => false,
  };
  return { getSwarmChain: () => chain };
});

import { _resetPlayModeForTest } from '@/lib/world/playMode';
import { _resetHarvestedForTest, recordHarvestForResource } from '@/lib/remix/harvestedInventory';
import { heldGood } from '@/lib/world/tradingStand/goods';
import { quoteStandBuy, quoteStandBuyToken, quoteStandSellToken, standLiquidSwarmValue, standTokenOptions, type StandVaultState } from '@/lib/world/tradingStand/pricing';
import { buyFromStand, getStandVaultState, goodCurrency, sellToStand, standVaultScope } from '@/lib/world/tradingStand/tradingStandStore';
import { standLedgerFor } from '@/lib/world/tradingStand/standLedger';
import { getSwarmChain } from '@/lib/blockchain/chain';

const scope = standVaultScope('p1', 'Owner');
const stand = { placementId: 'p1', ownerId: 'owner' };
const leg = (id: string, from: string, to: string, amount: number, currency: string, meta: Record<string, unknown> = {}): SwarmTransaction => ({
  id, type: 'custom_token_transfer', from, to, amount, timestamp: new Date(0).toISOString(), signature: '', publicKey: from, nonce: 1, fee: 0,
  meta: { currency, ...meta },
});

const state = (over: Partial<StandVaultState> = {}): StandVaultState => ({
  swarmPool: 100, creditReserve: 0, stock: { wood: 100 }, market: { poolBalance: 1000, knownMined: 4000 },
  tokens: { [DREAMS]: 10_000 }, tokenPrices: { [DREAMS]: 0.001 }, tokenSymbols: { [DREAMS]: 'DRM' },
  ...over,
});

describe('stand token pricing', () => {
  it('lists held tokens with their market price and symbol', () => {
    expect(standTokenOptions(state())).toEqual([{ currency: DREAMS, symbol: 'DRM', held: 10_000, swarmPerToken: 0.001 }]);
    // A token without a market price can't be traded in.
    expect(standTokenOptions(state({ tokenPrices: {} }))).toEqual([]);
  });

  it('prices a buy as the SWARM price at the token market rate', () => {
    const s = state();
    const swarm = quoteStandBuy(s, 'wood', 5, 'SWARM', 1e9).swarm;
    const q = quoteStandBuyToken(s, 'wood', 5, DREAMS, 1e9);
    expect(q.error).toBeNull();
    expect(q.tokenAmount).toBeCloseTo(swarm / 0.001, 6);
    expect(quoteStandBuyToken(s, 'wood', 5, DREAMS, q.tokenAmount - 1).error).toMatch(/Not enough DRM/);
  });

  it('pays a sale from the token liquid layer, at most 10% of it', () => {
    const q = quoteStandSellToken(state(), 'wood', 5, DREAMS, 5);
    expect(q.error).toBeNull();
    expect(q.tokenAmount).toBeGreaterThan(0);
    // 100 DRM held: liquid 60, cap 6 DRM, far less than 5 wood is worth.
    expect(quoteStandSellToken(state({ tokens: { [DREAMS]: 100 } }), 'wood', 5, DREAMS, 5).error).toMatch(/at most 6 DRM/);
  });

  it('counts held tokens at market price in the stand liquidity', () => {
    // 60 liquid SWARM + 6,000 liquid DRM × 0.001.
    expect(standLiquidSwarmValue(state())).toBeCloseTo(66, 6);
  });
});

describe('trading in a token the stand holds', () => {
  beforeEach(() => {
    h.pending.length = 0;
    h.tokenBalance = 1000;
    h.mined.splice(0, h.mined.length,
      leg('stock', 'owner', scope.address, 100, goodCurrency('wood')),
      leg('fund', 'owner', scope.address, 10_000, DREAMS, { ticker: 'DRM', tradingStand: true, direction: 'donation', operationId: 'op-fund' }),
      { ...leg('pool', 'someone', 'community-pool', 1000, 'SWARM'), type: 'pool_donate' });
    _resetHarvestedForTest();
    _resetPlayModeForTest({ online: true });
  });

  it('reads the held token and prices it like the Market Vault', async () => {
    const s = await getStandVaultState(scope);
    expect(s.tokens?.[DREAMS]).toBe(10_000);
    expect(s.tokenSymbols?.[DREAMS]).toBe('DRM');
    expect(s.tokenPrices?.[DREAMS]).toBeGreaterThan(0);
  });

  it('buys goods with the token, split 15/5/80', async () => {
    const q = await buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 3, currency: DREAMS, stand });
    expect('tokenAmount' in q && q.tokenAmount > 0).toBe(true);
    const paid = h.pending.filter((t) => t.from === 'buyer' && t.meta?.currency === DREAMS);
    expect(paid.map((t) => t.to).sort()).toEqual(['community-pool', 'owner', scope.address].sort());
    expect(paid.reduce((a, t) => a + t.amount, 0)).toBeCloseTo(q.amount, 8);
    expect(paid.find((t) => t.to === 'owner')!.amount).toBeCloseTo(Math.floor(q.amount * 0.15 * 1e8) / 1e8, 8);
    expect(h.pending.find((t) => t.meta?.tradeLeg === 'goods')).toMatchObject({ from: scope.address, to: 'buyer', amount: 3 });
    expect(heldGood('wood')).toBe(3);
    const row = standLedgerFor(getSwarmChain(), 'buyer')[0];
    expect(row).toMatchObject({ kind: 'bought', currency: 'DRM' });
  });

  it('pays the owner their 15% back when they buy at their own stand', async () => {
    const q = await buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 3, currency: DREAMS, stand: { placementId: 'p1', ownerId: 'buyer' } });
    const owner = Math.floor(q.amount * 0.15 * 1e8) / 1e8;
    const paid = h.pending.filter((t) => t.from === 'buyer' && t.meta?.currency === DREAMS).reduce((a, t) => a + t.amount, 0);
    expect(paid).toBeCloseTo(q.amount, 8);
    expect(h.pending.find((t) => t.from === scope.address && t.meta?.tradeLeg === 'owner-cut')).toMatchObject({ to: 'buyer', amount: owner });
  });

  it('refuses a token buy the wallet cannot cover and charges nothing', async () => {
    h.tokenBalance = 0;
    await expect(buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 3, currency: DREAMS, stand })).rejects.toThrow(/Not enough DRM/);
    expect(h.pending).toEqual([]);
  });

  it('sells goods for the token, paid from the stand', async () => {
    recordHarvestForResource('wood', 4, 'online');
    const q = await sellToStand({ userId: 'buyer', scope, good: 'wood', qty: 4, currency: DREAMS, stand });
    expect(h.pending.find((t) => t.meta?.tradeLeg === 'payout')).toMatchObject({ from: scope.address, to: 'buyer', amount: q.amount, meta: { currency: DREAMS } });
    expect(heldGood('wood')).toBe(0);
  });

  it('refuses a token the stand does not hold', async () => {
    const other = 'MINTME:0x' + 'e'.repeat(40);
    await expect(buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 1, currency: other, stand })).rejects.toThrow(/does not trade in this token/);
  });
});

describe('bulk buys while stock awaits a block', () => {
  beforeEach(() => {
    h.pending.length = 0;
    // Mined: 2 wood. Stocked on this device, not yet in a block: 20 more.
    h.mined.splice(0, h.mined.length, leg('stock', 'owner', scope.address, 2, goodCurrency('wood')));
    h.pending.push(leg('restock', 'owner', scope.address, 20, goodCurrency('wood'), { tradingStand: true, direction: 'donation', operationId: 'op-restock' }));
    _resetHarvestedForTest();
    _resetPlayModeForTest({ online: true });
  });

  it('buys 10 at once from the 22 the stand shows, not only 1 at a time', async () => {
    const q = await buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 10, currency: 'SWARM', stand });
    expect(q.error).toBeNull();
    expect(heldGood('wood')).toBe(10);
  });

  it('still keeps the last unit and counts earlier unmined buys', async () => {
    await buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 15, currency: 'SWARM', stand });
    await expect(buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 7, currency: 'SWARM', stand })).rejects.toThrow(/keeps its last one/);
    await expect(buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 6, currency: 'SWARM', stand })).resolves.toBeTruthy();
  });

  it('never pays more to sell back what was just bought', async () => {
    const bought = await buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 10, currency: 'SWARM', stand });
    const sold = await sellToStand({ userId: 'buyer', scope, good: 'wood', qty: 10, currency: 'SWARM', stand });
    expect(sold.swarm).toBeLessThanOrEqual(bought.swarm);
  });
});
