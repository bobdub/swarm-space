import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SignalEnvelope } from '@/lib/streaming/webrtcSignalingBridge.standalone';

const sentSignals: Array<{ to: string; type: string; data: unknown }> = [];
const reconnectSignals: Array<{ to: string; kind: string }> = [];
let signalHandler: ((e: SignalEnvelope) => void) | null = null;
let peerPresent = true;

vi.mock('@/lib/streaming/webrtcSignalingBridge.standalone', () => ({
  sendSignalViaMesh: (to: string, _room: string, type: string, data: unknown) => {
    sentSignals.push({ to, type, data });
  },
  sendReconnectRequest: (to: string, _room: string, kind: string) => {
    reconnectSignals.push({ to, kind });
  },
  sendScreenShareState: vi.fn(),
  sendMediaState: vi.fn(),
  announceJoinRoom: vi.fn(),
  announceLeaveRoom: vi.fn(),
  onSignal: (h: (e: SignalEnvelope) => void) => { signalHandler = h; return () => { signalHandler = null; }; },
  getLocalMeshPeerId: () => 'local-peer',
  isBridgeActive: () => true,
  isRoomPeerPresent: () => peerPresent,
}));

import { WebRTCManager } from '../manager';
import { DEFAULT_ICE_SERVERS } from '@/lib/p2p/iceServers';

class FakePC {
  config: RTCConfiguration;
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  remoteDescription: RTCSessionDescription | null = null;
  localDescription: RTCSessionDescription | null = null;
  onicecandidate: unknown = null;
  ontrack: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: unknown = null;
  onnegotiationneeded: unknown = null;
  offerOptions: Array<RTCOfferOptions | undefined> = [];
  addTransceiver = vi.fn(() => ({ sender: { replaceTrack: async () => {} } }));
  getSenders = vi.fn(() => [] as RTCRtpSender[]);
  getReceivers = vi.fn(() => [] as RTCRtpReceiver[]);
  getTransceivers = vi.fn(() => [] as RTCRtpTransceiver[]);
  close = vi.fn(() => { this.connectionState = 'closed'; });
  addIceCandidate = vi.fn(async () => {});
  constructor(config: RTCConfiguration) { this.config = config; }
  async createOffer(opts?: RTCOfferOptions) { this.offerOptions.push(opts); return { type: 'offer' as RTCSdpType, sdp: 'o' }; }
  async createAnswer() { return { type: 'answer' as RTCSdpType, sdp: 'a' }; }
  async setLocalDescription(d: RTCSessionDescriptionInit) { this.localDescription = d as RTCSessionDescription; }
  async setRemoteDescription(d: RTCSessionDescriptionInit) { this.remoteDescription = d as RTCSessionDescription; }
  setState(state: RTCPeerConnectionState) { this.connectionState = state; this.onconnectionstatechange?.(); }
}

const created: FakePC[] = [];

