import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Multi-node simulation: each node gets its own copy of the signaling bridge
// and call manager, wired through an in-memory mesh.

type Handler = (from: string, payload: unknown) => void;
const nodes = new Map<string, { handler: Handler | null; edges: Set<string> }>();
const log: string[] = [];

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

let pcSeq = 0;
class FakePC {
  id = ++pcSeq;
  owner = '';
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState = 'new';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: unknown = null;
  ontrack: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: unknown = null;
  onnegotiationneeded: unknown = null;
  onsignalingstatechange: (() => void) | null = null;
  offers = 0;
  closed = false;
  addTransceiver = vi.fn(() => ({ sender: { track: null, replaceTrack: async () => {} }, receiver: { track: null }, mid: null }));
  getSenders = vi.fn(() => [] as RTCRtpSender[]);
  getReceivers = vi.fn(() => [{ track: { readyState: 'live', kind: 'audio' } }] as unknown as RTCRtpReceiver[]);
  getTransceivers = vi.fn(() => [] as RTCRtpTransceiver[]);
  addTrack = vi.fn();
  removeTrack = vi.fn();
  addIceCandidate = vi.fn(async () => {});
  close = () => { this.closed = true; this.connectionState = 'closed'; };
  sdp(type: string) { return `${type}\na=fingerprint:sha-256 FP${this.id}\n`; }
  async createOffer() { this.offers++; return { type: 'offer' as RTCSdpType, sdp: this.sdp('offer') }; }
  async createAnswer() { return { type: 'answer' as RTCSdpType, sdp: this.sdp('answer') }; }
  private settle() {
    this.onsignalingstatechange?.();
    if (this.signalingState === 'stable' && this.localDescription && this.remoteDescription && this.connectionState !== 'connected' && !this.closed) {
      this.connectionState = 'connected';
      this.onconnectionstatechange?.();
    }
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    if (d.type === 'rollback') { this.signalingState = 'stable'; this.settle(); return; }
    this.localDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
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
  nodes.clear(); log.length = 0; allPcs.length = 0;
  vi.useFakeTimers();
  // @ts-expect-error fake
  globalThis.RTCPeerConnection = class extends FakePC { constructor() { super(); allPcs.push(this); } };
  // @ts-expect-error shim
  globalThis.RTCSessionDescription = function (init: RTCSessionDescriptionInit) { return init; };
  // @ts-expect-error shim
  globalThis.RTCIceCandidate = function (init: RTCIceCandidateInit) { return init; };
});
afterEach(() => { vi.useRealTimers(); });

async function makeNode(id: string) {
  vi.resetModules();
  const bridge = await import('@/lib/streaming/webrtcSignalingBridge.standalone');
  const { WebRTCManager } = await import('../manager');
  const mesh = makeMesh(id);
  bridge.startSignalingBridge(mesh as never);
  const before = allPcs.length;
  const m = new WebRTCManager(`user-${id}`, id);
  void before;
  return { id, bridge, m };
}

function pcsOf(m: unknown): Map<string, FakePC> {
  return (m as { connections: Map<string, FakePC> }).connections;
}

