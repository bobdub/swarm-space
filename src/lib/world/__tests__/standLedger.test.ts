/**
 * Stand sales live on the blockchain: goods sold to a stand show in its
 * stock from this device's ledger (pending, then mined) and survive a
 * reload, and every trade appears in the Wallet's stand ledger.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SwarmTransaction } from '@/lib/blockchain/types';

const h = vi.hoisted(() => ({ pending: [] as SwarmTransaction[], mined: [] as SwarmTransaction[], blocks: 1 }));

vi.mock('@/lib/auth', () => ({ getCurrentUser: () => ({ id: 'seller' }) }));
vi.mock('@/lib/blockchain/creatorMarketOperation', () => ({ withCreatorMarketOperation: (_k: string, fn: () => unknown) => fn() }));
let n = 0;
vi.mock('@/lib/blockchain/crypto', () => ({ generateTransactionId: () => `tx-${++n}` }));
vi.mock('@/lib/blockchain/storage', () => ({ derivePoolFromChain: async () => {} }));
const chain = vi.hoisted(() => ({
  whenReady: async () => {},
  getChain: () => [{ index: 1, hash: `h${h.blocks}-${h.mined.length}`, transactions: h.mined }],
  getPendingTransactions: () => h.pending,
  getConfirmedBalance: () => 1000,
  getBalance: () => 1000,
  getTotalSupply: () => 4000,
  addTransaction: (tx: SwarmTransaction) => { h.pending.push(tx); },
  hasTransaction: (id: string) => h.pending.some((t) => t.id === id),
}));
vi.mock('@/lib/blockchain/chain', () => ({ getSwarmChain: () => chain }));
vi.mock('@/lib/blockchain/token', () => ({ getSwarmBalance: async () => 0, transferSwarm: async () => { throw new Error('unused'); } }));
vi.mock('@/lib/credits', () => ({
  getCreditBalance: async () => 1_000_000,
  deductCredits: async () => {},
  awardVaultCredits: async () => {},
  transferCredits: async () => {},
}));

import { buyFromStand, getStandLocalStock, getStandVaultState, goodCurrency, sellToStand, standVaultScope } from '@/lib/world/tradingStand/tradingStandStore';
import { standLedgerFor } from '@/lib/world/tradingStand/standLedger';
import { _resetHarvestedForTest, recordHarvestForResource } from '@/lib/remix/harvestedInventory';

const scope = standVaultScope('p1', 'Owner');
const seed = (id: string, currency: string, amount: number): SwarmTransaction => ({
  id, type: 'custom_token_transfer', from: 'owner', to: scope.address, amount,
  timestamp: new Date(0).toISOString(), signature: '', publicKey: 'owner', nonce: 1, fee: 0, meta: { currency },
});

beforeEach(() => {
  h.pending.length = 0;
  h.blocks += 1;
  h.mined.splice(0, h.mined.length, seed('stock-wood', goodCurrency('wood'), 100), seed('stock-credits', 'CREDITS', 100_000));
  _resetHarvestedForTest();
  recordHarvestForResource('honey', 5);
});

describe('selling to a stand', () => {
  it('records the goods on the chain and the stand shows them before and after mining', async () => {
    await sellToStand({ userId: 'seller', scope, good: 'honey', qty: 3, currency: 'CREDITS' });
    const goodsLeg = h.pending.find((t) => t.meta?.tradeLeg === 'goods');
    expect(goodsLeg).toMatchObject({ from: 'seller', to: scope.address, amount: 3, meta: { currency: 'GOOD:honey' } });
    // Not yet in a block: prices still use mined stock, but the stand shows the sale.
    expect((await getStandVaultState(scope)).stock.honey).toBe(0);
    expect((await getStandLocalStock(scope)).honey).toBe(3);
    // A reload reads the same persisted pending pool, so the stock is still there.
    const reloaded = JSON.parse(JSON.stringify(h.pending)) as SwarmTransaction[];
    h.pending.splice(0, h.pending.length, ...reloaded);
    expect((await getStandLocalStock(scope)).honey).toBe(3);
    // Once mined, every peer's view has it.
    h.mined.push(...h.pending.splice(0));
    expect((await getStandVaultState(scope)).stock.honey).toBe(3);
    expect((await getStandLocalStock(scope)).honey).toBe(3);
  });

  it('lists the sale in the stand ledger, awaiting a block until mined', async () => {
    const q = await sellToStand({ userId: 'seller', scope, good: 'honey', qty: 2, currency: 'CREDITS' });
    let rows = standLedgerFor(chain, 'seller');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'sold', good: 'honey', qty: 2, amount: q.credits, currency: 'Credits', mined: false, standKey: scope.key });
    h.mined.push(...h.pending.splice(0));
    rows = standLedgerFor(chain, 'seller');
    expect(rows[0].mined).toBe(true);
    expect(standLedgerFor(chain, 'someone-else')).toHaveLength(0);
  });

  it("a buy shows for the buyer, and the stand owner sees their 15%", async () => {
    const q = await buyFromStand({ userId: 'seller', scope, good: 'wood', qty: 10, currency: 'CREDITS', stand: { placementId: 'p1', ownerId: 'owner' } });
    const buyer = standLedgerFor(chain, 'seller');
    // The buyer paid the full price on the chain: owner's 15%, community 5% and the vault's 80%.
    expect(buyer[0]).toMatchObject({ kind: 'bought', good: 'wood', qty: 10, amount: q.credits, currency: 'Credits' });
    const owner = standLedgerFor(chain, 'owner');
    expect(owner[0]).toMatchObject({ kind: 'owner-share', good: 'wood', amount: Math.floor(q.credits * 0.15), currency: 'Credits' });
    expect(Math.floor(q.credits * 0.15)).toBeGreaterThan(0);
    expect((await getStandLocalStock(scope)).wood).toBe(90);
  });
});
