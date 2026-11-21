import { describe, expect, it, vi } from 'vitest';
import { StandaloneSwarmMesh } from '../swarmMesh.standalone';
import { genIdentityKeyPair, computeUserId } from '@/lib/crypto';
import { endorsementSignerFromKeys, signEndorsement } from '@/lib/blockchain/endorsements';

type Round = { blockId: string; height: number; minedAt: number; votes: Map<string, boolean>; totalPeers: number; isHollow: boolean; chainHash?: string; witnesses?: Set<string> };
type Harness = {
  connections: Map<string, { open: boolean; send: (data: string) => void }>;
  pendingBlockVotes: Map<string, Round>;
  miningStats: { confirmedBlocks: number; pendingBlocks: number };
  handleChainEndorse: (from: string, msg: Record<string, unknown>) => void;
  handleBlockVote: (from: string, msg: Record<string, unknown>) => void;
  chainBlockProducer: (hash: string) => Promise<string | undefined>;
};

async function voter() {
  const keys = await genIdentityKeyPair();
  return endorsementSignerFromKeys(await computeUserId(keys.publicKey), keys.publicKey, keys.privateKey);
}

function meshWithRound(totalPeers: number, witnesses: string[], producer = 'me') {
  localStorage.clear();
  const h = new StandaloneSwarmMesh() as unknown as Harness;
  h.connections = new Map();
  h.miningStats.pendingBlocks = 1;
  // Our chain holds the block; its validated miner is the producer.
  h.chainBlockProducer = async (hash) => (hash === '00hash' ? producer : undefined);
  h.pendingBlockVotes.set('round', {
    blockId: 'round', height: 1, minedAt: Date.now(), votes: new Map(), totalPeers, isHollow: false, chainHash: '00hash',
    witnesses: new Set(witnesses),
  });
  return h;
}

const block = { hash: '00hash', index: 5, epoch: 0, tick: 1 };

describe('CREATOR rounds confirm only on signed endorsements', () => {
  it('confirms once a majority of the connected peers sign the chain block', async () => {
    const [a, b] = await Promise.all([voter(), voter()]);
    const h = meshWithRound(3, [a.userId, b.userId, 'c']);
    h.handleChainEndorse('peer-a', { endorsement: await signEndorsement(block, true, a, 1), producer: 'me' });
    await new Promise((r) => setTimeout(r, 50));
    expect(h.miningStats.confirmedBlocks).toBe(0);
    h.handleChainEndorse('peer-b', { endorsement: await signEndorsement(block, true, b, 2), producer: 'me' });
    await vi.waitFor(() => expect(h.miningStats.confirmedBlocks).toBe(1));
  });

  it('ignores forged, declined, duplicate and legacy unsigned votes', async () => {
    const [a, b] = await Promise.all([voter(), voter()]);
    const me = await voter();
    const h = meshWithRound(1, [a.userId, b.userId, me.userId], me.userId);
    const signed = await signEndorsement(block, true, a, 1);
    h.handleChainEndorse('peer-a', { endorsement: { ...signed, observedAt: 99 }, producer: 'me' });
    h.handleChainEndorse('peer-b', { endorsement: await signEndorsement(block, false, b, 1), producer: 'me' });
    h.handleBlockVote('peer-c', { pendingBlockId: 'round', agree: true });
    await new Promise((r) => setTimeout(r, 100));
    expect(h.miningStats.confirmedBlocks).toBe(0);
    // A forged copy doesn't shadow the real endorsement that follows it.
    const h2 = meshWithRound(1, [a.userId]);
    h2.handleChainEndorse('peer-a', { endorsement: { ...signed, observedAt: 99 }, producer: 'me' });
    await new Promise((r) => setTimeout(r, 50));
    h2.handleChainEndorse('peer-a', { endorsement: signed, producer: 'me' });
    await vi.waitFor(() => expect(h2.miningStats.confirmedBlocks).toBe(1));
    // The producer's own endorsement never counts.
    h.handleChainEndorse('peer-d', { endorsement: await signEndorsement(block, true, me, 1), producer: me.userId });
    await new Promise((r) => setTimeout(r, 100));
    expect(h.miningStats.confirmedBlocks).toBe(0);
  });

  it('counts only the witnesses connected when the round opened', async () => {
    const [a, outsider1, outsider2] = await Promise.all([voter(), voter(), voter()]);
    const h = meshWithRound(1, [a.userId]);
    // A connected peer relays fresh identities: valid signatures, but not our electorate.
    h.handleChainEndorse('peer-a', { endorsement: await signEndorsement(block, true, outsider1, 1) });
    h.handleChainEndorse('peer-a', { endorsement: await signEndorsement(block, true, outsider2, 1) });
    await new Promise((r) => setTimeout(r, 100));
    expect(h.miningStats.confirmedBlocks).toBe(0);
    h.handleChainEndorse('peer-a', { endorsement: await signEndorsement(block, true, a, 1) });
    await vi.waitFor(() => expect(h.miningStats.confirmedBlocks).toBe(1));
  });

  it('takes the producer from our chain, not the relay, and holds endorsements of unknown blocks', async () => {
    const me = await voter();
    const h = meshWithRound(1, [me.userId], me.userId);
    // A relay that lies about the producer can't make the producer's self-endorsement count.
    h.handleChainEndorse('peer-x', { endorsement: await signEndorsement(block, true, me, 1), producer: 'someone-else' });
    await new Promise((r) => setTimeout(r, 100));
    expect(h.miningStats.confirmedBlocks).toBe(0);
    // An endorsement of a block we don't hold isn't marked seen: it lands once the block does.
    const a = await voter();
    const h2 = meshWithRound(1, [a.userId]);
    const other = { ...block, hash: '00other' };
    h2.pendingBlockVotes.get('round')!.chainHash = '00other';
    const signed = await signEndorsement(other, true, a, 1);
    h2.handleChainEndorse('peer-a', { endorsement: signed });
    await new Promise((r) => setTimeout(r, 100));
    expect(h2.miningStats.confirmedBlocks).toBe(0);
    h2.chainBlockProducer = async () => 'me';
    h2.handleChainEndorse('peer-a', { endorsement: signed });
    await vi.waitFor(() => expect(h2.miningStats.confirmedBlocks).toBe(1));
  });
});