describe('Brain room: a newcomer joining', () => {
  it('does not disturb the existing A-B call', async () => {
    const A = await makeNode('A');
    const B = await makeNode('B');
    link('A', 'B');
    await A.m.joinRoom('brain');
    await B.m.joinRoom('brain');
    await vi.advanceTimersByTimeAsync(20_000);
    const ab = pcsOf(A.m).get('B')!;
    const ba = pcsOf(B.m).get('A')!;
    expect(ab?.connectionState).toBe('connected');
    expect(ba?.connectionState).toBe('connected');
    const abOffers = ab.offers, baOffers = ba.offers;

    const N = await makeNode('N');
    link('N', 'A');
    await N.m.joinRoom('brain');
    await vi.advanceTimersByTimeAsync(4_000);
    link('N', 'B');
    await vi.advanceTimersByTimeAsync(30_000);

    console.log('A-B pc same?', pcsOf(A.m).get('B') === ab, pcsOf(B.m).get('A') === ba,
      'renegotiations', ab.offers - abOffers, ba.offers - baOffers,
      'N links', pcsOf(N.m).get('A')?.connectionState, pcsOf(N.m).get('B')?.connectionState);
    expect(pcsOf(A.m).get('B')).toBe(ab);
    expect(pcsOf(B.m).get('A')).toBe(ba);
    expect(ab.closed || ba.closed).toBe(false);
  });

  it('keeps the A-B call when their mesh edge churns', async () => {
    const A = await makeNode('A');
    const B = await makeNode('B');
    link('A', 'B');
    await A.m.joinRoom('brain');
    await B.m.joinRoom('brain');
    await vi.advanceTimersByTimeAsync(20_000);
    const ab = pcsOf(A.m).get('B')!;
    const ba = pcsOf(B.m).get('A')!;
    const o1 = ab.offers, o2 = ba.offers;
    // A newcomer reshuffles the mesh: the A-B link drops and reopens.
    nodes.get('A')!.edges.delete('B'); nodes.get('B')!.edges.delete('A');
    await vi.advanceTimersByTimeAsync(2_100);
    link('A', 'B');
    await vi.advanceTimersByTimeAsync(30_000);
    console.log('CHURN same?', pcsOf(A.m).get('B') === ab, pcsOf(B.m).get('A') === ba, 'reneg', ab.offers - o1, ba.offers - o2,
      pcsOf(A.m).get('B')?.connectionState, pcsOf(B.m).get('A')?.connectionState);
    expect(pcsOf(A.m).get('B')).toBe(ab);
    expect(pcsOf(B.m).get('A')).toBe(ba);
    expect(ab.offers - o1 + ba.offers - o2).toBe(0);
  });

  it('connects a newcomer whose join happened before any mesh edge', async () => {
    const A = await makeNode('A');
    const B = await makeNode('B');
    const C = await makeNode('C');
    link('A', 'B'); link('B', 'C'); link('A', 'C');
    await A.m.joinRoom('brain');
    await B.m.joinRoom('brain');
    await C.m.joinRoom('brain');
    await vi.advanceTimersByTimeAsync(20_000);

    const N = await makeNode('N');
    await N.m.joinRoom('brain');
    await vi.advanceTimersByTimeAsync(5_000);
    link('N', 'A'); // only one edge, to a member
    await vi.advanceTimersByTimeAsync(40_000);
    console.log('N links', ['A', 'B', 'C'].map(p => `${p}:${pcsOf(N.m).get(p)?.connectionState}`).join(' '));
    expect(pcsOf(N.m).get('A')?.connectionState).toBe('connected');
    expect(pcsOf(N.m).get('B')?.connectionState).toBe('connected');
    expect(pcsOf(N.m).get('C')?.connectionState).toBe('connected');
  });

  it('connects a direct Brain join whose first mesh link is someone outside the Brain', async () => {
    const A = await makeNode('A');
    const B = await makeNode('B');
    const X = await makeNode('X'); // on Explore: in the mesh, not in the room
    link('A', 'B'); link('X', 'A'); link('X', 'B');
    await A.m.joinRoom('brain');
    await B.m.joinRoom('brain');
    await vi.advanceTimersByTimeAsync(20_000);

    const N = await makeNode('N');
    await N.m.joinRoom('brain');
    await vi.advanceTimersByTimeAsync(5_000);
    link('N', 'X');
    // Before the media health sweep could patch it up.
    await vi.advanceTimersByTimeAsync(3_000);
    console.log('VIA-X', ['A', 'B'].map(p => `${p}:${pcsOf(N.m).get(p)?.connectionState}`).join(' '));
    expect(pcsOf(N.m).get('A')?.connectionState).toBe('connected');
    expect(pcsOf(N.m).get('B')?.connectionState).toBe('connected');
  });
});
