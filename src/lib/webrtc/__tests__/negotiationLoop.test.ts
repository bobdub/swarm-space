import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sentSignals: Array<{ to: string; type: string; data: unknown }> = [];
const reconnectSignals: Array<{ to: string; kind: string }> = [];
vi.mock('@/lib/streaming/webrtcSignalingBridge.standalone', () => ({
  onRoomWebPeer: () => () => {},
  sendSignalViaMesh: (to: string, _room: string, type: string, data: unknown) => {
    sentSignals.push({ to, type, data });
  },
  sendReconnectRequest: (to: string, _room: string, kind: string) => {
    reconnectSignals.push({ to, kind });
  },
  announceJoinRoom: vi.fn(),
  announceLeaveRoom: vi.fn(),
  onSignal: () => () => {},
  getLocalMeshPeerId: () => 'local-peer',
  isBridgeActive: () => true,
  isRoomPeerPresent: () => false,
  registerMediaPeerConnection: vi.fn(),
  registerCallLivenessProbe: vi.fn(),
}));

import { WebRTCManager } from '../manager';

class FakePC {
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  remoteDescription: RTCSessionDescription | null = null;
  localDescription: RTCSessionDescription | null = null;
  onicecandidate: ((e: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((e: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onsignalingstatechange: (() => void) | null = null;
  addTrack = vi.fn();
  addTransceiver = vi.fn();
  getSenders = vi.fn(() => [] as RTCRtpSender[]);
  getTransceivers = vi.fn(() => [] as RTCRtpTransceiver[]);
  close = vi.fn();
  addIceCandidate = vi.fn(async () => {});
  async createOffer() { return { type: 'offer' as RTCSdpType, sdp: 'fake-offer' }; }
  async createAnswer() { return { type: 'answer' as RTCSdpType, sdp: 'fake-answer' }; }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.localDescription = d as RTCSessionDescription;
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
    this.onsignalingstatechange?.();
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteDescription = d as RTCSessionDescription;
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
    this.onsignalingstatechange?.();
  }
}

const created: FakePC[] = [];

beforeEach(() => {
  sentSignals.length = 0;
  reconnectSignals.length = 0;
  created.length = 0;
  // @ts-expect-error – install fake constructor
  globalThis.RTCPeerConnection = class extends FakePC {
    constructor() { super(); created.push(this); }
  } as unknown as typeof RTCPeerConnection;
  // @ts-expect-error
  globalThis.RTCSessionDescription = function (init: RTCSessionDescriptionInit) { return init; };
  // @ts-expect-error
  globalThis.RTCIceCandidate = function (init: RTCIceCandidateInit) { return init; };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeManager(): WebRTCManager {
  const m = new WebRTCManager('local-peer', 'Local');
  // @ts-expect-error – private
  m.currentRoomId = 'room-test';
  return m;
}

describe('WebRTC negotiation loop — theoretical edge cases', () => {
  it('sends an offer when signaling state is stable', async () => {
    const m = makeManager();
    // @ts-expect-error – private
    await m.createOfferForPeer('peer-A');
    expect(sentSignals.find((s) => s.type === 'offer' && s.to === 'peer-A')).toBeTruthy();
  });

  it('flags negotiationNeeded and reschedules when state is non-stable', async () => {
    const m = makeManager();
    // @ts-expect-error – private
    await m.createOfferForPeer('peer-B');
    sentSignals.length = 0;
    created[0].signalingState = 'have-local-offer';
    // @ts-expect-error – private
    await m.createOfferForPeer('peer-B');
    expect(sentSignals.find((s) => s.type === 'offer')).toBeFalsy();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it('keeps the same call while a mesh answer takes longer than the old retry cap', async () => {
    const m = makeManager();
    // @ts-expect-error – private
    await m.createOfferForPeer('peer-C');
    created[0].signalingState = 'have-local-offer';
    sentSignals.length = 0;
    for (let i = 0; i < 7; i++) {
      // @ts-expect-error – private
      await m.createOfferForPeer('peer-C');
      await vi.advanceTimersByTimeAsync(320);
    }
    await vi.advanceTimersByTimeAsync(12_000);
    expect(reconnectSignals).toHaveLength(0);
    expect(created[0].close).not.toHaveBeenCalled();
    expect(sentSignals).toHaveLength(0);
    await m.handleSignal({ type: 'answer', from: 'peer-C', to: 'local-peer', data: { type: 'answer', sdp: 'answer' } });
    expect(sentSignals.filter(s => s.type === 'offer')).toHaveLength(1);
  });

  it('clears negotiation state on full peer cleanup', async () => {
    const m = makeManager();
    // @ts-expect-error – private
    await m.createOfferForPeer('peer-D');
    // @ts-expect-error – private
    m.cleanupPeer('peer-D');
    // @ts-expect-error – private
    expect(m.negotiationNeeded.has('peer-D')).toBe(false);
    // @ts-expect-error – private
    expect(m.negotiationTimers.has('peer-D')).toBe(false);
    // @ts-expect-error – private
    expect(m.negotiationLock.has('peer-D')).toBe(false);
  });

  it('impolite glare waits for the winning offer instead of hammering another offer', async () => {
    const m = makeManager();
    const remote = 'aaa-impolite-target'; // < 'local-peer' → local is impolite
    // @ts-expect-error – private
    await m.createOfferForPeer(remote);
    // @ts-expect-error – private
    m.makingOffer.set(remote, true);
    sentSignals.length = 0;
    // @ts-expect-error – private
    await m.handleRemoteOffer(remote, { type: 'offer', sdp: 'remote' });
    expect(sentSignals.find((s) => s.type === 'answer')).toBeFalsy();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sentSignals).toHaveLength(0);
    expect(reconnectSignals).toHaveLength(0);
  });

  it('does not force-unlock a concurrent offer through the public ensure path', async () => {
    const m = makeManager();
    const pc = await m.createPeerConnection('peer-E');
    let resolveOffer: ((offer: RTCSessionDescriptionInit) => void) | undefined;
    vi.spyOn(pc, 'createOffer').mockImplementation(() => new Promise(resolve => { resolveOffer = resolve; }));
    const first = m.createOffer('peer-E');
    await vi.advanceTimersByTimeAsync(0);
    await m.ensureOfferToPeer('peer-E');
    expect(pc.createOffer).toHaveBeenCalledTimes(1);
    resolveOffer?.({ type: 'offer', sdp: 'delayed' });
    await first;
    expect(sentSignals.filter(s => s.type === 'offer')).toHaveLength(1);
  });

  it('never sends a queued offer after a peer leaves', async () => {
    const m = makeManager();
    await m.createOffer('peer-F');
    await m.createOffer('peer-F');
    // @ts-expect-error – private cleanup under test
    m.cleanupPeer('peer-F');
    sentSignals.length = 0;
    await vi.advanceTimersByTimeAsync(31_000);
    expect(sentSignals).toHaveLength(0);
    expect(created).toHaveLength(1);
  });

  it('polite glare on the first negotiation answers from a fresh connection', async () => {
    const m = makeManager();
    const remote = 'zzz-polite-target';
    await m.createOffer(remote);
    await m.createOffer(remote);
    sentSignals.length = 0;
    await m.handleSignal({ type: 'offer', from: remote, to: 'local-peer', data: { type: 'offer', sdp: 'remote' } });
    await vi.advanceTimersByTimeAsync(0);
    // The rolled-back connection's upfront transceivers would be left with
    // no mid and keep raising negotiationneeded forever: replace it, and
    // answer once with no follow-up offer (local media rides the answer).
    expect(sentSignals.map(s => s.type)).toEqual(['answer']);
    expect(created).toHaveLength(2);
    expect(created[0].close).toHaveBeenCalled();
    expect(created[1].close).not.toHaveBeenCalled();
  });

  it('polite glare during a renegotiation rolls back on the same connection, then drains queued media once', async () => {
    const m = makeManager();
    const remote = 'zzz-polite-target';
    await m.createOffer(remote);
    // The call has negotiated before: this is a renegotiation glare.
    (created[0] as unknown as { currentRemoteDescription: unknown }).currentRemoteDescription = { type: 'answer', sdp: 'earlier' };
    await m.createOffer(remote);
    sentSignals.length = 0;
    await m.handleSignal({ type: 'offer', from: remote, to: 'local-peer', data: { type: 'offer', sdp: 'remote' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(sentSignals.map(s => s.type)).toEqual(['answer', 'offer']);
    expect(created).toHaveLength(1);
    expect(created[0].close).not.toHaveBeenCalled();
  });
});
