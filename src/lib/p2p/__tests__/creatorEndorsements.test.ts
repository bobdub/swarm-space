import { describe, expect, it, vi } from 'vitest';
import { StandaloneSwarmMesh } from '../swarmMesh.standalone';
import { genIdentityKeyPair, computeUserId } from '@/lib/crypto';
import { endorsementSignerFromKeys, signEndorsement } from '@/lib/blockchain/endorsements';

type Round = { blockId: string; height: number; minedAt: number; votes: Map<string, boolean>; totalPeers: number; isHollow: boolean; chainHash?: string };
type Harness = {
  connections: Map<string, { open: boolean; send: (data: string) => void }>;
  pendingBlockVotes: Map<string, Round>;
  miningStats: { confirmedBlocks: number; pendingBlocks: number };
  handleChainEndorse: (from: string, msg: Record<string, unknown>) => void;
  handleBlockVote: (from: string, msg: Record<string, unknown>) => void;
};

async function voter() {
  const keys = await genIdentityKeyPair();
  return endorsementSignerFromKeys(await computeUserId(keys.publicKey), keys.publicKey, keys.privateKey);
}

function meshWithRound(totalPeers: number) {
  localStorage.clear();
  const h = new StandaloneSwarmMesh() as unknown as Harness;
  h.connections = new Map();
  h.miningStats.pendingBlocks = 1;
  h.pendingBlockVotes.set('round', {
    blockId: 'round', height: 1, minedAt: Date.now(), votes: new Map(), totalPeers, isHollow: false, chainHash: '00hash',
  });
  return h;
}

const block = { hash: '00hash', index: 5, epoch: 0, tick: 1 };

describe('CREATOR rounds confirm only on signed endorsements', () => {
  it('confirms once a majority of the connected peers sign the chain block', async () => {
    const h = meshWithRound(3);
    const [a, b] = await Promise.all([voter(), voter()]);
    h.handleChainEndorse('peer-a', { endorsement: await signEndorsement(block, true, a, 1), producer: 'me' });
    await new Promise((r) => setTimeout(r, 50));
    expect(h.miningStats.confirmedBlocks).toBe(0);
    h.handleChainEndorse('peer-b', { endorsement: await signEndorsement(block, true, b, 2), producer: 'me' });
    await vi.waitFor(() => expect(h.miningStats.confirmedBlocks).toBe(1));
  });

  it('ignores forged, declined, duplicate and legacy unsigned votes', async () => {
    const h = meshWithRound(1);
    const [a, b] = await Promise.all([voter(), voter()]);
    const signed = await signEndorsement(block, true, a, 1);
    h.handleChainEndorse('peer-a', { endorsement: { ...signed, observedAt: 99 }, producer: 'me' });
    h.handleChainEndorse('peer-b', { endorsement: await signEndorsement(block, false, b, 1), producer: 'me' });
    h.handleBlockVote('peer-c', { pendingBlockId: 'round', agree: true });
    await new Promise((r) => setTimeout(r, 100));
    expect(h.miningStats.confirmedBlocks).toBe(0);
    // A forged copy doesn't shadow the real endorsement that follows it.
    const h2 = meshWithRound(1);
    h2.handleChainEndorse('peer-a', { endorsement: { ...signed, observedAt: 99 }, producer: 'me' });
    await new Promise((r) => setTimeout(r, 50));
    h2.handleChainEndorse('peer-a', { endorsement: signed, producer: 'me' });
    await vi.waitFor(() => expect(h2.miningStats.confirmedBlocks).toBe(1));
    // The producer's own endorsement never counts.
    const me = await voter();
    h.handleChainEndorse('peer-d', { endorsement: await signEndorsement(block, true, me, 1), producer: me.userId });
    await new Promise((r) => setTimeout(r, 100));
    expect(h.miningStats.confirmedBlocks).toBe(0);
  });
});
