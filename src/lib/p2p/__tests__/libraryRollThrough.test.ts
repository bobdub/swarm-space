import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StandaloneSwarmMesh, SAVED_CONTACT_SHARE_WINDOW_MS, type LibraryPeer } from '../swarmMesh.standalone';
import { FADEOUT_WINDOW_MS } from '../contentLifecycle';

type Harness = {
  connections: Map<string, { open: boolean; send: (data: string) => void }>;
  getSharedLibraryPeers: () => Array<Record<string, unknown> & { peerId: string; active: boolean; lastSeenAt: number }>;
  handleLibraryExchange: (from: string, message: Record<string, unknown>) => void;
  expandOnlineMesh: ReturnType<typeof vi.fn>;
  scheduleMeshExpansion: ReturnType<typeof vi.fn>;
};

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-19T18:00:00Z').getTime();
const contact = (peerId: string, lastSeenAt: number, extra: Partial<LibraryPeer> = {}): LibraryPeer => ({
  peerId, nodeId: peerId.slice(5), alias: `Node ${peerId.slice(5)}`,
  addedAt: 1, lastSeenAt, autoConnect: true, source: 'manual', ...extra,
});

function createMesh(id: string, contacts: LibraryPeer[]) {
  localStorage.setItem('swarm-mesh-node-id', id);
  localStorage.setItem('swarm-mesh-connection-library', JSON.stringify(contacts));
  const mesh = new StandaloneSwarmMesh();
  const harness = mesh as unknown as Harness;
  harness.expandOnlineMesh = vi.fn();
  harness.scheduleMeshExpansion = vi.fn();
  return { mesh, harness };
}

describe('saved libraries roll through the mesh', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('uses the same 15-day window as content fadeout', () => {
    expect(SAVED_CONTACT_SHARE_WINDOW_MS).toBe(FADEOUT_WINDOW_MS);
  });

  it('first contact hands on live peers and saved contacts seen within 15 days', () => {
    const b = createMesh('b', [
      contact('peer-live', NOW),
      contact('peer-friend', NOW - 3 * DAY, { displayName: 'Friend', userId: 'u-friend' }),
      contact('peer-gone', NOW - 16 * DAY),
      contact('peer-never', 0),
    ]);
    b.harness.connections.set('peer-live', { open: true, send: vi.fn() });

    const shared = b.harness.getSharedLibraryPeers();
    expect(shared.map(p => [p.peerId, p.active])).toEqual([['peer-live', true], ['peer-friend', false]]);
    expect(shared[1].lastSeenAt).toBe(NOW - 3 * DAY);

    // A guest with an empty library meets B through an invite.
    const guest = createMesh('g', [contact('peer-b', NOW)]);
    guest.harness.handleLibraryExchange('peer-b', { peers: shared });
    const lib = new Map(guest.mesh.getLibrary().map(p => [p.peerId, p]));
    expect(lib.get('peer-friend')).toMatchObject({ displayName: 'Friend', lastSeenAt: NOW - 3 * DAY, source: 'exchange' });
    expect(lib.has('peer-live')).toBe(true);
    expect(lib.has('peer-gone')).toBe(false);

    // Only the live peer is dialed right away.
    const dialed = guest.harness.expandOnlineMesh.mock.calls.flatMap(call => call[1] as string[]);
    expect(dialed).toEqual(['peer-live']);
  });

  it('a relay cannot refresh a contact or keep a gone user alive', () => {
    const c = createMesh('c', []);
    c.harness.handleLibraryExchange('peer-b', { peers: [
      { peerId: 'peer-old', active: false, lastSeenAt: NOW - 20 * DAY },
      { peerId: 'peer-future', active: false, lastSeenAt: NOW + 5 * DAY },
    ] });
    const lib = new Map(c.mesh.getLibrary().map(p => [p.peerId, p]));
    expect(lib.has('peer-old')).toBe(false);
    expect(lib.get('peer-future')?.lastSeenAt).toBe(NOW);
  });

  it('keeps passing contacts on hop after hop until they age out', () => {
    const a = createMesh('a', [contact('peer-friend', NOW - 2 * DAY)]);
    const shared = a.harness.getSharedLibraryPeers();
    const b = createMesh('b', []);
    b.harness.handleLibraryExchange('peer-a', { peers: shared });
    const fromB = b.harness.getSharedLibraryPeers();
    expect(fromB.find(p => p.peerId === 'peer-friend')).toMatchObject({ active: false, lastSeenAt: NOW - 2 * DAY });

    vi.setSystemTime(NOW + 14 * DAY);
    expect(b.harness.getSharedLibraryPeers().some(p => p.peerId === 'peer-friend')).toBe(false);
  });

  it('an older relayed copy never rolls back newer identity or saved-friend provenance', () => {
    const a = createMesh('a', [contact('peer-friend', NOW - 2 * 60_000, {
      source: 'library', displayName: 'New Name', userId: 'u-new',
    })]);
    a.harness.handleLibraryExchange('peer-b', { peers: [
      { peerId: 'peer-friend', active: false, lastSeenAt: NOW - DAY, displayName: 'Old Name', userId: 'u-old', alias: 'Old Name' },
    ] });
    expect(a.mesh.getLibrary().find(p => p.peerId === 'peer-friend')).toMatchObject({
      source: 'library', displayName: 'New Name', userId: 'u-new', lastSeenAt: NOW - 2 * 60_000,
    });
  });

  it('an older relayed copy still fills identity gaps', () => {
    const a = createMesh('a', [contact('peer-friend', NOW - 60_000, { source: 'library' })]);
    a.harness.handleLibraryExchange('peer-b', { peers: [
      { peerId: 'peer-friend', active: false, lastSeenAt: NOW - DAY, displayName: 'Friend', userId: 'u-friend' },
    ] });
    expect(a.mesh.getLibrary().find(p => p.peerId === 'peer-friend')).toMatchObject({ displayName: 'Friend', userId: 'u-friend', source: 'library' });
  });
});
