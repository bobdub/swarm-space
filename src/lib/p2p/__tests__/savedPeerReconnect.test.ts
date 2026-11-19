import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StandaloneSwarmMesh, type LibraryPeer } from '../swarmMesh.standalone';
import { DEFAULT_ICE_SERVERS } from '../iceServers';

vi.mock('../globalCell', () => ({ getGlobalCell: () => ({ sendInviteKnock: vi.fn() }) }));

type Harness = {
  peerId: string;
  phase: string;
  flags: { enabled: boolean };
  toggles: { autoConnect: boolean };
  peer: { destroyed: boolean } | null;
  connections: Map<string, unknown>;
  peerCooldowns: Map<string, number>;
  pendingDials: Map<string, number>;
  dialPeer: ReturnType<typeof vi.fn>;
  pulseGlobalPresence: ReturnType<typeof vi.fn>;
  autoConnectLibrary(): void;
  startLibraryReconnectLoop(): void;
  stopLibraryReconnectLoop(): void;
};
const contact = (source: LibraryPeer['source'], lastSeenAt = 1): LibraryPeer => ({
  peerId: `peer-${source}`, nodeId: source, alias: source,
  source, autoConnect: true, lastSeenAt, addedAt: 1,
});
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
describe('durable targeted connections and bounded reconnection', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it.each(['connecting', 'reconnecting', 'off'])('saves a manual target immediately while %s', phase => {
    const { mesh, h } = setup(); h.phase = phase; h.peer = null;
    mesh.connectToPeer('target');
    const restored = new StandaloneSwarmMesh();
    expect(restored.getLibrary()).toEqual([expect.objectContaining({
      peerId: 'peer-target', source: 'manual', autoConnect: true, lastSeenAt: 1_000_000,
    })]);
    expect(h.dialPeer).not.toHaveBeenCalled();
  });
  it('promotes an already connected discovered peer and preserves their profile', () => {
    const { mesh, h } = setup([{ ...contact('exchange'), autoConnect: false, displayName: 'Friend' }]);
    h.connections.set('peer-exchange', {});
    mesh.connectToPeer('peer-exchange');
    expect(mesh.getLibrary()[0]).toMatchObject({ source: 'manual', autoConnect: true, displayName: 'Friend', lastSeenAt: 1_000_000 });
    expect(new StandaloneSwarmMesh().getLibrary()[0].source).toBe('manual');
    expect(h.dialPeer).not.toHaveBeenCalled();
  });
  it('does not save self or blocked targets', () => {
    const { mesh } = setup(); mesh.blockPeer('peer-blocked');
    mesh.connectToPeer('self'); mesh.connectToPeer('blocked');
    expect(mesh.getLibrary()).toEqual([]);
  });
  it('saves Brain bus targets before warming-up checks without clearing backoff', () => {
    const { mesh, h } = setup(); h.phase = 'connecting'; h.peer = null;
    h.peerCooldowns.set('peer-room', 2_000_000);
    expect(mesh.dialViaBus('peer-room', 'manual')).toBe(false);
    expect(new StandaloneSwarmMesh().getLibrary()[0]).toMatchObject({ peerId: 'peer-room', source: 'manual', lastSeenAt: 1_000_000 });
    h.phase = 'online'; h.peer = { destroyed: false };
    expect(mesh.dialViaBus('peer-room', 'manual')).toBe(false);
    expect(h.peerCooldowns.get('peer-room')).toBe(2_000_000);
    expect(h.dialPeer).not.toHaveBeenCalled();
  });
  it('does not promote random bus discovery into a saved friend', () => {
    const { mesh } = setup([contact('exchange')]);
    mesh.dialViaBus('peer-exchange');
    expect(mesh.getLibrary()[0].source).toBe('exchange');
  });
  it.each(['initial', 'periodic'])('retries stale saved friends, not stale gossip, on %s pass', pass => {
    const { h } = setup([contact('manual'), contact('library'), contact('exchange')]);
    if (pass === 'initial') h.autoConnectLibrary();
    else { h.startLibraryReconnectLoop(); vi.advanceTimersByTime(60_000); h.stopLibraryReconnectLoop(); }
    const targets = h.dialPeer.mock.calls.map(call => call[0]);
    expect(targets).toContain('peer-manual'); expect(targets).toContain('peer-library');
    expect(targets).not.toContain('peer-exchange');
  });
  it('enforces the 75-second discovery boundary', () => {
    const { h } = setup([contact('exchange', 925_000)]);
    h.autoConnectLibrary(); expect(h.dialPeer).not.toHaveBeenCalled();
    const fresh = setup([contact('exchange', 925_001)]);
    fresh.h.autoConnectLibrary(); expect(fresh.h.dialPeer).toHaveBeenCalledWith('peer-exchange', 'exchange');
  });
  it.each(['initial', 'periodic'])('keeps cooldown, pending-dial and disabled-contact gates on %s pass', pass => {
    const { h } = setup([contact('manual'), contact('library'), { ...contact('exchange', 1_000_000), autoConnect: false }]);
    h.peerCooldowns.set('peer-manual', 2_000_000); h.pendingDials.set('peer-library', 1_000_000);
    if (pass === 'initial') h.autoConnectLibrary();
    else {
      h.startLibraryReconnectLoop();
      vi.advanceTimersByTime(15_000);
      h.pendingDials.set('peer-library', Date.now());
      vi.advanceTimersByTime(15_000);
      h.stopLibraryReconnectLoop();
    }
    expect(h.dialPeer).not.toHaveBeenCalled();
  });
  it('removes the dead default TURN service without substituting a new public service', () => {
    expect(DEFAULT_ICE_SERVERS.flatMap(s => typeof s.urls === 'string' ? [s.urls] : s.urls)).toEqual([
      'stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302',
    ]);
  });
});