/**
 * Market tools: the Prospector's Pick costs 30 SWARM, or the same value in
 * Credits at the live spot rate (100:1 fallback). The payment goes into the
 * Market Vault and ownership is read back from the ledger.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SwarmTransaction } from '@/lib/blockchain/types';

const ledger = vi.hoisted(() => ({ pending: [] as SwarmTransaction[], blocks: [] as { transactions: SwarmTransaction[] }[] }));
const chain = vi.hoisted(() => ({
  whenReady: async () => {},
  getChain: () => ledger.blocks,
  getPendingTransactions: () => ledger.pending,
  addTransaction: (tx: SwarmTransaction) => { ledger.pending.push(tx); },
  getTotalSupply: () => 4000,
}));
vi.mock('@/lib/blockchain/chain', () => ({ getSwarmChain: () => chain }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: () => ({ id: 'u1' }) }));
const wallet = vi.hoisted(() => ({ swarm: 100, credits: 10_000 }));
vi.mock('@/lib/blockchain/token', () => ({
  transferSwarm: async (p: { from: string; to: string; amount: number; meta?: Record<string, unknown> }) => {
    if (wallet.swarm < p.amount) throw new Error('Insufficient SWARM balance');
    wallet.swarm -= p.amount;
    const tx = { id: `t${ledger.pending.length}`, type: 'token_transfer', from: p.from, to: p.to, amount: p.amount, meta: p.meta } as SwarmTransaction;
    ledger.pending.push(tx);
    return tx;
  },
}));
vi.mock('@/lib/credits', () => ({
  deductCredits: async (_u: string, amount: number) => {
    if (wallet.credits < amount) throw new Error('Insufficient credits.');
    wallet.credits -= amount;
  },
}));
vi.mock('@/lib/blockchain/poolLedger', () => ({
  COMMUNITY_POOL: 'community-pool',
  VAULT_CREDITS_CURRENCY: 'CREDITS',
  sharedMarketVaultState: () => ({ poolBalance: 1000, knownMined: 4000 }),
}));

import { buyTool, ownsTool, ownsToolIn, PROSPECTOR_PICK_ID, toolPriceCredits, toolPriceSwarm, toolQuote } from '@/lib/world/toolPurchases';
import { spotCreditsPerSwarm } from '@/lib/blockchain/marketVaultPricing';
import { prefabCost } from '@/lib/world/materials';

beforeEach(() => {
  ledger.pending = [];
  ledger.blocks = [];
  wallet.swarm = 100;
  wallet.credits = 10_000;
});

describe("Prospector's Pick price", () => {
  it('costs 30 SWARM and no materials', () => {
    expect(toolPriceSwarm(PROSPECTOR_PICK_ID)).toBe(30);
    expect(prefabCost(PROSPECTOR_PICK_ID)).toEqual({});
    expect(toolPriceSwarm('tool_pick_stone')).toBeNull();
  });

  it('Credits fall back to 100 per SWARM without a market', () => {
    expect(toolPriceCredits(PROSPECTOR_PICK_ID, null)).toBe(3000);
  });

  it('Credits follow the live spot rate', async () => {
    const market = { poolBalance: 1000, knownMined: 4000 };
    const spot = spotCreditsPerSwarm(market);
    expect(toolPriceCredits(PROSPECTOR_PICK_ID, market)).toBe(Math.ceil(30 * spot - 1e-9));
    expect((await toolQuote(PROSPECTOR_PICK_ID))?.credits).toBe(Math.ceil(30 * spot - 1e-9));
  });
});

describe('buying', () => {
  it('SWARM goes to the Market Vault as a pool inflow and the tool is owned', async () => {
    expect(await ownsTool('u1', PROSPECTOR_PICK_ID)).toBe(false);
    await buyTool('u1', PROSPECTOR_PICK_ID, 'SWARM');
    expect(wallet.swarm).toBe(70);
    const tx = ledger.pending[0];
    expect(tx.to).toBe('community-pool');
    expect(tx.meta).toMatchObject({ toolPurchase: PROSPECTOR_PICK_ID, marketVault: true, direction: 'vault-sell' });
    expect(await ownsTool('u1', PROSPECTOR_PICK_ID)).toBe(true);
    expect(await ownsTool('u2', PROSPECTOR_PICK_ID)).toBe(false);
  });

  it('Credits are deducted and recorded into the Market Credits reserve', async () => {
    const q = await toolQuote(PROSPECTOR_PICK_ID);
    await buyTool('u1', PROSPECTOR_PICK_ID, 'CREDITS');
    expect(wallet.credits).toBe(10_000 - q!.credits);
    expect(ledger.pending[0].meta).toMatchObject({ currency: 'CREDITS', toolPurchase: PROSPECTOR_PICK_ID, marketVault: true });
    expect(ownsToolIn(chain, 'u1', PROSPECTOR_PICK_ID)).toBe(true);
  });

  it('cannot be bought twice, and a short balance charges nothing', async () => {
    wallet.swarm = 10;
    await expect(buyTool('u1', PROSPECTOR_PICK_ID, 'SWARM')).rejects.toThrow(/Insufficient/);
    expect(ledger.pending).toHaveLength(0);
    wallet.swarm = 100;
    await buyTool('u1', PROSPECTOR_PICK_ID, 'SWARM');
    await expect(buyTool('u1', PROSPECTOR_PICK_ID, 'SWARM')).rejects.toThrow(/already own/);
    expect(wallet.swarm).toBe(70);
  });

  it('ownership is read from mined blocks too', () => {
    ledger.blocks = [{ transactions: [{ from: 'u1', to: 'community-pool', meta: { toolPurchase: PROSPECTOR_PICK_ID } } as SwarmTransaction] }];
    expect(ownsToolIn(chain, 'u1', PROSPECTOR_PICK_ID)).toBe(true);
  });

  it('refuses any other currency', async () => {
    await expect(buyTool('u1', PROSPECTOR_PICK_ID, 'GOLD' as never)).rejects.toThrow(/SWARM or Credits/);
  });
});
