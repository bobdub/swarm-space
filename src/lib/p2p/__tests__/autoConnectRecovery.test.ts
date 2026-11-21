import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StandaloneSwarmMesh, FAILED_RECONNECT_RETRY_MS } from '../swarmMesh.standalone';

vi.mock('../globalCell', () => ({ getGlobalCell: () => ({ sendInviteKnock: vi.fn(), pulsePresence: vi.fn(), getKnownPeers: () => [] }) }));

type Handler = (...args: unknown[]) => void;
class FakeConn {
  open = false;
  closed = false;
  handlers = new Map<string, Handler[]>();
  metadata = {};
  constructor(public peer: string) {}
  on(event: string, fn: Handler) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]); return this; }
  emit(event: string, ...args: unknown[]) { for (const fn of this.handlers.get(event) ?? []) fn(...args); }
  send() { /* ignore */ }
  close() { if (this.closed) return; this.closed = true; this.open = false; this.emit('close'); }
  fireOpen() { this.open = true; this.emit('open'); }
}

type Harness = Record<string, any>;

function setup(selfId: string) {
  localStorage.setItem('swarm-mesh-node-id', selfId.replace(/^peer-/, ''));
  const mesh = new StandaloneSwarmMesh();
  const h = mesh as unknown as Harness;
  h.peerId = selfId;
  h.phase = 'online';
  h.flags.enabled = true;
  h.toggles.autoConnect = true;
  for (const name of [
    'sendLifecycleState', 'sendContentInventory', 'drainPendingAssetQueue', 'sendProfileExchange',
    'sendLibraryExchange', 'rebroadcastLibrary', 'sendNeuralDigest', 'expandOnlineMesh',
    'scheduleMeshExpansion', 'pulseGlobalPresence', 'schedulePresencePulse', 'recordCellDiagnostic',
    'emitAlert', 'startMiningLoop', 'noteDroppedPeer',
  ]) h[name] = vi.fn();
  return { mesh, h };
}

/** Wire one outgoing and one incoming channel to the same remote peer. */
function simultaneousDial(h: Harness, remote: string) {
  const outgoing = new FakeConn(remote);
  const incoming = new FakeConn(remote);
  h.outgoingChannels.add(outgoing);
  h.handleConnection(outgoing, 'exchange');
  h.handleConnection(incoming, 'exchange');
  return { outgoing, incoming };
}

describe('simultaneous dials keep one agreed channel', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('the lower peer keeps its own outgoing channel even when the incoming one opened first', () => {
    const { h } = setup('peer-aaa');
    const { outgoing, incoming } = simultaneousDial(h, 'peer-bbb');
    incoming.fireOpen();
    outgoing.fireOpen();
    expect(h.connections.get('peer-bbb')).toBe(outgoing);
    expect(incoming.closed).toBe(true);
    expect(outgoing.closed).toBe(false);
    expect(h.noteDroppedPeer).not.toHaveBeenCalled();
  });

  it('the higher peer keeps the incoming channel even when its own opened first', () => {
    const { h } = setup('peer-bbb');
    const { outgoing, incoming } = simultaneousDial(h, 'peer-aaa');
    outgoing.fireOpen();
    incoming.fireOpen();
    expect(h.connections.get('peer-aaa')).toBe(incoming);
    expect(outgoing.closed).toBe(true);
    expect(h.noteDroppedPeer).not.toHaveBeenCalled();
  });

  it('both sides pick the same channel whatever order they see', () => {
    // Side A (lower) keeps its outgoing; side B (higher) keeps its incoming,
    // which is the same physical channel A opened.
    const a = setup('peer-aaa').h;
    const b = setup('peer-bbb').h;
    const aDials = simultaneousDial(a, 'peer-bbb');
    const bDials = simultaneousDial(b, 'peer-aaa');
    aDials.outgoing.fireOpen(); aDials.incoming.fireOpen();
    bDials.outgoing.fireOpen(); bDials.incoming.fireOpen();
    expect(a.connections.get('peer-bbb')).toBe(aDials.outgoing); // A→B
    expect(b.connections.get('peer-aaa')).toBe(bDials.incoming); // A→B seen from B
  });

  it('a lone later duplicate from the non-preferred side is dropped', () => {
    const { h } = setup('peer-aaa');
    const first = new FakeConn('peer-bbb');
    h.outgoingChannels.add(first);
    h.handleConnection(first, 'exchange');
    first.fireOpen();
    const late = new FakeConn('peer-bbb');
    h.handleConnection(late, 'exchange');
    late.fireOpen();
    expect(h.connections.get('peer-bbb')).toBe(first);
    expect(late.closed).toBe(true);
  });
});

