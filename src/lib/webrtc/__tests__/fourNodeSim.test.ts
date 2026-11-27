import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Four-person room simulation. Each node gets its own copy of the signaling
// bridge, room graph and call manager, wired through an in-memory mesh and an
// in-memory stand-in for the Gun relays (the real relays are bot-protected,
// so they are never reached from tests).

type Handler = (from: string, payload: unknown) => void;
const nodes = new Map<string, { handler: Handler | null; edges: Set<string> }>();

function makeMesh(id: string) {
  nodes.set(id, { handler: null, edges: new Set() });
  const me = () => nodes.get(id)!;
  const deliver = (to: string, payload: unknown) => {
    const copy = JSON.parse(JSON.stringify(payload));
    setTimeout(() => nodes.get(to)?.handler?.(id, copy), 5);
  };
  return {
    broadcast: (_c: string, payload: unknown) => { for (const to of me().edges) deliver(to, payload); },
    send: async (_c: string, to: string, payload: unknown) => {
      if (!me().edges.has(to)) return false;
      deliver(to, payload);
      return true;
    },
    onMessage: (c: string, h: Handler) => { if (c !== 'webrtc-signal') return () => {}; me().handler = h; return () => { me().handler = null; }; },
    getConnectedPeerIds: () => Array.from(me().edges),
    getPeerId: () => id,
    dialViaBus: () => false,
  };
}
function link(a: string, b: string) { nodes.get(a)!.edges.add(b); nodes.get(b)!.edges.add(a); }
function unlinkAll(id: string) {
  for (const other of nodes.get(id)?.edges ?? []) nodes.get(other)?.edges.delete(id);
  nodes.get(id)?.edges.clear();
}

// ── In-memory Gun graph ────────────────────────────────────────────────
type GunListener = { owner: string; channel: string; h: Handler };
const gunGraph = new Map<string, Set<GunListener>>();
const gunSlots = new Map<string, { from: string; channel: string; payload: unknown }>();
let gunUp = true;
let gunWrites = 0;
const gunDelivered: Array<{ key: string; payload: string }> = [];

function gunPublish(key: string, from: string, channel: string, payload: unknown) {
  if (!gunUp) return;
  gunWrites++;
  for (const l of gunGraph.get(key) ?? []) {
    if (l.owner === from || l.channel !== channel) continue;
    setTimeout(() => {
      if (typeof payload === 'string') gunDelivered.push({ key, payload });
      l.h(from, payload);
    }, 40);
  }
}

function mockGunFactory(opts: { graphKey: string; inbox?: boolean }) {
  let local = '';
  let listenKey = '';
  const mine = new Set<GunListener>();
  return Promise.resolve({
    async start({ peerId }: { peerId: string }) {
      local = peerId;
      listenKey = opts.inbox ? `${opts.graphKey}/${peerId}` : opts.graphKey;
    },
    stop() {
      for (const l of mine) gunGraph.get(listenKey)?.delete(l);
      mine.clear();
    },
    send(channel: string, to: string, payload: unknown) {
      gunPublish(opts.inbox ? `${opts.graphKey}/${to}` : opts.graphKey, local, channel, payload);
      return gunUp;
    },
    broadcastToAll(channel: string, payload: unknown) {
      // Registry slot: Gun keeps the latest write and replays it to late subscribers.
      if (gunUp) gunSlots.set(`${opts.graphKey}|${local}`, { from: local, channel, payload });
      gunPublish(opts.graphKey, local, channel, payload);
      return gunUp;
    },
    onMessage(channel: string, h: Handler) {
      const l = { owner: local, channel, h };
      if (!gunGraph.has(listenKey)) gunGraph.set(listenKey, new Set());
      gunGraph.get(listenKey)!.add(l);
      mine.add(l);
      for (const [slot, w] of gunSlots) {
        if (!slot.startsWith(`${listenKey}|`) || w.from === local || w.channel !== channel) continue;
        setTimeout(() => { if (gunUp) h(w.from, w.payload); }, 40);
      }
      return () => { gunGraph.get(listenKey)?.delete(l); mine.delete(l); };
    },
  });
}

