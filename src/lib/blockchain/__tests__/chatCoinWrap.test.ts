import { describe, it, expect, vi, beforeEach } from 'vitest';

const stores = new Map<string, Map<string, unknown>>();
const s = (n: string) => {
  if (!stores.has(n)) stores.set(n, new Map());
  const store = stores.get(n);
  if (!store) throw new Error('Missing test store');
  return store;
};

vi.mock('../../store', () => ({
  put: async (n: string, v: { coinId?: string }) => { s(n).set(v.coinId as string, v); },
  get: async (n: string, k: string) => s(n).get(k),
  getAll: async (n: string) => Array.from(s(n).values()),
  remove: async (n: string, k: string) => { s(n).delete(k); },
}));

const ledger = vi.hoisted(() => ({ balance: 0, transactions: [] as Array<{ id: string; type: string; to: string; amount: number; timestamp: string; meta?: Record<string, unknown> }> }));
vi.mock('../chain', () => ({
  getSwarmChain: () => ({
    addTransaction: () => {},
    whenReady: async () => {},
    getPendingTransactions: () => ledger.transactions,
    getChain: () => [],
    getBalance: () => ledger.balance,
  }),
}));

import {
  canWrapChatHistory,
  findChatWrapCoin,
  getChatHistoryCoins,
  wrapChatHistoryIntoCoin,
  CHAT_COIN_MAX_MESSAGES,
  CHAT_WRAP_WEIGHT,
} from '../chatCoinWrap';
import { put } from '../../store';
import type { SwarmCoin } from '../types';

const USER = 'user-alice';

function makeCoin(overrides: Partial<SwarmCoin> = {}): SwarmCoin {
  return {
    coinId: `coin-${Math.random().toString(36).slice(2, 8)}`,
    weight: 0,
    maxWeight: 100,
    wrappedTokens: [],
    ownerId: USER,
    status: 'wallet',
    minedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  stores.clear();
  ledger.balance = 0;
  ledger.transactions = [];
});

describe('chatCoinWrap', () => {
  it('recovers a mined wallet coin from reward evidence and returns it with history', async () => {
    ledger.balance = 25;
    ledger.transactions = [{ id: 'reward-1', type: 'mining_reward', to: USER, amount: 25, timestamp: '2026-10-19T00:00:00Z' }];
    const { coin } = await wrapChatHistoryIntoCoin(USER, 'room-1', [{ author: 'alice', text: 'saved', ts: 1 }]);
    expect(coin.coinId).toBe(`mined:${USER}:0`);
    expect(coin.ownerId).toBe(USER);
    expect(coin.status).toBe('wallet');
    expect(ledger.balance).toBe(25);
    expect((await getChatHistoryCoins(USER))[0]?.wrappedChat?.messages[0]?.text).toBe('saved');
  });

  it('does not create a coin from non-mining balance', async () => {
    ledger.balance = 100;
    ledger.transactions = [{ id: 'gift', type: 'token_mint', to: USER, amount: 100, timestamp: '2026-10-19T00:00:00Z' }];
    expect(await canWrapChatHistory(USER)).toBe(false);
    expect(s('swarmCoins').size).toBe(0);
  });

  it('does not recreate a vaulted mining coin or spent mining balance', async () => {
    ledger.balance = 1;
    ledger.transactions = [{ id: 'reward', type: 'mining_reward', to: USER, amount: 1, timestamp: '2026-10-19T00:00:00Z' }];
    await put('swarmCoins', makeCoin({ coinId: `mined:${USER}:0`, ownerId: 'vault', status: 'vaulted', locked: true }));
    expect(await canWrapChatHistory(USER)).toBe(false);
    stores.clear();
    ledger.balance = 0;
    expect(await canWrapChatHistory(USER)).toBe(false);
  });
  it('finds only free, unlocked, fungible wallet coins owned by the user', async () => {
    await put('swarmCoins', makeCoin({ coinId: 'eligible' }));
    await put('swarmCoins', makeCoin({ coinId: 'locked', locked: true }));
    await put('swarmCoins', makeCoin({ coinId: 'media', kind: 'media' }));
    await put('swarmCoins', makeCoin({ coinId: 'pool', status: 'pool', ownerId: 'community-pool' }));
    await put('swarmCoins', makeCoin({ coinId: 'full', weight: 95 }));

    const found = await findChatWrapCoin(USER);
    expect(found?.coinId).toBe('eligible');
    expect(await canWrapChatHistory(USER)).toBe(true);
  });

  it('seals the transcript into the coin and keeps it in the user wallet', async () => {
    await put('swarmCoins', makeCoin({ coinId: 'target' }));
    const messages = [
      { author: 'alice', text: 'hello room', ts: 1000 },
      { author: 'bob', text: 'hey alice', ts: 2000 },
    ];

    const { coin } = await wrapChatHistoryIntoCoin(USER, 'room-1', messages);

    expect(coin.wrappedChat?.messageCount).toBe(2);
    expect(coin.wrappedChat?.participants).toEqual(['alice', 'bob']);
    expect(coin.wrappedChat?.roomId).toBe('room-1');
    expect(coin.weight).toBe(CHAT_WRAP_WEIGHT);
    expect(coin.ownerId).toBe(USER);
    expect(coin.status).toBe('wallet');
  });

  it('clips transcripts to the max message count, keeping the most recent', async () => {
    await put('swarmCoins', makeCoin({ coinId: 'big' }));
    const messages = Array.from({ length: CHAT_COIN_MAX_MESSAGES + 50 }, (_, i) => ({
      author: 'alice',
      text: `msg ${i}`,
      ts: i,
    }));

    const { coin } = await wrapChatHistoryIntoCoin(USER, 'room-1', messages);
    expect(coin.wrappedChat?.messageCount).toBe(CHAT_COIN_MAX_MESSAGES);
    expect(coin.wrappedChat?.messages.at(-1)?.text).toBe(`msg ${CHAT_COIN_MAX_MESSAGES + 49}`);
  });

  it('refuses to wrap when the user has no free mined coin', async () => {
    await expect(wrapChatHistoryIntoCoin(USER, 'room-1', [{ author: 'a', text: 'x', ts: 1 }]))
      .rejects.toThrow(/mined SWARM coin/);
  });

  it('refuses to wrap an empty transcript', async () => {
    await put('swarmCoins', makeCoin());
    await expect(wrapChatHistoryIntoCoin(USER, 'room-1', [])).rejects.toThrow(/Nothing to save/);
  });

  it('lists chat history coins newest first, excluding other users and unsaved coins', async () => {
    const older = makeCoin({ coinId: 'older' });
    older.wrappedChat = { roomId: 'r', savedAt: '2026-01-01T00:00:00Z', savedBy: USER, messageCount: 1, participants: ['a'], messages: [] };
    const newer = makeCoin({ coinId: 'newer' });
    newer.wrappedChat = { roomId: 'r', savedAt: '2026-02-01T00:00:00Z', savedBy: USER, messageCount: 2, participants: ['a'], messages: [] };
    const otherUsers = makeCoin({ coinId: 'not-mine', ownerId: 'user-bob' });
    otherUsers.wrappedChat = { roomId: 'r', savedAt: '2026-03-01T00:00:00Z', savedBy: 'user-bob', messageCount: 3, participants: ['b'], messages: [] };
    await put('swarmCoins', older);
    await put('swarmCoins', newer);
    await put('swarmCoins', otherUsers);
    await put('swarmCoins', makeCoin({ coinId: 'empty' }));

    const coins = await getChatHistoryCoins(USER);
    expect(coins.map((c) => c.coinId)).toEqual(['newer', 'older']);
  });
});