describe('signaling loss keeps the mesh', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  function withPeer() {
    const { h } = setup('peer-self');
    const peer = { destroyed: false, disconnected: false, open: true, reconnect: vi.fn(), destroy: vi.fn() };
    h.peer = peer;
    h.scheduleReconnect = vi.fn();
    const live = new FakeConn('peer-friend'); live.open = true;
    h.connections.set('peer-friend', live);
    return { h, peer, live };
  }

  it('reconnects the socket in place and keeps live channels', () => {
    const { h, peer, live } = withPeer();
    h.handleLost(); // PeerJS emits the network error before marking disconnected
    peer.disconnected = true; peer.open = false;
    vi.advanceTimersByTime(1_500);
    expect(peer.reconnect).toHaveBeenCalledTimes(1);
    expect(peer.destroy).not.toHaveBeenCalled();
    expect(h.phase).toBe('online');
    peer.disconnected = false; peer.open = true;
    h.finishSignalingRecovery();
    expect(h.connections.get('peer-friend')).toBe(live);
    expect(h.scheduleReconnect).not.toHaveBeenCalled();
    expect(h.pulseGlobalPresence).toHaveBeenCalledWith('signaling-recovered');
    vi.advanceTimersByTime(60_000);
    expect(peer.reconnect).toHaveBeenCalledTimes(1);
  });

  it('falls back to a full reconnect when the socket never returns', () => {
    const { h, peer } = withPeer();
    h.handleLost();
    peer.disconnected = true; peer.open = false;
    vi.advanceTimersByTime(1_500 + 5_000 * 4);
    expect(peer.reconnect).toHaveBeenCalledTimes(4);
    expect(h.scheduleReconnect).toHaveBeenCalledTimes(1);
  });

  it('queues a manual dial made while the socket is down and sends it on recovery', () => {
    const { h, peer } = withPeer();
    h.connectToPeer = StandaloneSwarmMesh.prototype.connectToPeer.bind(h);
    h.dialPeer = vi.fn(() => true);
    h.handleLost();
    peer.disconnected = true; peer.open = false;
    vi.advanceTimersByTime(1_500);
    expect(h.connectToPeer('peer-target')).toBe(true);
    expect(h.dialPeer).not.toHaveBeenCalled();
    expect(h.queuedManualDials.has('peer-target')).toBe(true);
    peer.disconnected = false; peer.open = true;
    h.finishSignalingRecovery();
    expect(h.dialPeer).toHaveBeenCalledWith('peer-target', 'manual');
  });

  it('does not dial new peers while the socket is down', () => {
    const { h, peer } = withPeer();
    peer.disconnected = true;
    expect(h.dialPeer('peer-new', 'exchange')).toBe(false);
  });
});

describe('the mesh never gives up on its own', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('stays enabled after the fast reconnects and retries slowly', () => {
    const { h } = setup('peer-self');
    h.connectSignaling = vi.fn(async () => {});
    h.reconnectAttempt = 3;
    h.scheduleReconnect();
    expect(h.phase).toBe('failed');
    expect(h.flags.enabled).toBe(true);
    vi.advanceTimersByTime(FAILED_RECONNECT_RETRY_MS - 1);
    expect(h.connectSignaling).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.connectSignaling).toHaveBeenCalledTimes(1);
    expect(h.reconnectAttempt).toBe(0);
  });

  it('retries immediately when the network comes back', () => {
    const { h } = setup('peer-self');
    h.connectSignaling = vi.fn(async () => {});
    h.reconnectAttempt = 3;
    h.scheduleReconnect();
    window.dispatchEvent(new Event('online'));
    expect(h.connectSignaling).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FAILED_RECONNECT_RETRY_MS);
    expect(h.connectSignaling).toHaveBeenCalledTimes(1);
  });
});

describe('the Auto-connect switch', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('stops the cascade when off and dials again when turned back on', async () => {
    localStorage.setItem('swarm-mesh-connection-library', JSON.stringify([
      { peerId: 'peer-fresh', nodeId: 'fresh', alias: 'fresh', source: 'exchange', autoConnect: true, lastSeenAt: 999_000, addedAt: 1 },
    ]));
    const { mesh, h } = setup('peer-self');
    h.peer = { destroyed: false, disconnected: false };
    h.dialPeer = vi.fn(() => true);
    h.waitForConnection = vi.fn(async () => true);
    h.toggles.autoConnect = false;
    await h.cascadeConnect();
    expect(h.dialPeer).not.toHaveBeenCalled();
    mesh.setToggle('autoConnect', true);
    await Promise.resolve();
    expect(h.dialPeer).toHaveBeenCalledWith('peer-fresh', 'exchange');
  });
});

