import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SwarmTransaction } from '@/lib/blockchain/types';

const h = vi.hoisted(() => ({
  pending: [] as SwarmTransaction[],
  mined: [] as SwarmTransaction[],
  swarm: [] as { from: string; to: string; amount: number }[],
  creditTransfers: [] as { to: string; amount: number }[],
  deducted: [] as number[],
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: () => ({ id: 'buyer' }) }));
vi.mock('@/lib/blockchain/creatorMarketOperation', () => ({ withCreatorMarketOperation: (_k: string, fn: () => unknown) => fn() }));
vi.mock('@/lib/blockchain/crypto', () => ({ generateTransactionId: () => `tx-${Math.random()}` }));
vi.mock('@/lib/blockchain/storage', () => ({ derivePoolFromChain: async () => {} }));
vi.mock('@/lib/blockchain/chain', () => {
  const chain = {
    whenReady: async () => {},
    getChain: () => [{ index: 1, hash: 'h1', transactions: h.mined }],
    getPendingTransactions: () => h.pending,
    getConfirmedBalance: (a: string) => (a === 'community-pool' ? 1000 : 0),
    getBalance: (a: string) => (a === 'community-pool' ? 1000 : a === 'buyer' ? 50 : 0),
    getTotalSupply: () => 4000,
    addTransaction: (tx: SwarmTransaction) => { h.pending.push(tx); },
    hasTransaction: () => false,
  };
  return { getSwarmChain: () => chain };
});
vi.mock('@/lib/blockchain/token', () => ({
  getSwarmBalance: async () => 50,
  transferSwarm: async (p: { from: string; to: string; amount: number; meta?: Record<string, unknown> }) => {
    h.swarm.push({ from: p.from, to: p.to, amount: p.amount });
    return { id: `s-${h.swarm.length}`, type: 'token_transfer', ...p } as unknown as SwarmTransaction;
  },
}));
vi.mock('@/lib/credits', () => ({
  getCreditBalance: async () => 1_000_000,
  deductCredits: async (_u: string, n: number) => { h.deducted.push(n); },
  transferCredits: async (to: string, amount: number) => { h.creditTransfers.push({ to, amount }); },
}));

import { buyFromStand, goodCurrency, standScopeFor } from '@/lib/world/tradingStand/tradingStandStore';
import { _resetHarvestedForTest } from '@/lib/remix/harvestedInventory';

const scope = standScopeFor({ universeKey: 'global' });
const stocked = (good: 'wood', qty: number): SwarmTransaction => ({
  id: `stock-${good}`, type: 'custom_token_transfer', from: 'seller', to: scope.address, amount: qty,
  timestamp: new Date(0).toISOString(), signature: '', publicKey: 'seller', nonce: 1, fee: 0, meta: { currency: goodCurrency(good) },
});

describe('selling goods at an owned stand', () => {
  beforeEach(() => {
    h.pending.length = 0; h.swarm.length = 0; h.creditTransfers.length = 0; h.deducted.length = 0;
    h.mined.splice(0, h.mined.length, stocked('wood', 100));
    _resetHarvestedForTest();
  });

  it('pays the owner 15% of a SWARM sale and the vault the rest', async () => {
    const q = await buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 5, currency: 'SWARM', stand: { placementId: 'p1', ownerId: 'owner' } });
    const toOwner = h.swarm.find((t) => t.to === 'owner')!;
    const toVault = h.swarm.find((t) => t.to === 'community-pool')!;
    expect(toOwner.amount).toBeCloseTo(Math.floor(q.swarm * 0.15 * 1e6) / 1e6, 9);
    expect(toOwner.amount + toVault.amount).toBeCloseTo(q.swarm, 9);
  });

  it('pays the owner 15% of a Credits sale and the vault the rest', async () => {
    const q = await buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 10, currency: 'CREDITS', stand: { placementId: 'p1', ownerId: 'owner' } });
    expect(h.creditTransfers).toEqual([{ to: 'owner', amount: Math.floor(q.credits * 0.15) }]);
    expect(h.deducted).toEqual([q.credits - Math.floor(q.credits * 0.15)]);
  });

  it('takes no cut when the owner buys at their own stand', async () => {
    await buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 5, currency: 'SWARM', stand: { placementId: 'p1', ownerId: 'buyer' } });
    expect(h.swarm.map((t) => t.to)).toEqual(['community-pool']);
  });
});
