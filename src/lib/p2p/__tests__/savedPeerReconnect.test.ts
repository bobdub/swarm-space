import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StandaloneSwarmMesh, SAVED_FRIEND_FRESHNESS_WINDOW, type LibraryPeer } from '../swarmMesh.standalone';
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
  it('persists a guest room contact before signaling is ready and reconnects after reload', () => {
    localStorage.setItem('me', JSON.stringify({ _guest: true, guestName: 'Guest Mike' }));
    const { mesh, h } = setup(); h.phase = 'connecting'; h.peer = null;
    expect(mesh.registerPeerConnection('peer-friend')).toBe(false);
    const saved = new StandaloneSwarmMesh().getLibrary();
    expect(saved).toEqual([expect.objectContaining({ peerId: 'peer-friend', source: 'library', lastSeenAt: 1_000_000 })]);
    const restored = setup(saved);
    restored.h.autoConnectLibrary();
    expect(restored.h.dialPeer).toHaveBeenCalledWith('peer-friend', 'library');
  });
  it('promotes a real meeting from gossip to a saved friend without overwriting identity', () => {
    const { mesh } = setup([{ ...contact('exchange'), displayName: 'Friend' }]);
    mesh.registerPeerConnection('peer-exchange');
    expect(mesh.getLibrary()[0]).toMatchObject({ source: 'library', displayName: 'Friend', lastSeenAt: 1_000_000 });
  });
  it('room handoffs preserve cooldowns, pending dials and per-contact opt-outs', () => {
    const { mesh, h } = setup([{ ...contact('exchange'), autoConnect: false }]);
    h.peerCooldowns.set('peer-cooling', 2_000_000);
    h.pendingDials.set('peer-pending', 1_000_000);
    mesh.registerPeerConnection('peer-cooling');
    mesh.registerPeerConnection('peer-pending');
    mesh.registerPeerConnection('peer-exchange');
    expect(h.dialPeer).not.toHaveBeenCalled();
    expect(h.peerCooldowns.get('peer-cooling')).toBe(2_000_000);
    expect(mesh.getLibrary().find(p => p.peerId === 'peer-exchange')?.autoConnect).toBe(false);
  });
  it('room handoffs remember contacts but do not dial when automatic connection is disabled', () => {
    const { mesh, h } = setup(); h.toggles.autoConnect = false;
    mesh.registerPeerConnection('peer-friend');
    expect(mesh.getLibrary()[0].peerId).toBe('peer-friend');
    expect(h.dialPeer).not.toHaveBeenCalled();
  });
  it('room handoffs reject self and blocked peers and respect capacity', () => {
    const { mesh, h } = setup(); mesh.blockPeer('peer-blocked');
    mesh.registerPeerConnection('peer-self'); mesh.registerPeerConnection('peer-blocked');
    expect(mesh.getLibrary()).toEqual([]);
    for (let i = 0; i < 20; i++) h.connections.set(`peer-live-${i}`, {});
    mesh.registerPeerConnection('peer-friend');
    expect(h.dialPeer).not.toHaveBeenCalled();
  });
  it('uses a 10-minute presence window for saved friends', () => {
    expect(SAVED_FRIEND_FRESHNESS_WINDOW).toBe(600_000);
  });
  it('the drop redial never reaches saved friends absent beyond the window', () => {
    const { h } = setup([contact('manual', 399_999), contact('library', 1)]);
    h.autoConnectLibrary();
    expect(h.dialPeer).not.toHaveBeenCalled();
  });
  it('rejoins saved friends absent beyond the window only with backoff, not a redial storm', () => {
    const { h } = setup([contact('manual', 399_999), contact('library', 1)]);
    h.startLibraryReconnectLoop(); vi.advanceTimersByTime(10 * 60_000); h.stopLibraryReconnectLoop();
    const perPeer = (id: string) => h.dialPeer.mock.calls.filter(call => call[0] === id).length;
    // 20 reconnect ticks, but backoff (30 s, 1, 2, 4 min…) allows only a handful of tries each.
    expect(perPeer('peer-manual')).toBeGreaterThan(0);
    expect(perPeer('peer-manual')).toBeLessThanOrEqual(5);
    expect(perPeer('peer-library')).toBeLessThanOrEqual(5);
  });
  it('does not stack a second dial while one to the same peer is in flight', () => {
    const { mesh, h } = setup();
    h.pendingDials.set('peer-host', 1_000_000);
    expect(mesh.connectToPeer('host')).toBe(true);
    expect(h.dialPeer).not.toHaveBeenCalled();
    expect(h.pendingDials.get('peer-host')).toBe(1_000_000);
  });
  it.each(['initial', 'periodic'])('retries recently seen saved friends, not stale gossip, on %s pass', pass => {
    const { h } = setup([contact('manual', 700_000), contact('library', 700_000), contact('exchange', 700_000)]);
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
    const { h } = setup([contact('manual', 900_000), contact('library', 900_000), { ...contact('exchange', 1_000_000), autoConnect: false }]);
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
  it('keeps STUN first and the community TURN relay as last-resort fallback', () => {
    const urls = DEFAULT_ICE_SERVERS.flatMap(s => typeof s.urls === 'string' ? [s.urls] : s.urls);
    expect(urls.slice(0, 2)).toEqual(['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']);
    expect(urls.slice(2).every(u => u.startsWith('turn:openrelay.metered.ca'))).toBe(true);
  });
});