// ── Fake RTCPeerConnection ─────────────────────────────────────────────
let pcSeq = 0;
class FakePC {
  id = ++pcSeq;
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState = 'new';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  currentRemoteDescription: RTCSessionDescriptionInit | null = null;
  currentLocalDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  ontrack: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: unknown = null;
  onnegotiationneeded: unknown = null;
  onsignalingstatechange: (() => void) | null = null;
  offers = 0;
  closed = false;
  /** Inbound audio packets; grows while connected unless `silent`. */
  packets = 0;
  silent = false;
  addTransceiver = vi.fn(() => ({ sender: { track: null, replaceTrack: async () => {} }, receiver: { track: null }, mid: null }));
  getSenders = vi.fn(() => [] as RTCRtpSender[]);
  getReceivers = vi.fn(() => [{ track: { readyState: 'live', kind: 'audio' } }] as unknown as RTCRtpReceiver[]);
  getTransceivers = vi.fn(() => [] as RTCRtpTransceiver[]);
  addTrack = vi.fn();
  removeTrack = vi.fn();
  addIceCandidate = vi.fn(async () => {});
  close = () => { this.closed = true; this.connectionState = 'closed'; };
  async getStats() {
    if (this.connectionState === 'connected' && !this.silent) this.packets += 400;
    return new Map([['in-a', { type: 'inbound-rtp', kind: 'audio', packetsReceived: this.packets }]]);
  }
  sdp(type: string) { return `${type}\na=fingerprint:sha-256 FP${this.id}\n`; }
  async createOffer() { this.offers++; return { type: 'offer' as RTCSdpType, sdp: this.sdp('offer') }; }
  async createAnswer() { return { type: 'answer' as RTCSdpType, sdp: this.sdp('answer') }; }
  private settle() {
    this.onsignalingstatechange?.();
    if (this.signalingState === 'stable' && this.localDescription && this.remoteDescription) {
      this.currentLocalDescription = this.localDescription;
      this.currentRemoteDescription = this.remoteDescription;
      if (this.connectionState !== 'connected' && !this.closed) {
        this.connectionState = 'connected';
        this.onconnectionstatechange?.();
      }
    }
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    if (d.type === 'rollback') { this.signalingState = 'stable'; this.settle(); return; }
    this.localDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
    // Two ICE candidates in the same millisecond, like a real browser.
    if (d.type === 'offer' || d.type === 'answer') {
      this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: `c1-${this.id}` }) } });
      this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: `c2-${this.id}` }) } });
    }
    this.settle();
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
    this.settle();
  }
}

const allPcs: FakePC[] = [];

beforeEach(() => {
  nodes.clear(); allPcs.length = 0; gunGraph.clear(); gunSlots.clear(); gunUp = true; gunWrites = 0; gunDelivered.length = 0;
  vi.useFakeTimers();
  // @ts-expect-error fake
  globalThis.RTCPeerConnection = class extends FakePC { constructor() { super(); allPcs.push(this); } };
  // @ts-expect-error shim
  globalThis.RTCSessionDescription = function (init: RTCSessionDescriptionInit) { return init; };
  // @ts-expect-error shim
  globalThis.RTCIceCandidate = function (init: RTCIceCandidateInit) { return init; };
});
afterEach(() => { vi.useRealTimers(); });

type SimNode = Awaited<ReturnType<typeof makeNode>>;

async function makeNode(id: string, opts: { gun?: boolean } = {}) {
  vi.resetModules();
  const bridge = await import('@/lib/streaming/webrtcSignalingBridge.standalone');
  const graph = await import('@/lib/streaming/roomGraph');
  graph.setRoomGraphTransportFactory(opts.gun ? (o) => mockGunFactory(o) as never : null);
  const { WebRTCManager } = await import('../manager');
  const mesh = makeMesh(id);
  bridge.startSignalingBridge(mesh as never);
  const m = new WebRTCManager(`user-${id}`, id);
  return { id, bridge, graph, m };
}

function pcsOf(n: SimNode): Map<string, FakePC> {
  return (n.m as unknown as { connections: Map<string, FakePC> }).connections;
}

function pairStates(list: SimNode[]): string[] {
  const out: string[] = [];
  for (const a of list) for (const b of list) {
    if (a.id >= b.id) continue;
    out.push(`${a.id}-${b.id}:${pcsOf(a).get(b.id)?.connectionState ?? 'none'}/${pcsOf(b).get(a.id)?.connectionState ?? 'none'}`);
  }
  return out;
}

