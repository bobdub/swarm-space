import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SwarmTransaction } from '@/lib/blockchain/types';

const h = vi.hoisted(() => ({
  pending: [] as SwarmTransaction[],
  mined: [] as SwarmTransaction[],
  swarm: [] as { from: string; to: string; amount: number }[],
  creditTransfers: [] as { to: string; amount: number }[],
  deducted: [] as number[],
  awarded: [] as { to: string; amount: number }[],
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
    getConfirmedBalance: (a: string) => (a === 'trading-stand:stand:p1' ? 1000 : 0),
    getBalance: (a: string) => (a === 'trading-stand:stand:p1' ? 1000 : a === 'buyer' ? 50 : 0),
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
  awardVaultCredits: async (u: string, n: number) => { h.awarded.push({ to: u, amount: n }); },
  transferCredits: async (to: string, amount: number) => { h.creditTransfers.push({ to, amount }); },
}));

import { buyFromStand, goodCurrency, standVaultScope } from '@/lib/world/tradingStand/tradingStandStore';
import { _resetHarvestedForTest } from '@/lib/remix/harvestedInventory';

const scope = standVaultScope('p1', 'Owner');
const VAULT = scope.address;
const stocked = (good: 'wood', qty: number): SwarmTransaction => ({
  id: `stock-${good}`, type: 'custom_token_transfer', from: 'seller', to: scope.address, amount: qty,
  timestamp: new Date(0).toISOString(), signature: '', publicKey: 'seller', nonce: 1, fee: 0, meta: { currency: goodCurrency(good) },
});

describe('selling goods at an owned stand', () => {
  beforeEach(() => {
    h.pending.length = 0; h.swarm.length = 0; h.creditTransfers.length = 0; h.deducted.length = 0; h.awarded.length = 0;
    h.mined.splice(0, h.mined.length, stocked('wood', 100));
    _resetHarvestedForTest();
  });

  const part = (n: number, share: number) => Math.floor(n * share * 1e6) / 1e6;

  it('splits a SWARM sale 15% owner, 5% community pool, 80% stand vault', async () => {
    const q = await buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 5, currency: 'SWARM', stand: { placementId: 'p1', ownerId: 'owner' } });
    const owner = h.swarm.find((t) => t.to === 'owner')!;
    const community = h.swarm.find((t) => t.to === 'community-pool')!;
    const vault = h.swarm.find((t) => t.to === VAULT)!;
    expect(owner.amount).toBeCloseTo(part(q.swarm, 0.15), 9);
    expect(community.amount).toBeCloseTo(part(q.swarm, 0.05), 9);
    expect(owner.amount + community.amount + vault.amount).toBeCloseTo(q.swarm, 9);
  });

  it('splits a Credits sale the same way', async () => {
    const q = await buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 10, currency: 'CREDITS', stand: { placementId: 'p1', ownerId: 'owner' } });
    const owner = Math.floor(q.credits * 0.15);
    const community = Math.floor(q.credits * 0.05);
    expect(h.creditTransfers).toEqual([{ to: 'owner', amount: owner }]);
    expect(h.deducted).toEqual([q.credits - owner]);
    const toPool = h.pending.find((t) => t.to === 'community-pool' && t.meta?.tradeLeg === 'community');
    expect(toPool?.amount).toBe(community);
    expect(h.pending.find((t) => t.to === VAULT && t.meta?.tradeLeg === 'payment')?.amount).toBe(q.credits - owner - community);
  });

  it('charges the owner full price at their own stand and pays 15% back from the stand vault', async () => {
    const q = await buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 5, currency: 'SWARM', stand: { placementId: 'p1', ownerId: 'buyer' } });
    const cut = part(q.swarm, 0.15);
    const community = part(q.swarm, 0.05);
    expect(h.swarm[0]).toEqual({ from: 'buyer', to: 'community-pool', amount: community });
    expect(h.swarm[1].to).toBe(VAULT);
    expect(h.swarm[1].amount + community).toBeCloseTo(q.swarm, 9);
    expect(h.swarm[2]).toEqual({ from: VAULT, to: 'buyer', amount: cut });
  });

  it("does the same for Credits at the owner's own stand", async () => {
    const q = await buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 10, currency: 'CREDITS', stand: { placementId: 'p1', ownerId: 'buyer' } });
    expect(h.deducted).toEqual([q.credits]);
    expect(h.awarded).toEqual([{ to: 'buyer', amount: Math.floor(q.credits * 0.15) }]);
    expect(h.creditTransfers).toEqual([]);
  });

  it('refuses to trade outside a placed stand', async () => {
    const { standScopeFor } = await import('@/lib/world/tradingStand/tradingStandStore');
    await expect(buyFromStand({ userId: 'buyer', scope: standScopeFor({ universeKey: 'global' }), good: 'wood', qty: 1, currency: 'SWARM' })).rejects.toThrow(/its own market/);
  });

  it("keeps the stand's market in its own vault: only the 5% community share reaches the pool", async () => {
    const q = await buyFromStand({ userId: 'buyer', scope, good: 'wood', qty: 5, currency: 'SWARM', stand: { placementId: 'p1', ownerId: 'owner' } });
    const toPool = h.swarm.filter((t) => t.to === 'community-pool').reduce((a, t) => a + t.amount, 0);
    expect(toPool).toBeCloseTo(part(q.swarm, 0.05), 9);
  });
});
