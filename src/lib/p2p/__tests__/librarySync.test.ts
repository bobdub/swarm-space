import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StandaloneSwarmMesh, type LibraryPeer } from '../swarmMesh.standalone';
import { loadKnownPeers } from '../knownPeers';

type ExchangeHarness = {
  connections: Map<string, { open: boolean; send: (data: string) => void }>;
  getActiveExchangePeers: () => Record<string, unknown>[];
  handleLibraryExchange: (from: string, message: Record<string, unknown>) => void;
  handleProfileExchange: (from: string, message: Record<string, unknown>) => void;
  getLocalProfile: () => Record<string, unknown>;
  expandOnlineMesh: ReturnType<typeof vi.fn>;
  scheduleMeshExpansion: ReturnType<typeof vi.fn>;
};

const contact = (peerId: string, profile: Partial<LibraryPeer> = {}): LibraryPeer => ({
  peerId, nodeId: peerId.slice(5), alias: `Node ${peerId.slice(5)}`,
  addedAt: 1, lastSeenAt: 1, autoConnect: true, source: 'manual', ...profile,
});

function createMesh(id: string, contacts: LibraryPeer[]) {
  localStorage.setItem('swarm-mesh-node-id', id);
  localStorage.setItem('swarm-mesh-connection-library', JSON.stringify(contacts));
  const mesh = new StandaloneSwarmMesh();
  const harness = mesh as unknown as ExchangeHarness;
  // Exercise real exchange/reconciliation without creating live connections.
  harness.expandOnlineMesh = vi.fn();
  harness.scheduleMeshExpansion = vi.fn();
  return { mesh, harness };
}

