import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIAL_STALL_MS, RELAY_ROUTE_IDLE_MS, StalledDialTracker, type StalledDialDeps } from '../stalledDials';
import { isRelayableMessage, RelayPresenceThrottle, summarizeCandidatePairs } from '../meshRelayPolicy';
import { MeshRelayLink, MESH_RELAY_CHANNEL, type RelayTransport } from '../meshRelayLink';
import { DEFAULT_ICE_SERVERS } from '../iceServers';
import { createDefaultPeerJSSignalingConfig } from '../peerjs-adapter';
import { StandaloneSwarmMesh } from '../swarmMesh.standalone';
import {
  MANUAL_MAX_ATTEMPTS,
  getManualConnects,
  requestManualConnect,
  resetManualConnects,
  tickManualConnects,
} from '../manualConnect';

// ── Pure tracker ───────────────────────────────────────────────────────

function tracker(connected = new Set<string>()) {
  const onStall = vi.fn();
  const onRouteEnded = vi.fn();
  const deps: StalledDialDeps = {
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    isConnected: (id) => connected.has(id),
    onStall,
    onRouteEnded,
  };
  return { t: new StalledDialTracker(deps), onStall, onRouteEnded, connected };
}

describe('StalledDialTracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never watches a peer that is already connected', () => {
    const { t, onStall, connected } = tracker();
    connected.add('peer-a');
    expect(t.watchNewDial('peer-a')).toBe(false);
    vi.advanceTimersByTime(DIAL_STALL_MS * 3);
    t.noteIceFailed('peer-a');
    expect(onStall).not.toHaveBeenCalled();
    expect(t.isRelayed('peer-a')).toBe(false);
  });

  it('does not fire when the peer connects before the stall window ends', () => {
    const { t, onStall, connected } = tracker();
    t.watchNewDial('peer-a');
    vi.advanceTimersByTime(DIAL_STALL_MS - 1000);
    connected.add('peer-a'); // e.g. a duplicate channel opened meanwhile
    vi.advanceTimersByTime(2000);
    expect(onStall).not.toHaveBeenCalled();
    expect(t.isRelayed('peer-a')).toBe(false);
  });

  it('activates the fallback only after the stall', () => {
    const { t, onStall } = tracker();
    t.watchNewDial('peer-a');
    vi.advanceTimersByTime(DIAL_STALL_MS - 1);
    expect(t.isRelayed('peer-a')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(t.isRelayed('peer-a')).toBe(true);
    expect(onStall).toHaveBeenCalledWith('peer-a', 'timeout');
  });

  it('treats ICE failed as an immediate stall', () => {
    const { t, onStall } = tracker();
    t.watchNewDial('peer-a');
    t.noteIceFailed('peer-a');
    expect(onStall).toHaveBeenCalledWith('peer-a', 'ice-failed');
    vi.advanceTimersByTime(DIAL_STALL_MS);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('drops the relay route when the direct channel opens', () => {
    const { t, onRouteEnded } = tracker();
    t.watchNewDial('peer-a');
    vi.advanceTimersByTime(DIAL_STALL_MS);
    t.noteOpen('peer-a');
    expect(t.isRelayed('peer-a')).toBe(false);
    expect(onRouteEnded).toHaveBeenCalledWith('peer-a', 'direct');
  });

  it('keeps the route when the dial ends without opening, then idles it out', () => {
    const { t, onRouteEnded } = tracker();
    t.watchNewDial('peer-a');
    vi.advanceTimersByTime(DIAL_STALL_MS);
    t.noteDialEnded('peer-a');
    expect(t.isRelayed('peer-a')).toBe(true);
    vi.advanceTimersByTime(RELAY_ROUTE_IDLE_MS + 1);
    expect(t.pruneIdle()).toEqual(['peer-a']);
    expect(onRouteEnded).toHaveBeenCalledWith('peer-a', 'idle');
  });

  it('a dial that ends early is not reported as stalled later', () => {
    const { t, onStall } = tracker();
    t.watchNewDial('peer-a');
    t.noteDialEnded('peer-a');
    vi.advanceTimersByTime(DIAL_STALL_MS * 2);
    expect(onStall).not.toHaveBeenCalled();
  });
});

// ── Relay policy ───────────────────────────────────────────────────────

describe('relay policy', () => {
  it('relays chat, presence and post pushes but never call signaling', () => {
    const sig = (msgType: string) => ({ type: 'channel:webrtc-signal', payload: { msgType } });
    expect(isRelayableMessage(sig('chat-message'))).toBe(true);
    expect(isRelayableMessage(sig('presence'))).toBe(true);
    expect(isRelayableMessage({ type: 'content-push' })).toBe(true);
    expect(isRelayableMessage({ type: 'profile-exchange' })).toBe(true);
    for (const media of ['offer', 'answer', 'ice-candidate', 'media-state', 'screen-share-state']) {
      expect(isRelayableMessage(sig(media))).toBe(false);
    }
    expect(isRelayableMessage({ type: 'chunk-response' })).toBe(false);
    expect(isRelayableMessage({ type: 'channel:chunk' })).toBe(false);
  });

  it('throttles presence per peer and room', () => {
    const th = new RelayPresenceThrottle(2000);
    const p = { type: 'channel:webrtc-signal', payload: { msgType: 'presence', roomId: 'r' } };
    expect(th.allow('peer-a', p, 0)).toBe(true);
    expect(th.allow('peer-a', p, 500)).toBe(false);
    expect(th.allow('peer-b', p, 500)).toBe(true);
    expect(th.allow('peer-a', p, 2000)).toBe(true);
    expect(th.allow('peer-a', { type: 'channel:webrtc-signal', payload: { msgType: 'chat-message' } }, 2001)).toBe(true);
  });

  it('names the failing candidate pair', () => {
    const d = summarizeCandidatePairs([
      { id: 'L1', type: 'local-candidate', candidateType: 'host', protocol: 'udp', address: '192.168.1.10', port: 5000 },
      { id: 'R1', type: 'remote-candidate', candidateType: 'host', protocol: 'udp', address: 'abc.local', port: 6000 },
      { id: 'P1', type: 'candidate-pair', localCandidateId: 'L1', remoteCandidateId: 'R1', state: 'failed', requestsSent: 12, responsesReceived: 0 },
    ], { iceConnectionState: 'checking' });
    expect(d.pairs).toHaveLength(1);
    expect(d.pairs[0].state).toBe('failed');
    expect(d.pairs[0].local?.address).toBe('192.168.1.10');
    expect(d.hint).toMatch(/mDNS/);
  });
});

// ── Shared ICE list ────────────────────────────────────────────────────

describe('PeerJS adapter ICE servers', () => {
  it('uses the shared relay list with the TURN fallback', () => {
    const config = createDefaultPeerJSSignalingConfig();
    expect(config.iceServers).toBe(DEFAULT_ICE_SERVERS);
    const urls = (config.iceServers ?? []).flatMap(s => (Array.isArray(s.urls) ? s.urls : [s.urls]));
    expect(urls.some(u => u.startsWith('turn:'))).toBe(true);
    expect(urls[0].startsWith('stun:')).toBe(true);
  });
});

// ── Mesh integration (mocked PeerJS + mocked Gun transport) ────────────

type Listener = (...args: unknown[]) => void;
class FakeConn {
  open = false;
  metadata = {};
  sent: string[] = [];
  close = vi.fn();
  private listeners = new Map<string, Listener[]>();
  constructor(public peer: string) {}
  on(event: string, fn: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    for (const fn of this.listeners.get(event) ?? []) fn(...args);
  }
  send(raw: string) { this.sent.push(raw); }
}

function mockTransport() {
  const handlers = new Set<(peerId: string, payload: unknown) => void>();
  const transport: RelayTransport & { sent: Array<[string, string, unknown]>; deliver(from: string, raw: string): void } = {
    sent: [],
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    send: vi.fn((channel: string, peerId: string, payload: unknown) => {
      transport.sent.push([channel, peerId, payload]);
      return true;
    }),
    onMessage: (_channel, handler) => { handlers.add(handler); return () => handlers.delete(handler); },
    deliver: (from, raw) => { for (const h of handlers) h(from, raw); },
  };
  return transport;
}

type MeshHarness = {
  phase: string;
  peerId: string;
  peer: unknown;
  connections: Map<string, FakeConn>;
  relayLink: MeshRelayLink;
  dialPeer(id: string, source: string): boolean;
  handleMessage: (from: string, raw: unknown) => void;
  logStalledCandidatePairs: () => Promise<void>;
  watchNewDial(id: string, conn: FakeConn): void;
};

function setupMesh() {
  localStorage.setItem('swarm-mesh-node-id', 'self');
  const mesh = new StandaloneSwarmMesh();
  const h = mesh as unknown as MeshHarness;
  const conns: FakeConn[] = [];
  const connect = vi.fn((id: string) => { const c = new FakeConn(id); conns.push(c); return c; });
  h.phase = 'online';
  h.peerId = 'peer-self';
  h.peer = { destroyed: false, disconnected: false, connect };
  const transport = mockTransport();
  h.relayLink = new MeshRelayLink(async () => transport);
  h.logStalledCandidatePairs = vi.fn(async () => {});
  return { mesh, h, connect, conns, transport };
}

const hello = (from: string, ack = false) => JSON.stringify({ type: 'relay-hello', from, ...(ack ? { ack: true } : {}) });

/** Let the stall fire and the peer answer over the relay. */
async function stallAndAnswer(transport: ReturnType<typeof mockTransport>, peerId: string) {
  await vi.advanceTimersByTimeAsync(DIAL_STALL_MS);
  transport.deliver(peerId, hello(peerId, true));
}

describe('mesh relay fallback', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('relays chat for a stalled new dial without closing or redialing it', async () => {
    const { mesh, h, connect, conns, transport } = setupMesh();
    expect(h.dialPeer('peer-b', 'manual')).toBe(true);
    expect(mesh.isPeerRelayed('peer-b')).toBe(false);

    await vi.advanceTimersByTimeAsync(DIAL_STALL_MS);
    expect(h.logStalledCandidatePairs).toHaveBeenCalled();
    // Knocked over the relay, but not "connected" until they answer.
    expect(transport.sent.some(([, to, raw]) => to === 'peer-b' && String(raw).includes('relay-hello'))).toBe(true);
    expect(mesh.isPeerRelayed('peer-b')).toBe(false);
    transport.deliver('peer-b', hello('peer-b'));
    expect(mesh.isPeerRelayed('peer-b')).toBe(true);
    expect(mesh.getRelayedPeerIds()).toEqual(['peer-b']);
    // A first knock is answered once (ack), so their side confirms too.
    expect(transport.sent.some(([, to, raw]) => to === 'peer-b' && String(raw).includes('"ack":true'))).toBe(true);

    expect(await mesh.send('webrtc-signal', 'peer-b', { msgType: 'chat-message', roomId: 'r', data: 'hi' })).toBe(true);
    expect(transport.sent.at(-1)?.[0]).toBe(MESH_RELAY_CHANNEL);
    expect(transport.sent.at(-1)?.[1]).toBe('peer-b');
    // Calls never go over the relay.
    expect(await mesh.send('webrtc-signal', 'peer-b', { msgType: 'offer', roomId: 'r' })).toBe(false);

    // No extra dials, and the stalled channel is left alone.
    expect(connect).toHaveBeenCalledTimes(1);
    expect(conns[0].close).not.toHaveBeenCalled();
    expect(h.dialPeer('peer-b', 'manual')).toBe(false);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('switches back to direct when the channel opens and drops the relay route', async () => {
    const { mesh, h, conns, transport } = setupMesh();
    const changes: string[][] = [];
    mesh.onRelayChange(ids => changes.push(ids));
    h.dialPeer('peer-b', 'manual');
    await stallAndAnswer(transport, 'peer-b');
    expect(mesh.isPeerRelayed('peer-b')).toBe(true);

    conns[0].open = true;
    conns[0].emit('open');
    expect(mesh.isPeerRelayed('peer-b')).toBe(false);
    expect(changes.at(-1)).toEqual([]);

    const before = transport.sent.length;
    await mesh.send('webrtc-signal', 'peer-b', { msgType: 'chat-message', roomId: 'r' });
    expect(transport.sent.length).toBe(before);
    expect(conns[0].sent.some(raw => raw.includes('chat-message'))).toBe(true);
  });

  it('never watches or relays a peer whose link is already open', async () => {
    const { mesh, h } = setupMesh();
    const live = new FakeConn('peer-b');
    live.open = true;
    h.connections.set('peer-b', live);
    // A duplicate incoming handshake from an already-connected friend.
    h.watchNewDial('peer-b', new FakeConn('peer-b'));
    await vi.advanceTimersByTimeAsync(DIAL_STALL_MS * 4);
    expect(mesh.isPeerRelayed('peer-b')).toBe(false);
    expect(live.close).not.toHaveBeenCalled();
  });

  it('accepts relayed messages only from peers whose handshake stalled with us', async () => {
    const { h, transport } = setupMesh();
    const handled = vi.fn();
    h.handleMessage = handled;
    h.dialPeer('peer-b', 'manual');
    await stallAndAnswer(transport, 'peer-b');

    const chat = JSON.stringify({ type: 'channel:webrtc-signal', payload: { msgType: 'chat-message' }, from: 'peer-b' });
    transport.deliver('peer-b', chat);
    transport.deliver('peer-stranger', chat);
    transport.deliver('peer-b', JSON.stringify({ type: 'chunk-response', from: 'peer-b' }));
    expect(handled).toHaveBeenCalledTimes(1);
    expect(handled).toHaveBeenCalledWith('peer-b', chat);
  });

  it('ICE failure on a new dial starts the relay right away', async () => {
    const { mesh, h, conns, transport } = setupMesh();
    h.dialPeer('peer-b', 'manual');
    conns[0].emit('error', Object.assign(new Error('Negotiation failed'), { type: 'negotiation-failed' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.sent.some(([, to]) => to === 'peer-b')).toBe(true);
    transport.deliver('peer-b', hello('peer-b', true));
    expect(mesh.isPeerRelayed('peer-b')).toBe(true);
  });

  it('never reports an unanswered relay route as connected', async () => {
    const { mesh, h } = setupMesh();
    h.dialPeer('peer-offline', 'manual');
    await vi.advanceTimersByTimeAsync(DIAL_STALL_MS * 3);
    expect(mesh.isPeerRelayed('peer-offline')).toBe(false);
    expect(mesh.getRelayedPeerIds()).toEqual([]);
  });

  it('drops the watch when signaling reports the peer unavailable', async () => {
    const { mesh, h, transport } = setupMesh();
    const handlers = new Map<string, (err: unknown) => void>();
    const peerObj = h.peer as { on?: unknown };
    peerObj.on = (event: string, fn: (err: unknown) => void) => { handlers.set(event, fn); };
    (mesh as unknown as { setupPeerHandlers(p: unknown): void }).setupPeerHandlers(peerObj);
    h.dialPeer('peer-abc123', 'manual');
    handlers.get('error')?.(Object.assign(new Error('Could not connect to peer peer-abc123'), { type: 'peer-unavailable' }));
    await vi.advanceTimersByTimeAsync(DIAL_STALL_MS * 2);
    transport.deliver('peer-abc123', hello('peer-abc123', true));
    expect(mesh.isPeerRelayed('peer-abc123')).toBe(false);
  });
});

// ── Fail toast window ──────────────────────────────────────────────────

describe('manual connect fail window', () => {
  beforeEach(() => resetManualConnects());

  it('fails between 20 and 25 s after one retry', () => {
    const dial = vi.fn(() => true);
    const env = {
      isEnabled: true, isConnecting: false, enable: vi.fn(), selfId: 'peer-self',
      isBlocked: () => false, dial, isConnected: () => false, isNamed: () => false,
    };
    requestManualConnect('peer-host', { now: 0 });
    let failedAt: number | null = null;
    for (let t = 0; t <= 30_000 && failedAt === null; t += 1000) {
      tickManualConnects({ ...env, now: t });
      if (getManualConnects().get('peer-host')?.phase === 'unavailable') failedAt = t;
    }
    expect(MANUAL_MAX_ATTEMPTS).toBe(2);
    expect(dial).toHaveBeenCalledTimes(2);
    expect(failedAt).not.toBeNull();
    expect(failedAt!).toBeGreaterThanOrEqual(20_000);
    expect(failedAt!).toBeLessThanOrEqual(25_000);
  });

  it('a relay route counts as connected for the manual connect', () => {
    const env = {
      isEnabled: true, isConnecting: false, enable: vi.fn(), selfId: 'peer-self',
      isBlocked: () => false, dial: vi.fn(() => true), isConnected: () => true, isNamed: () => true,
    };
    requestManualConnect('peer-host', { now: 0 });
    tickManualConnects({ ...env, now: 0 });
    expect(getManualConnects().get('peer-host')?.phase).toBe('connected');
  });
});