beforeEach(() => {
  sentSignals.length = 0;
  reconnectSignals.length = 0;
  created.length = 0;
  peerPresent = true;
  // @ts-expect-error – install fake constructor
  globalThis.RTCPeerConnection = class extends FakePC {
    constructor(c: RTCConfiguration) { super(c); created.push(this); }
  };
  // @ts-expect-error – test shim
  globalThis.RTCSessionDescription = function (init: RTCSessionDescriptionInit) { return init; };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function connectedManager(peer = 'peer-B') {
  const m = new WebRTCManager('local-peer', 'Local');
  await m.joinRoom('brain');
  signalHandler!({ msgType: 'join-room', from: peer, roomId: 'brain', ts: 1 });
  await vi.advanceTimersByTimeAsync(0);
  const pc = created[created.length - 1];
  pc.setState('connected');
  sentSignals.length = 0;
  return { m, pc };
}

describe('Brain call recovery', () => {
  it('uses the same STUN + TURN servers as the mesh', async () => {
    const { pc } = await connectedManager();
    expect(pc.config.iceServers).toBe(DEFAULT_ICE_SERVERS);
    expect(JSON.stringify(pc.config.iceServers)).toContain('turn:');
  });

  it('first recovers a failed connection with an ICE restart, keeping the call', async () => {
    const { m, pc } = await connectedManager();
    pc.setState('failed');
    await vi.advanceTimersByTimeAsync(0);
    expect(pc.close).not.toHaveBeenCalled();
    expect(pc.offerOptions.at(-1)).toEqual({ iceRestart: true });
    expect(sentSignals.some((s) => s.type === 'offer' && s.to === 'peer-B')).toBe(true);
    expect(reconnectSignals).toHaveLength(0);
    expect(m.getParticipants().map((p) => p.peerId)).toEqual(['peer-B']);
  });

  it('keeps a live call when the mesh only reports the peer as quiet', async () => {
    const { m, pc } = await connectedManager();
    signalHandler!({ msgType: 'leave-room', from: 'peer-B', roomId: 'brain', ts: 2, data: { reason: 'silent' } });
    expect(pc.close).not.toHaveBeenCalled();
    expect(m.getParticipants()).toHaveLength(1);
  });

  it('still closes the call on a real leave', async () => {
    const { m, pc } = await connectedManager();
    signalHandler!({ msgType: 'leave-room', from: 'peer-B', roomId: 'brain', ts: 2 });
    expect(pc.close).toHaveBeenCalled();
    expect(m.getParticipants()).toHaveLength(0);
  });

  it('keeps retrying a peer that is still in the room instead of dropping them', async () => {
    const { m, pc } = await connectedManager();
    pc.setState('failed');
    // ICE restart + two full rebuilds, each timing out.
    await vi.advanceTimersByTimeAsync(15_000 * 3 + 100);
    expect(m.getParticipants().map((p) => p.peerId)).toEqual(['peer-B']);
    const before = reconnectSignals.length;
    await vi.advanceTimersByTimeAsync(20_000 + 100);
    expect(reconnectSignals.length).toBeGreaterThan(before);
  });

  it('drops a peer that is gone from the room after recovery fails', async () => {
    peerPresent = false;
    const { m, pc } = await connectedManager();
    pc.setState('failed');
    await vi.advanceTimersByTimeAsync(15_000 * 3 + 100);
    expect(m.getParticipants()).toHaveLength(0);
  });

  it('lets a brief disconnect heal without the health sweep tearing it down', async () => {
    const { pc } = await connectedManager();
    pc.setState('disconnected');
    await vi.advanceTimersByTimeAsync(8_100); // one health sweep, inside the grace
    expect(pc.close).not.toHaveBeenCalled();
    expect(reconnectSignals).toHaveLength(0);
    pc.setState('connected');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pc.close).not.toHaveBeenCalled();
  });

  it('answers a rebuilt peer from a fresh connection instead of the stale one', async () => {
    const { m, pc } = await connectedManager();
    await pc.setRemoteDescription({ type: 'answer', sdp: 'v=0\r\na=fingerprint:sha-256 AA:BB\r\n' });
    signalHandler!({ msgType: 'offer', from: 'peer-B', roomId: 'brain', ts: 3,
      data: { type: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 CC:DD\r\n' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(pc.close).toHaveBeenCalled();
    const fresh = created[created.length - 1];
    expect(fresh).not.toBe(pc);
    expect(fresh.remoteDescription?.sdp).toContain('CC:DD');
    expect(sentSignals.some((s) => s.type === 'answer')).toBe(true);
    expect(m.getParticipants()).toHaveLength(1);
  });

  it('keeps the same connection for an ICE-restart offer from the same peer', async () => {
    const { pc } = await connectedManager();
    await pc.setRemoteDescription({ type: 'answer', sdp: 'a=fingerprint:sha-256 AA:BB' });
    pc.setState('failed');
    await vi.advanceTimersByTimeAsync(0);
    const count = created.length;
    pc.signalingState = 'stable';
    signalHandler!({ msgType: 'offer', from: 'peer-B', roomId: 'brain', ts: 3,
      data: { type: 'offer', sdp: 'a=fingerprint:sha-256 AA:BB' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(created.length).toBe(count);
    expect(pc.close).not.toHaveBeenCalled();
  });
});

describe('sdpFingerprint', () => {
  it('reads the DTLS fingerprint', async () => {
    const { sdpFingerprint } = await import('../manager');
    expect(sdpFingerprint('v=0\r\na=fingerprint:sha-256 AB:CD\r\n')).toBe('sha-256 ab:cd');
    expect(sdpFingerprint(undefined)).toBeNull();
  });
});
