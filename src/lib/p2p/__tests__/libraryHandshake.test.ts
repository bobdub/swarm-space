import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StandaloneSwarmMesh, type LibraryPeer } from '../swarmMesh.standalone';

vi.mock('../sharedNeuralEngine', () => ({ getSharedNeuralEngine: () => ({ onInteraction: vi.fn() }) }));
vi.mock('../synapseLayer', () => ({ recordHandshake: vi.fn() }));
vi.mock('../globalCell', () => ({ getGlobalCell: () => ({ pulsePresence: vi.fn() }) }));

const NOW = new Date('2026-11-21T14:41:00Z').getTime();
const DAY = 86_400_000;
const contact = (peerId: string, age = 0): LibraryPeer => ({
  peerId, nodeId: peerId.slice(5), alias: peerId, addedAt: 1,
  lastSeenAt: NOW - age, autoConnect: true, source: 'library',
});
type Packet = Record<string, unknown> & { type: string; peers?: Array<{ peerId: string; active: boolean; lastSeenAt: number }> };

function connection(peer: string) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    peer, open: true, metadata: { nodeId: peer.slice(5) },
    send: vi.fn<(raw: string) => void>(), close: vi.fn(),
    on: (event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, handler); },
    fire: (event: string) => handlers.get(event)?.(),
  };
}
type Connection = ReturnType<typeof connection>;
type Harness = {
  phase: string;
  toggles: { mining: boolean; autoConnect: boolean; libraryExchange: boolean };
  connections: Map<string, Connection>;
  handleConnection: (conn: Connection, source: string) => void;
  handleLibraryExchange: (from: string, packet: Record<string, unknown>) => void;
  sendLibraryExchange: (conn: Connection) => void;
  getSharedLibraryPeers: () => Packet['peers'];
  pulseGlobalPresence: () => void;
  sendLifecycleState: () => void;
  sendContentInventory: () => void;
  sendProfileExchange: () => void;
  sendNeuralDigest: () => void;
  drainPendingAssetQueue: () => void;
  scheduleMeshExpansion: () => void;
};
function node(id: string, contacts: LibraryPeer[] = []) {
  localStorage.setItem('swarm-mesh-node-id', id);
  localStorage.setItem('swarm-mesh-connection-library', JSON.stringify(contacts));
  const mesh = new StandaloneSwarmMesh();
  const h = mesh as unknown as Harness;
  h.phase = 'online'; h.toggles.mining = false; h.toggles.autoConnect = false;
  // Keep real channel opens, exchange and durable library; isolate unrelated traffic.
  for (const key of ['pulseGlobalPresence', 'sendLifecycleState', 'sendContentInventory', 'sendProfileExchange', 'sendNeuralDigest', 'drainPendingAssetQueue', 'scheduleMeshExpansion'] as const) h[key] = vi.fn();
  return { mesh, h };
}
const packets = (c: Connection): Packet[] => c.send.mock.calls.map(([raw]) => JSON.parse(raw) as Packet).filter(p => p.type === 'library-exchange');

