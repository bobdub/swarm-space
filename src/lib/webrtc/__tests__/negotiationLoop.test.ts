import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sentSignals: Array<{ to: string; type: string; data: unknown }> = [];
const reconnectSignals: Array<{ to: string; kind: string }> = [];
vi.mock('@/lib/streaming/webrtcSignalingBridge.standalone', () => ({
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
  addTrack = vi.fn();
  addTransceiver = vi.fn();
  getSenders = vi.fn(() => [] as RTCRtpSender[]);
  getTransceivers = vi.fn(() => [] as RTCRtpTransceiver[]);
  close = vi.fn();
  addIceCandidate = vi.fn(async () => {});
  async createOffer() { return { type: 'offer' as RTCSdpType, sdp: 'fake-offer' }; }
  async createAnswer() { return { type: 'answer' as RTCSdpType, sdp: 'fake-answer' }; }
  async setLocalDescription(d: RTCSessionDescriptionInit) { this.localDescription = d as RTCSessionDescription; }
  async setRemoteDescription(d: RTCSessionDescriptionInit) { this.remoteDescription = d as RTCSessionDescription; }
}

const created: FakePC[] = [];

beforeEach(() => {
  sentSignals.length = 0;
  reconnectSignals.length = 0;
  created.length = 0;
  // @ts-expect-error – install fake
  globalThis.RTCPeerConnection = vi.fn(() => {
    const pc = new FakePC();
    created.push(pc);
    return pc;
  });
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

  it('escalates to recovery after MAX_NEGOTIATION_RETRIES consecutive deferrals', async () => {
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
    expect(reconnectSignals.some((s) => s.kind === 'reconnect-request' && s.to === 'peer-C')).toBe(true);
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
    expect(m.negotiationRetryCount.has('peer-D')).toBe(false);
    // @ts-expect-error – private
    expect(m.negotiationLock.has('peer-D')).toBe(false);
  });

  it('impolite peer schedules a follow-up offer instead of answering during glare', async () => {
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
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });
});
