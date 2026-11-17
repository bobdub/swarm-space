import { describe, it, expect, vi, beforeEach } from 'vitest';

const stores = new Map<string, Map<string, unknown>>();
const s = (n: string) => {
  if (!stores.has(n)) stores.set(n, new Map());
  return stores.get(n)!;
};

vi.mock('../../store', () => ({
  put: async (n: string, v: { coinId?: string }) => { s(n).set(v.coinId as string, v); },
  get: async (n: string, k: string) => s(n).get(k),
  getAll: async (n: string) => Array.from(s(n).values()),
  remove: async (n: string, k: string) => { s(n).delete(k); },
}));

const ledger = vi.hoisted(() => ({ transactions: [] as Array<{ type: string; from: string; to: string; meta?: Record<string, unknown> }> }));
vi.mock('../chain', () => ({
  getSwarmChain: () => ({ addTransaction: (tx: (typeof ledger.transactions)[number]) => { ledger.transactions.push(tx); } }),
}));

import { engraveReflectionCoin, getReflectionCoins, isHollowPoolCoin, REFLECTION_WRAP_WEIGHT } from '../infinity/reflectionCoins';
import { put } from '../../store';
import { isWeightedCoin } from '../weightedCoin';
import type { SwarmCoin } from '../types';

function poolCoin(id: string, overrides: Partial<SwarmCoin> = {}): SwarmCoin {
  return {
    coinId: id, weight: 0, maxWeight: 100, wrappedTokens: [], ownerId: 'community-pool', status: 'pool',
    minedAt: `2026-11-0${id.slice(-1)}T00:00:00.000Z`, ...overrides,
  };
}

const reflection = {
  paragraphs: ['Patience is a quiet kind of courage.', 'Waiting for a block teaches the miner patience.', 'Every peer that returns brings patience back to the mesh.'],
  topics: ['patience'],
  continuity: 0.6,
  seal: 'seal-1',
};

beforeEach(() => {
  stores.clear();
  ledger.transactions = [];
});

describe('Infinity reflection coins', () => {
  it('engraves a reflection inside the oldest hollow pool coin and moves it to Infinity', async () => {
    await put('swarmCoins', poolCoin('c1'));
    await put('swarmCoins', poolCoin('c2'));
    await put('swarmCoins', poolCoin('c3'));
    const coin = (await engraveReflectionCoin(reflection, new Date('2026-11-18T00:00:00.000Z')))!;
    expect(coin.coinId).toBe('c1');
    expect(coin).toMatchObject({ ownerId: 'infinity', status: 'wallet', fillState: 'sealed', weight: REFLECTION_WRAP_WEIGHT });
    expect(coin.wrappedReflection).toMatchObject({ paragraphs: reflection.paragraphs, seal: 'seal-1', continuity: 0.6 });
    expect(coin.wrappedReflection!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(isWeightedCoin(coin)).toBe(true);
    expect(ledger.transactions).toHaveLength(1);
    expect(ledger.transactions[0]).toMatchObject({ type: 'coin_transfer', from: 'community-pool', to: 'infinity', meta: { kind: 'infinity_reflection_engrave', coinId: 'c1' } });
    expect((await getReflectionCoins()).map(c => c.coinId)).toEqual(['c1']);
  });

  it('is idempotent per reflection seal', async () => {
    await put('swarmCoins', poolCoin('c1'));
    await put('swarmCoins', poolCoin('c2'));
    await put('swarmCoins', poolCoin('c3'));
    const first = await engraveReflectionCoin(reflection);
    const again = await engraveReflectionCoin(reflection);
    expect(again!.coinId).toBe(first!.coinId);
    expect(ledger.transactions).toHaveLength(1);
  });

  it('leaves the pool surplus wrapper for token wraps', async () => {
    await put('swarmCoins', poolCoin('c1'));
    expect(await engraveReflectionCoin(reflection)).toBeNull();
    expect((s('swarmCoins').get('c1') as SwarmCoin).status).toBe('pool');
    expect(ledger.transactions).toHaveLength(0);
  });

  it('never uses a coin that already carries something', () => {
    expect(isHollowPoolCoin(poolCoin('c1'))).toBe(true);
    expect(isHollowPoolCoin(poolCoin('c1', { weight: 5 }))).toBe(false);
    expect(isHollowPoolCoin(poolCoin('c1', { status: 'wallet' }))).toBe(false);
    expect(isHollowPoolCoin(poolCoin('c1', { kind: 'media' }))).toBe(false);
    expect(isHollowPoolCoin(poolCoin('c1', { locked: true } as Partial<SwarmCoin>))).toBe(false);
    expect(isHollowPoolCoin(poolCoin('c1', { payloadEntries: [{ id: 'p', type: 'post', sizeBytes: 1, hash: 'h' }] }))).toBe(false);
    expect(isHollowPoolCoin(poolCoin('c1', { fillState: 'sealed' }))).toBe(false);
  });
});