function expectFullWeb(list: SimNode[]) {
  const states = pairStates(list);
  expect(states.every(s => s.endsWith(':connected/connected'))).toBe(true);
  // Every pair, never fewer: 4 people means 6 calls.
  expect(states).toHaveLength((list.length * (list.length - 1)) / 2);
}

function remoteCandidates(n: SimNode, from: string): number {
  return (pcsOf(n).get(from)?.addIceCandidate.mock.calls.length ?? 0);
}

describe('four people in a line (A-B-C-D)', () => {
  it('simultaneous joins: all 6 pairs connect, even A and D three hops apart', async () => {
    const [A, B, C, D] = [await makeNode('A'), await makeNode('B'), await makeNode('C'), await makeNode('D')];
    link('A', 'B'); link('B', 'C'); link('C', 'D');
    await Promise.all([A, B, C, D].map(n => n.m.joinRoom('brain')));
    await vi.advanceTimersByTimeAsync(30_000);
    console.log('LINE-SIM', pairStates([A, B, C, D]).join(' '));
    expectFullWeb([A, B, C, D]);
    // Both same-millisecond candidates arrived (the old dedup key dropped one).
    expect(remoteCandidates(A, 'D')).toBeGreaterThanOrEqual(2);
    expect(remoteCandidates(D, 'A')).toBeGreaterThanOrEqual(2);
  });

  it('staggered joins: each newcomer reaches everyone already in the room', async () => {
    const [A, B, C, D] = [await makeNode('A'), await makeNode('B'), await makeNode('C'), await makeNode('D')];
    link('A', 'B'); link('B', 'C'); link('C', 'D');
    for (const n of [A, B, C, D]) {
      await n.m.joinRoom('brain');
      await vi.advanceTimersByTimeAsync(6_000);
    }
    await vi.advanceTimersByTimeAsync(20_000);
    console.log('STAGGER-SIM', pairStates([A, B, C, D]).join(' '));
    expectFullWeb([A, B, C, D]);
  });

  it('one person refreshing reconnects to all three without touching the other calls', async () => {
    const [A, B, C, D] = [await makeNode('A'), await makeNode('B'), await makeNode('C'), await makeNode('D')];
    link('A', 'B'); link('B', 'C'); link('C', 'D');
    await Promise.all([A, B, C, D].map(n => n.m.joinRoom('brain')));
    await vi.advanceTimersByTimeAsync(30_000);
    expectFullWeb([A, B, C, D]);

    const kept = { ab: pcsOf(A).get('B')!, ac: pcsOf(A).get('C')!, bc: pcsOf(B).get('C')! };
    const offersBefore = Object.values(kept).map(pc => pc.offers);

    // D refreshes: the old page says goodbye, a new page gets a new peer ID.
    await D.m.leaveRoom();
    await vi.advanceTimersByTimeAsync(1_000);
    unlinkAll('D');
    const D2 = await makeNode('D2');
    link('C', 'D2');
    await D2.m.joinRoom('brain');
    await vi.advanceTimersByTimeAsync(30_000);

    console.log('REFRESH-SIM', pairStates([A, B, C, D2]).join(' '));
    expectFullWeb([A, B, C, D2]);
    expect(pcsOf(A).get('B')).toBe(kept.ab);
    expect(pcsOf(A).get('C')).toBe(kept.ac);
    expect(pcsOf(B).get('C')).toBe(kept.bc);
    expect(Object.values(kept).map(pc => pc.offers)).toEqual(offersBefore);
    expect(Object.values(kept).some(pc => pc.closed)).toBe(false);
    expect(pcsOf(A).has('D')).toBe(false);
  });
});