describe('universal reciprocal library handshake', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('exchanges recent libraries on ordinary data opens, persists the guest result and survives reload', () => {
    const a = node('a', [contact('peer-friend-a', 9 * DAY), contact('peer-old', 10 * DAY + 1)]);
    localStorage.setItem('me', JSON.stringify({ _guest: true, guestName: 'Guest Mike' }));
    const b = node('b', [contact('peer-friend-b', DAY)]);
    const ab = connection('peer-b'); const ba = connection('peer-a');
    a.h.handleConnection(ab, 'manual'); b.h.handleConnection(ba, 'exchange');
    ab.fire('open'); ba.fire('open');
    // The library goes out a beat after open, not in the same frame.
    expect(packets(ab)).toHaveLength(0); expect(packets(ba)).toHaveLength(0);
    vi.advanceTimersByTime(250);
    expect(packets(ab)).toHaveLength(1); expect(packets(ba)).toHaveLength(1);
    const fromA = packets(ab)[0]; const fromB = packets(ba)[0];
    a.h.handleLibraryExchange('peer-b', fromB);
    b.h.handleLibraryExchange('peer-a', fromA);
    expect(a.mesh.getLibrary().some(p => p.peerId === 'peer-friend-b')).toBe(true);
    expect(b.mesh.getLibrary().some(p => p.peerId === 'peer-friend-a')).toBe(true);
    expect(b.mesh.getLibrary().some(p => p.peerId === 'peer-old')).toBe(false);
    expect(new StandaloneSwarmMesh().getLibrary().map(p => p.peerId)).toEqual(expect.arrayContaining(['peer-a', 'peer-friend-a', 'peer-friend-b']));
    expect(packets(ab)).toHaveLength(1); expect(packets(ba)).toHaveLength(1);
  });

  it('answers an empty incoming library once per channel and again after reconnection', () => {
    const b = node('b'); const c = connection('peer-a');
    b.h.connections.set('peer-a', c);
    b.h.handleLibraryExchange('peer-a', { peers: [] });
    b.h.handleLibraryExchange('peer-a', { peers: [] });
    expect(packets(c)).toHaveLength(1);
    expect(b.mesh.getLibrary()[0].peerId).toBe('peer-a');
    const replacement = connection('peer-a'); b.h.connections.set('peer-a', replacement);
    b.h.handleLibraryExchange('peer-a', { peers: [] });
    expect(packets(replacement)).toHaveLength(1);
  });

  it('retries a reciprocal snapshot if its previous send threw', () => {
    const b = node('b'); const c = connection('peer-a'); b.h.connections.set('peer-a', c);
    c.send.mockImplementationOnce(() => { throw new Error('channel not ready'); });
    b.h.handleLibraryExchange('peer-a', { peers: [] });
    b.h.handleLibraryExchange('peer-a', { peers: [] });
    expect(c.send).toHaveBeenCalledTimes(2);
  });

  it('shares the exact ten-day boundary, not older contacts or closed channels as live', () => {
    const b = node('b', [contact('peer-edge', 10 * DAY), contact('peer-old', 10 * DAY + 1), contact('peer-closed', DAY)]);
    const closed = connection('peer-closed'); closed.open = false; b.h.connections.set('peer-closed', closed);
    // A closed channel is not live; its recent library record may still be shared as saved.
    expect(b.h.getSharedLibraryPeers()).toEqual(expect.arrayContaining([
      expect.objectContaining({ peerId: 'peer-edge', active: false, lastSeenAt: NOW - 10 * DAY }),
      expect.objectContaining({ peerId: 'peer-closed', active: false, lastSeenAt: NOW - DAY }),
    ]));
    expect(b.h.getSharedLibraryPeers()?.some(p => p.peerId === 'peer-old' || p.active)).toBe(false);
  });

  it('honors disabled library exchange in both directions', () => {
    const b = node('b'); b.h.toggles.libraryExchange = false;
    const c = connection('peer-a'); b.h.connections.set('peer-a', c);
    b.h.sendLibraryExchange(c);
    b.h.handleLibraryExchange('peer-a', { peers: [{ peerId: 'peer-c', active: true }] });
    expect(c.send).not.toHaveBeenCalled(); expect(b.mesh.getLibrary()).toEqual([]);
  });

  it('does not rebroadcast timestamp-only liveness changes around triangles', () => {
    const b = node('b', [contact('peer-c')]);
    const a = connection('peer-a'); const d = connection('peer-d');
    b.h.connections.set('peer-a', a); b.h.connections.set('peer-d', d);
    b.h.sendLibraryExchange(a); a.send.mockClear();
    vi.setSystemTime(NOW + 1_000);
    b.h.handleLibraryExchange('peer-a', { peers: [{ peerId: 'peer-c', active: true }] });
    expect(a.send).not.toHaveBeenCalled(); expect(d.send).not.toHaveBeenCalled();
    expect(b.mesh.getLibrary().find(p => p.peerId === 'peer-c')?.lastSeenAt).toBe(NOW + 1_000);
  });
});