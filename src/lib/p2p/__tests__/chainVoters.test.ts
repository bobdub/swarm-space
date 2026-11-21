import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  voters: new Set<string>(),
  minedWith: null as unknown,
  tip: { hash: '00tip', index: 3, timestamp: '2020-01-01T00:00:00Z' },
}));
vi.mock('../../blockchain/chain', () => ({
  getSwarmChain: () => ({
    whenReady: async () => {},
    getLatestBlock: () => fake.tip,
    getVoters: () => new Set(fake.voters),
    minePendingTransactions: async (_m: string, _c: unknown, options: { witnesses: unknown }) => {
      fake.minedWith = options.witnesses;
      return { hash: '00new', index: 4, miner: 'me' };
    },
  }),
}));
vi.mock('../../blockchain/blockHeader', () => ({
  getLocalBlockSigner: async () => ({ userId: 'me', publicKey: 'pk', sign: async () => 'sig' }),
}));

const { StandaloneSwarmMesh } = await import('../swarmMesh.standalone');

type Round = { blockId: string; votes: Map<string, boolean>; totalPeers: number; witnesses?: Set<string>; chainHash?: string; isHollow: boolean; height: number; minedAt: number };
type Harness = {
  pendingBlockVotes: Map<string, Round>;
  announceChainBlock: (b: unknown) => void;
  mineChainBlock: (hollow: boolean, roundId?: string) => Promise<void>;
};

function round(witnesses: string[]): Harness {
  localStorage.clear();
  const h = new StandaloneSwarmMesh() as unknown as Harness;
  h.announceChainBlock = () => {};
  h.pendingBlockVotes.set('r', {
    blockId: 'r', votes: new Map(), totalPeers: witnesses.length, witnesses: new Set(witnesses), isHollow: false, height: 1, minedAt: 0,
  });
  return h;
}

describe('CREATOR rounds use the chain voter list', () => {
  it('counts only connected peers the chain names as voters: newcomers wait', async () => {
    fake.voters = new Set(['veteran', 'me', 'offline-voter']);
    const h = round(['veteran', 'newcomer']);
    await h.mineChainBlock(false, 'r');
    const r = h.pendingBlockVotes.get('r')!;
    expect(r.chainHash).toBe('00new');
    expect([...r.witnesses!]).toEqual(['veteran']);
    expect(r.totalPeers).toBe(1);
    expect(Array.isArray(fake.minedWith)).toBe(true);
  });

  it('keeps the connected peers while the chain names no voters yet', async () => {
    fake.voters = new Set();
    const h = round(['a', 'b']);
    await h.mineChainBlock(false, 'r');
    expect(h.pendingBlockVotes.get('r')!.totalPeers).toBe(2);
  });
});