describe('Gun room graph (web closure and signaling inbox)', () => {
  it('connects two mesh islands (A-B and C-D) through the room graph alone', async () => {
    const [A, B, C, D] = [
      await makeNode('A', { gun: true }), await makeNode('B', { gun: true }),
      await makeNode('C', { gun: true }), await makeNode('D', { gun: true }),
    ];
    link('A', 'B'); link('C', 'D'); // no mesh path between the islands
    await Promise.all([A, B, C, D].map(n => n.m.joinRoom('brain')));
    await vi.advanceTimersByTimeAsync(40_000);
    console.log('ISLANDS-SIM', pairStates([A, B, C, D]).join(' '));
    expectFullWeb([A, B, C, D]);
    expect(A.graph.getRoomGraphPeers('brain').sort()).toEqual(['B', 'C', 'D']);
    // Only short setup strings crossed Gun: presence, SDP and ICE.
    for (const { payload } of gunDelivered) {
      expect(payload.length).toBeLessThan(4_000);
      const parsed = JSON.parse(payload) as { msgType?: string };
      if (parsed.msgType) expect(['offer', 'answer', 'candidate', 'reconnect-request', 'reconnect-ack']).toContain(parsed.msgType);
    }
  });

  it('only the lower peer ID dials a graph-discovered member, so the pair never glares', async () => {
    const [A, D] = [await makeNode('A', { gun: true }), await makeNode('D', { gun: true })];
    await Promise.all([A, D].map(n => n.m.joinRoom('brain')));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pairStates([A, D])).toEqual(['A-D:connected/connected']);
    expect(pcsOf(A).get('D')!.offers).toBe(1);
    expect(pcsOf(D).get('A')!.offers).toBe(0);
  });

  it('a pair that already has a mesh link sends no setup through Gun', async () => {
    const [A, B] = [await makeNode('A', { gun: true }), await makeNode('B', { gun: true })];
    link('A', 'B');
    await Promise.all([A, B].map(n => n.m.joinRoom('brain')));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pairStates([A, B])).toEqual(['A-B:connected/connected']);
    expect(gunDelivered.some(d => d.key.includes('/inbox/'))).toBe(false);
  });

  it('a Gun outage leaves calls that already work untouched', async () => {
    const [A, B, C, D] = [
      await makeNode('A', { gun: true }), await makeNode('B', { gun: true }),
      await makeNode('C', { gun: true }), await makeNode('D', { gun: true }),
    ];
    link('A', 'B'); link('B', 'C'); link('C', 'D');
    await Promise.all([A, B, C, D].map(n => n.m.joinRoom('brain')));
    await vi.advanceTimersByTimeAsync(30_000);
    expectFullWeb([A, B, C, D]);
    const pcs = [A, B, C, D].flatMap(n => [...pcsOf(n).values()]);
    const offers = pcs.map(pc => pc.offers);
    gunUp = false;
    await vi.advanceTimersByTimeAsync(90_000);
    expectFullWeb([A, B, C, D]);
    expect([A, B, C, D].flatMap(n => [...pcsOf(n).values()])).toEqual(pcs);
    expect(pcs.map(pc => pc.offers)).toEqual(offers);
  });
});

describe('per-pair audio watchdog', () => {
  it('quietly renegotiates only the one silent pair and closes nothing', async () => {
    const [A, B, C, D] = [await makeNode('A'), await makeNode('B'), await makeNode('C'), await makeNode('D')];
    link('A', 'B'); link('B', 'C'); link('C', 'D'); link('A', 'C'); link('B', 'D'); link('A', 'D');
    await Promise.all([A, B, C, D].map(n => n.m.joinRoom('brain')));
    await vi.advanceTimersByTimeAsync(30_000);
    expectFullWeb([A, B, C, D]);

    const pcs = [A, B, C, D].flatMap(n => [...pcsOf(n).entries()].map(([peer, pc]) => ({ owner: n.id, peer, pc })));
    const before = new Map(pcs.map(({ pc }) => [pc, pc.offers]));
    // B stops hearing C (C is in the room and says their mic is on).
    const silent = pcsOf(B).get('C')!;
    silent.silent = true;
    await vi.advanceTimersByTimeAsync(40_000);

    const renegotiated = pcs.filter(({ pc }) => pc.offers > before.get(pc)!).map(({ owner, peer }) => `${owner}->${peer}`);
    console.log('WATCHDOG-SIM', renegotiated.join(' '));
    expect(renegotiated).toEqual(['B->C']);
    expect(pcs.some(({ pc }) => pc.closed)).toBe(false);
    expect(pcsOf(B).get('C')).toBe(silent);

    // Bounded: a pair that never recovers is not renegotiated forever.
    await vi.advanceTimersByTimeAsync(300_000);
    expect(silent.offers - before.get(silent)!).toBeLessThanOrEqual(2);
  });
});
