import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storedPosts = vi.hoisted(() => [] as Array<{ id: string; author: string; content?: string; manifestIds?: string[] }>);
vi.mock('@/lib/store', () => ({
  getAll: async () => storedPosts,
  get: async (_store: string, id: string) => storedPosts.find((p) => p.id === id),
}));
vi.mock('../globalCell', () => ({ getGlobalCell: () => ({ sendInviteKnock: vi.fn() }) }));

import { StandaloneSwarmMesh, type LibraryPeer } from '../swarmMesh.standalone';
import { _resetBlockedNodeContentForTest, isAuthorBlocked, listBlockedNodeContent } from '@/lib/content/blockedNodeContent';
import { _resetUnsupportedPostsForTest, isPostUnsupported, listUnsupportedPosts, stopSupportingPost } from '@/lib/content/unsupportedPostsStore';
import { isPostVisibleForContentFilter } from '@/lib/feed';
import { diffNodeBlocks } from '../blocklistStore';
import type { Post } from '@/types';

type Item = { id: string; type: string; author: string; data?: unknown; timestamp: number; hash: string };
type Harness = {
  peerId: string;
  phase: string;
  flags: { enabled: boolean };
  toggles: { autoConnect: boolean; libraryExchange: boolean };
  peer: { destroyed: boolean } | null;
  connections: Map<string, { open: boolean; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>;
  contentStore: Map<string, Item>;
  fileSeeders: Map<string, Set<string>>;
  dialPeer: ReturnType<typeof vi.fn>;
  pulseGlobalPresence: ReturnType<typeof vi.fn>;
  handlePushSteps(from: string, msg: Record<string, unknown>): Generator<void, void, unknown>;
  handleRequestSteps(from: string, msg: Record<string, unknown>): Generator<void, void, unknown>;
  handleLibraryExchange(from: string, msg: Record<string, unknown>): void;
};

const friend = (id: string, userId?: string): LibraryPeer => ({
  peerId: `peer-${id}`, nodeId: id, alias: id, source: 'library', autoConnect: true, lastSeenAt: Date.now(), addedAt: 1, userId,
});
const item = (id: string, author: string): Item => ({
  id, type: 'post', author, data: { id, author, content: id }, timestamp: 1, hash: `${id}-1`,
});
const conn = () => ({ open: true, send: vi.fn(), close: vi.fn() });
const drain = (gen: Generator<void, void, unknown>) => { for (const _ of gen) { /* run to end */ } };

function setup(peers: LibraryPeer[] = []) {
  localStorage.setItem('swarm-mesh-node-id', 'self');
  localStorage.setItem('swarm-mesh-connection-library', JSON.stringify(peers));
  const mesh = new StandaloneSwarmMesh();
  const h = mesh as unknown as Harness;
  h.peerId = 'peer-self';
  h.phase = 'online';
  h.flags.enabled = true;
  h.toggles.autoConnect = true;
  h.peer = { destroyed: false };
  h.dialPeer = vi.fn(() => true);
  h.pulseGlobalPresence = vi.fn();
  return { mesh, h };
}

describe('blocking a node refuses its connection and stops supporting its content', () => {
  beforeEach(() => {
    localStorage.clear();
    storedPosts.length = 0;
    _resetBlockedNodeContentForTest();
    _resetUnsupportedPostsForTest();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('closes the live connection and refuses every later dial and room handoff', () => {
    const { mesh, h } = setup([friend('bad', 'user-bad')]);
    const live = conn();
    h.connections.set('peer-bad', live);
    mesh.blockPeer('peer-bad');
    expect(live.close).toHaveBeenCalled();
    expect(h.connections.has('peer-bad')).toBe(false);
    expect(mesh.getLibrary()).toEqual([]);
    expect(mesh.registerPeerConnection('peer-bad')).toBe(false);
    mesh.connectToPeer('peer-bad');
    expect(h.dialPeer).not.toHaveBeenCalled();
    // The block survives a reload.
    expect(new StandaloneSwarmMesh().isBlocked('peer-bad')).toBe(true);
  });

  it('stops supporting posts already held, drops live copies and stops seeding from the node', async () => {
    storedPosts.push({ id: 'p-bad', author: 'user-bad', content: 'bad' }, { id: 'p-good', author: 'user-good' });
    const { mesh, h } = setup([friend('bad', 'user-bad')]);
    h.contentStore.set('p-bad', item('p-bad', 'user-bad'));
    h.contentStore.set('p-good', item('p-good', 'user-good'));
    h.fileSeeders.set('m1', new Set(['peer-bad', 'peer-good']));
    mesh.blockPeer('peer-bad');
    expect(isAuthorBlocked('user-bad')).toBe(true);
    expect(h.contentStore.has('p-bad')).toBe(false);
    expect(h.contentStore.has('p-good')).toBe(true);
    expect([...h.fileSeeders.get('m1')!]).toEqual(['peer-good']);
    await vi.waitFor(() => expect(isPostUnsupported('p-bad')).toBe(true));
    expect(isPostUnsupported('p-good')).toBe(false);
    expect(listUnsupportedPosts()[0]).toMatchObject({ postId: 'p-bad', source: 'block', blockedNode: 'peer-bad' });
  });

  it('refuses the node\'s content relayed by anyone else and never serves it', async () => {
    const { mesh, h } = setup([friend('bad', 'user-bad')]);
    mesh.blockPeer('peer-bad');
    drain(h.handlePushSteps('peer-good', { items: [item('p-bad', 'user-bad'), item('p-good', 'user-good')] }));
    expect(h.contentStore.has('p-bad')).toBe(false);
    expect(h.contentStore.has('p-good')).toBe(true);

    // Even a copy that slipped in is not served on request.
    h.contentStore.set('p-bad', item('p-bad', 'user-bad'));
    const asker = conn();
    h.connections.set('peer-asker', asker);
    drain(h.handleRequestSteps('peer-asker', { ids: ['p-bad', 'p-good'] }));
    // Replies go out paced, one per task.
    await vi.waitFor(() => expect(asker.send).toHaveBeenCalled());
    const sent = asker.send.mock.calls.map(([raw]) => JSON.parse(raw as string));
    const sentIds = sent.flatMap((m: { items?: Item[] }) => (m.items ?? []).map((i) => i.id));
    expect(sentIds).toContain('p-good');
    expect(sentIds).not.toContain('p-bad');
  });

  it('hides the node\'s posts from the feed', () => {
    const { mesh } = setup([friend('bad', 'user-bad')]);
    mesh.blockPeer('peer-bad');
    expect(isPostVisibleForContentFilter({ id: 'x', author: 'user-bad' } as Post, null, false)).toBe(false);
    expect(isPostVisibleForContentFilter({ id: 'y', author: 'user-good' } as Post, null, false)).toBe(true);
  });

  it('blocking by account id blocks the nodes it posts from', () => {
    const { mesh, h } = setup([friend('bad', 'user-bad'), friend('ok', 'user-ok')]);
    const live = conn();
    h.connections.set('peer-bad', live);
    mesh.blockPeer('user-bad');
    expect(mesh.isBlocked('peer-bad')).toBe(true);
    expect(mesh.isBlocked('peer-ok')).toBe(false);
    expect(live.close).toHaveBeenCalled();
    expect(isAuthorBlocked('user-bad')).toBe(true);
  });

  it('learns the account of a node blocked before its account was known', () => {
    const { mesh, h } = setup();
    mesh.blockPeer('peer-bad');
    expect(isAuthorBlocked('user-bad')).toBe(false);
    h.handleLibraryExchange('peer-good', { peers: [{ peerId: 'peer-bad', userId: 'user-bad' }] });
    expect(isAuthorBlocked('user-bad')).toBe(true);
    expect(mesh.getLibrary().some((p) => p.peerId === 'peer-bad')).toBe(false);
  });

  it('unblocking gives back exactly the posts the block stopped', async () => {
    storedPosts.push({ id: 'p-bad', author: 'user-bad' }, { id: 'p-bad-2', author: 'user-bad' });
    await stopSupportingPost({ postId: 'p-bad-2', source: 'feed' });
    const { mesh } = setup([friend('bad', 'user-bad')]);
    mesh.blockPeer('peer-bad');
    await vi.waitFor(() => expect(isPostUnsupported('p-bad')).toBe(true));
    mesh.unblockPeer('peer-bad');
    expect(mesh.isBlocked('peer-bad')).toBe(false);
    expect(isAuthorBlocked('user-bad')).toBe(false);
    expect(listBlockedNodeContent()).toEqual([]);
    await vi.waitFor(() => expect(isPostUnsupported('p-bad')).toBe(false));
    // The user's own Stop Support choice stays.
    expect(isPostUnsupported('p-bad-2')).toBe(true);
  });

  it('only full blocks from the app blocklist become node blocks', () => {
    const entry = (peerId: string, direction: 'all' | 'inbound' | 'outbound') => ({ peerId, direction, reason: null, createdAt: '' }) as never;
    expect(diffNodeBlocks([], [entry('peer-a', 'all'), entry('peer-b', 'inbound')])).toEqual({ added: ['peer-a'], removed: [] });
    expect(diffNodeBlocks([entry('peer-a', 'all')], [])).toEqual({ added: [], removed: ['peer-a'] });
  });
});