describe('isolated A–B–C contact library synchronization', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T02:11:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    { username: 'mike', displayName: 'Mike', avatarRef: 'avatar-member' },
    { displayName: 'Guest C', avatarRef: 'avatar-guest' },
  ])('retains active C identity through B exchange and notifies A independently of media: %j', (profile) => {
    const b = createMesh('b', [contact('peer-c', profile), contact('peer-offline')]);
    b.harness.connections.set('peer-c', { open: true, send: vi.fn() });
    const a = createMesh('a', [contact('peer-b')]);
    const changes = vi.fn();
    const unsubscribe = a.mesh.onLibraryChange(changes);
    changes.mockClear();

    const peers = b.harness.getActiveExchangePeers();
    expect(peers.map(peer => peer.peerId)).toEqual(['peer-c']);
    a.harness.handleLibraryExchange('peer-b', { peers });

    expect(a.mesh.getLibrary().find(peer => peer.peerId === 'peer-c')).toMatchObject(profile);
    expect(loadKnownPeers().some(peer => peer.peerId === 'peer-c')).toBe(true);
    expect(changes).toHaveBeenCalled();
    expect(a.mesh.getConnectedPeerIds()).toEqual([]);
    unsubscribe();
    changes.mockClear();
    a.mesh.removeFromLibrary('peer-c');
    expect(changes).not.toHaveBeenCalled();
  });

  it('persists a same-timestamp profile update and keeps it through older packets and reload', () => {
    const a = createMesh('a', [contact('peer-c', { displayName: 'Old C' })]);
    a.harness.handleLibraryExchange('peer-b', { peers: [{ peerId: 'peer-c', displayName: 'Old C' }] });
    a.harness.handleLibraryExchange('peer-b', { peers: [{ peerId: 'peer-c', displayName: 'New C', avatarRef: 'new-avatar' }] });
    a.harness.handleLibraryExchange('peer-b', { peers: [{ peerId: 'peer-c' }] });
    expect(a.mesh.getLibrary().find(peer => peer.peerId === 'peer-c')).toMatchObject({ displayName: 'New C', avatarRef: 'new-avatar', source: 'manual' });
    const restored = new StandaloneSwarmMesh();
    expect(restored.getLibrary().find(peer => peer.peerId === 'peer-c')).toMatchObject({ displayName: 'New C', avatarRef: 'new-avatar' });
  });

  it('rebroadcasts C profile arrival to A after the initial nameless exchange', () => {
    const b = createMesh('b', [contact('peer-a'), contact('peer-c')]);
    const sendA = vi.fn();
    b.harness.connections.set('peer-a', { open: true, send: sendA });
    b.harness.connections.set('peer-c', { open: true, send: vi.fn() });
    b.harness.handleProfileExchange('peer-c', { displayName: 'C', avatarRef: 'avatar-c' });
    const packet = JSON.parse(sendA.mock.calls[0][0]);
    expect(packet.peers.find((peer: LibraryPeer) => peer.peerId === 'peer-c')).toMatchObject({ displayName: 'C', avatarRef: 'avatar-c' });
    const a = createMesh('a', [contact('peer-b')]);
    a.harness.handleLibraryExchange('peer-b', packet);
    expect(a.mesh.getLibrary().find(peer => peer.peerId === 'peer-c')?.displayName).toBe('C');
  });

  it('keeps connected peer self-reported identity authoritative over relayed metadata', () => {
    const a = createMesh('a', [contact('peer-c', { displayName: 'Direct C' })]);
    a.harness.connections.set('peer-c', { open: true, send: vi.fn() });
    a.harness.handleLibraryExchange('peer-b', { peers: [{ peerId: 'peer-c', displayName: 'Relayed C' }] });
    expect(a.mesh.getLibrary()[0].displayName).toBe('Direct C');
  });

  it('stops sharing disconnected C without deleting B’s durable contact', () => {
    const b = createMesh('b', [contact('peer-c')]);
    b.harness.connections.set('peer-c', { open: true, send: vi.fn() });
    expect(b.harness.getActiveExchangePeers()).toHaveLength(1);
    b.harness.connections.delete('peer-c');
    expect(b.harness.getActiveExchangePeers()).toEqual([]);
    expect(b.mesh.getLibrary().map(peer => peer.peerId)).toEqual(['peer-c']);
  });

  it('keeps panel contact changes in the authoritative map through the next exchange save without dialing', () => {
    const a = createMesh('a', [contact('peer-c', { displayName: 'C', avatarRef: 'avatar-c' })]);
    a.mesh.rememberKnownPeer('c', 'My friend');
    a.mesh.rememberKnownPeer('peer-d', 'D');
    expect(a.mesh.getLibrary().find(peer => peer.peerId === 'peer-c')).toMatchObject({ alias: 'My friend', avatarRef: 'avatar-c' });
    a.mesh.forgetKnownPeer('peer-d');
    a.harness.handleLibraryExchange('peer-b', { peers: [{ peerId: 'peer-e' }] });
    expect(loadKnownPeers().find(peer => peer.peerId === 'peer-d')).toBeUndefined();
    expect(loadKnownPeers().find(peer => peer.peerId === 'peer-c')?.label).toBe('My friend');
    expect(a.mesh.getConnectedPeerIds()).toEqual([]);
  });

  it('does not erase retained names or human aliases with blank relayed fields', () => {
    const a = createMesh('a', [contact('peer-c', { displayName: 'C', avatarRef: 'avatar-c', alias: 'My friend' })]);
    a.harness.handleLibraryExchange('peer-b', { peers: [{ peerId: 'peer-c', alias: 'Node c', displayName: '', avatarRef: '' }] });
    expect(a.mesh.getLibrary()[0]).toMatchObject({ displayName: 'C', avatarRef: 'avatar-c', alias: 'My friend' });
  });

  it('uses identity-local Guest Name rather than guest account username', () => {
    const a = createMesh('a', []);
    localStorage.setItem('me', JSON.stringify({ _guest: true, username: 'guest-internal-id', guestName: '  Guest Mike  ', profile: { avatarRef: 'guest-avatar' } }));
    expect(a.harness.getLocalProfile()).toEqual({ username: undefined, displayName: 'Guest Mike', avatarRef: 'guest-avatar' });
    localStorage.setItem('me', JSON.stringify({ username: 'member-mike', profile: {} }));
    expect(a.harness.getLocalProfile().displayName).toBe('member-mike');
  });
});