describe('known peers rejoin without a presence beacon', () => {
  const HOUR = 60 * 60_000;
  const T0 = 100 * 24 * HOUR;
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(T0); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  const entry = (id: string, extra: Record<string, unknown>) => ({
    peerId: id, nodeId: id.replace('peer-', ''), alias: id, addedAt: 1, autoConnect: true,
    source: 'exchange', lastSeenAt: T0 - 5 * HOUR, ...extra,
  });

  function withLibrary(entries: unknown[]) {
    localStorage.setItem('swarm-mesh-connection-library', JSON.stringify(entries));
    const { mesh, h } = setup('peer-self');
    h.peer = { destroyed: false, disconnected: false };
    h.dialPeer = vi.fn(() => true);
    return { mesh, h };
  }

  it('dials a friend met hours ago, but not stale gossip strangers', () => {
    const { h } = withLibrary([
      entry('peer-friend', { lastConnectedAt: T0 - 5 * HOUR }),
      entry('peer-stranger', { lastSeenAt: T0 - 60_000 }), // fresher, but never connected
      entry('peer-saved', { source: 'library', lastSeenAt: T0 - 3 * HOUR }), // legacy saved entry
    ]);
    h.rejoinKnownPeers('online');
    const targets = h.dialPeer.mock.calls.map((c: unknown[]) => c[0]);
    expect(targets).toEqual(['peer-saved', 'peer-friend']);
  });

  it('leaves friends unseen beyond the horizon, blocked or with Auto-connect off', () => {
    const { mesh, h } = withLibrary([
      entry('peer-old', { lastConnectedAt: T0 - 40 * 24 * HOUR }),
      entry('peer-blocked', { lastConnectedAt: T0 - HOUR }),
      entry('peer-optout', { lastConnectedAt: T0 - HOUR, autoConnect: false }),
    ]);
    mesh.blockPeer('peer-blocked');
    h.rejoinKnownPeers('online');
    expect(h.dialPeer).not.toHaveBeenCalled();
    h.library.set('peer-friend', entry('peer-friend', { lastConnectedAt: T0 - HOUR }));
    h.toggles.autoConnect = false;
    h.rejoinKnownPeers('online');
    expect(h.dialPeer).not.toHaveBeenCalled();
  });

  it('backs off while the friend is offline and starts over once they connect', () => {
    const { h } = withLibrary([entry('peer-friend', { lastConnectedAt: T0 - HOUR })]);
    const tries = () => h.dialPeer.mock.calls.length;
    h.rejoinKnownPeers('online');
    expect(tries()).toBe(1);
    h.rejoinKnownPeers('tick');
    expect(tries()).toBe(1); // within the 30 s backoff
    vi.advanceTimersByTime(30_000); h.rejoinKnownPeers('tick');
    expect(tries()).toBe(2);
    vi.advanceTimersByTime(30_000); h.rejoinKnownPeers('tick');
    expect(tries()).toBe(2); // next wait is 1 min
    vi.advanceTimersByTime(30_000); h.rejoinKnownPeers('tick');
    expect(tries()).toBe(3);

    // The friend comes online and the channel opens: it is stamped and the backoff resets.
    const conn = new FakeConn('peer-friend');
    h.handleConnection(conn, 'library');
    conn.fireOpen();
    expect(h.library.get('peer-friend').lastConnectedAt).toBe(Date.now());
    expect(h.knownPeerRejoin.has('peer-friend')).toBe(false);
  });

  it('stamps lastConnectedAt on a first connection so the peer is known next time', () => {
    const { h } = withLibrary([]);
    const conn = new FakeConn('peer-new');
    h.handleConnection(conn, 'exchange');
    conn.fireOpen();
    expect(h.library.get('peer-new')).toMatchObject({ source: 'exchange', lastConnectedAt: T0 });
  });

  it('two friends opening the Brain minutes apart connect without Gun', () => {
    // A is online first; its startup dial to B fails because B is not there yet.
    const a = withLibrary([entry('peer-bbb', { lastConnectedAt: T0 - 2 * HOUR })]).h;
    a.rejoinKnownPeers('online');
    expect(a.dialPeer).toHaveBeenCalledWith('peer-bbb', 'library');
    // B opens two minutes later: its startup rejoin dials A straight away.
    vi.advanceTimersByTime(2 * 60_000);
    const b = withLibrary([entry('peer-aaa', { lastConnectedAt: T0 - 2 * HOUR })]).h;
    b.rejoinKnownPeers('online');
    expect(b.dialPeer).toHaveBeenCalledWith('peer-aaa', 'library');
  });
});
