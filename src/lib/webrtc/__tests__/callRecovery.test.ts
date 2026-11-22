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
  registerMediaPeerConnection: vi.fn(),
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
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: unknown = null;
  onnegotiationneeded: unknown = null;
  offerOptions: Array<RTCOfferOptions | undefined> = [];
  addTransceiver = vi.fn(() => ({ sender: { replaceTrack: async () => {} } }));
  getSenders = vi.fn(() => [] as RTCRtpSender[]);
  getReceivers = vi.fn(() => [] as RTCRtpReceiver[]);
  getTransceivers = vi.fn(() => [] as RTCRtpTransceiver[]);
  addTrack = vi.fn(() => ({ replaceTrack: async () => {} }));
  removeTrack = vi.fn();
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

class FakeStream {
  constructor(private tracks: MediaStreamTrack[] = []) {}
  getTracks() { return [...this.tracks]; }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
}

function remoteTrack(id: string, kind: 'audio' | 'video', readyState: 'live' | 'ended' = 'live') {
  return { id, kind, readyState, muted: false } as MediaStreamTrack;
}

function receive(pc: FakePC, track: MediaStreamTrack) {
  pc.ontrack?.({ track, streams: [] } as unknown as RTCTrackEvent);
}

beforeEach(() => {
  sentSignals.length = 0;
  reconnectSignals.length = 0;
  created.length = 0;
  peerPresent = true;
  vi.stubGlobal('MediaStream', FakeStream);
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
  vi.unstubAllGlobals();
});

async function connectedManager(peer = 'peer-B') {
  const m = new WebRTCManager('local-peer', 'Local');
  await m.joinRoom('brain');
  signalHandler?.({ msgType: 'join-room', from: peer, roomId: 'brain', ts: 1 });
  await vi.advanceTimersByTimeAsync(0);
  const pc = created[created.length - 1];
  pc.setState('connected');
  sentSignals.length = 0;
  return { m, pc };
}

describe('Brain call recovery', () => {
  it('registers the remote contact when media connects', async () => {
    const { registerMediaPeerConnection } = await import('@/lib/streaming/webrtcSignalingBridge.standalone');
    vi.mocked(registerMediaPeerConnection).mockClear();
    const { m } = await connectedManager('peer-contact');
    expect(registerMediaPeerConnection).toHaveBeenCalledWith('peer-contact');
    await m.leaveRoom();
  });
  it('explicitly offers a screen track even when negotiationneeded never fires', async () => {
    const { m, pc } = await connectedManager();
    const screen = Object.assign(new EventTarget(), { kind: 'video', readyState: 'live', stop: vi.fn() }) as unknown as MediaStreamTrack;
    await m.publishScreenStream(new FakeStream([screen]) as unknown as MediaStream);
    await vi.advanceTimersByTimeAsync(0);
    expect(pc.addTrack).toHaveBeenCalledWith(screen, m.getScreenStream());
    expect(sentSignals.some(s => s.type === 'offer' && s.to === 'peer-B')).toBe(true);
    m.stopScreenShare();
    expect(pc.removeTrack).toHaveBeenCalledTimes(1);
    await m.leaveRoom();
  });
  it('re-offers a connected peer with no incoming audio, at most once per 12s cooldown', async () => {
    const { pc } = await connectedManager();
    signalHandler?.({ msgType: 'media-state', from: 'peer-B', roomId: 'brain', ts: 2, data: { mic: true } });
    await vi.advanceTimersByTimeAsync(180_000);
    const offers = sentSignals.filter(sig => sig.type === 'offer' && sig.to === 'peer-B');
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.length).toBeLessThanOrEqual(15);
    expect(pc.close).not.toHaveBeenCalled();
    expect(reconnectSignals).toHaveLength(0);
  });

  it('duplicate failed events cannot restart a recovery already in progress', async () => {
    const { pc } = await connectedManager();
    pc.setState('failed');
    pc.setState('failed');
    await vi.advanceTimersByTimeAsync(0);
    expect(pc.close).not.toHaveBeenCalled();
    expect(reconnectSignals).toHaveLength(0);
    expect(pc.offerOptions.filter(o => o?.iceRestart)).toHaveLength(1);
  });
  it('uses the same STUN + TURN servers as the mesh', async () => {
    const { pc } = await connectedManager();
    expect(pc.config.iceServers).toBe(DEFAULT_ICE_SERVERS);
    expect(JSON.stringify(pc.config.iceServers)).toContain('turn:openrelay.metered.ca');
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
    signalHandler?.({ msgType: 'leave-room', from: 'peer-B', roomId: 'brain', ts: 2, data: { reason: 'silent' } });
    expect(pc.close).not.toHaveBeenCalled();
    expect(m.getParticipants()).toHaveLength(1);
  });

  it('still closes the call on a real leave', async () => {
    const { m, pc } = await connectedManager();
    signalHandler?.({ msgType: 'leave-room', from: 'peer-B', roomId: 'brain', ts: 2 });
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

  it('allows twenty seconds for a network change before restarting ICE', async () => {
    const { m, pc } = await connectedManager();
    pc.setState('disconnected');
    await vi.advanceTimersByTimeAsync(19_999);
    expect(pc.offerOptions.filter(o => o?.iceRestart)).toHaveLength(0);
    expect(pc.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(pc.offerOptions.filter(o => o?.iceRestart)).toHaveLength(1);
    await m.leaveRoom();
  });

  it.each(['connecting', 'disconnected', 'failed'] as const)('mesh silence does not close a %s call', async (state) => {
    const { m, pc } = await connectedManager();
    pc.setState(state);
    signalHandler?.({ msgType: 'leave-room', from: 'peer-B', roomId: 'brain', ts: 2, data: { reason: 'silent' } });
    expect(pc.close).not.toHaveBeenCalled();
    expect(m.getParticipants()).toHaveLength(1);
    await m.leaveRoom();
  });

  it('keeps recovery alive after silent room eviction but eventually removes an unreachable peer', async () => {
    const { m, pc } = await connectedManager();
    peerPresent = false;
    signalHandler?.({ msgType: 'leave-room', from: 'peer-B', roomId: 'brain', ts: 2, data: { reason: 'silent' } });
    pc.setState('failed');
    await vi.advanceTimersByTimeAsync(45_100);
    expect(m.getParticipants()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(130_000);
    expect(m.getParticipants()).toHaveLength(0);
    await m.leaveRoom();
  });

  it('an explicit leave cancels recovery even after mesh silence', async () => {
    const { m, pc } = await connectedManager();
    pc.setState('disconnected');
    signalHandler?.({ msgType: 'leave-room', from: 'peer-B', roomId: 'brain', ts: 2, data: { reason: 'silent' } });
    signalHandler?.({ msgType: 'leave-room', from: 'peer-B', roomId: 'brain', ts: 3, data: { reason: 'left' } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pc.close).toHaveBeenCalledTimes(1);
    expect(m.getParticipants()).toHaveLength(0);
    expect(reconnectSignals).toHaveLength(0);
    await m.leaveRoom();
  });

  it('local mesh shutdown still closes a healthy call', async () => {
    const { m, pc } = await connectedManager();
    signalHandler?.({ msgType: 'leave-room', from: 'peer-B', roomId: 'brain', ts: 2, data: { reason: 'local' } });
    expect(pc.close).toHaveBeenCalledTimes(1);
    expect(m.getParticipants()).toHaveLength(0);
    await m.leaveRoom();
  });

  it('answers a rebuilt peer from a fresh connection instead of the stale one', async () => {
    const { m, pc } = await connectedManager();
    await pc.setRemoteDescription({ type: 'answer', sdp: 'v=0\r\na=fingerprint:sha-256 AA:BB\r\n' });
    signalHandler?.({ msgType: 'offer', from: 'peer-B', roomId: 'brain', ts: 3,
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
    signalHandler?.({ msgType: 'offer', from: 'peer-B', roomId: 'brain', ts: 3,
      data: { type: 'offer', sdp: 'a=fingerprint:sha-256 AA:BB' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(created.length).toBe(count);
    expect(pc.close).not.toHaveBeenCalled();
  });

  it('does not let either health sweep interrupt an in-flight negotiation', async () => {
    const { m, pc } = await connectedManager();
    pc.signalingState = 'have-local-offer';
    await vi.advanceTimersByTimeAsync(24_000);
    m.sweepHalfOpenConnections();
    expect(pc.close).not.toHaveBeenCalled();
    expect(sentSignals).toHaveLength(0);
    expect(reconnectSignals).toHaveLength(0);
  });

  it('does not renegotiate an intentionally muted remote with no incoming tracks', async () => {
    const { pc } = await connectedManager();
    signalHandler?.({ msgType: 'media-state', from: 'peer-B', roomId: 'brain', ts: 4, data: { mic: false } });
    await vi.advanceTimersByTimeAsync(24_000);
    expect(sentSignals).toHaveLength(0);
    expect(pc.close).not.toHaveBeenCalled();
  });

  it('does not renegotiate while microphone permission/state is unknown', async () => {
    const { m, pc } = await connectedManager();
    signalHandler?.({ msgType: 'media-state', from: 'peer-B', roomId: 'brain', ts: 4, data: { camera: false } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sentSignals).toHaveLength(0);
    expect(pc.close).not.toHaveBeenCalled();
    await m.leaveRoom();
  });

  it('partial camera updates do not unmute a listen-only peer', async () => {
    const { m, pc } = await connectedManager();
    signalHandler?.({ msgType: 'media-state', from: 'peer-B', roomId: 'brain', ts: 4, data: { mic: false } });
    signalHandler?.({ msgType: 'media-state', from: 'peer-B', roomId: 'brain', ts: 5, data: { camera: true } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sentSignals).toHaveLength(0);
    expect(m.getParticipants()[0]?.isMuted).toBe(true);
    expect(pc.close).not.toHaveBeenCalled();
    await m.leaveRoom();
  });

  it('the half-open sweep honors disconnect grace and existing recovery', async () => {
    const { m, pc } = await connectedManager();
    pc.setState('disconnected');
    m.sweepHalfOpenConnections();
    await vi.advanceTimersByTimeAsync(8_000);
    m.sweepHalfOpenConnections();
    expect(pc.close).not.toHaveBeenCalled();
    expect(reconnectSignals).toHaveLength(0);
  });

  it('replaces dead or obsolete audio with one live track and a fresh playback stream', async () => {
    const { m, pc } = await connectedManager();
    const old = remoteTrack('old-mic', 'audio');
    const video = remoteTrack('camera', 'video');
    receive(pc, old);
    receive(pc, video);
    const previous = m.getParticipants()[0].stream;
    const fresh = remoteTrack('new-mic', 'audio');
    receive(pc, fresh);
    const current = m.getParticipants()[0].stream;
    expect(current).not.toBe(previous);
    expect(current?.getAudioTracks()).toEqual([fresh]);
    expect(current?.getVideoTracks()).toEqual([video]);
    // A delayed end from the replaced mic cannot remove the new one.
    old.onended?.(new Event('ended'));
    expect(m.getParticipants()[0].stream?.getAudioTracks()).toEqual([fresh]);
  });

  it('recovery clears stale streams and ignores tracks from the closed connection', async () => {
    const { m, pc } = await connectedManager();
    receive(pc, remoteTrack('old-mic', 'audio'));
    const delayedTrackEvent = pc.ontrack;
    await m.resyncPeer('peer-B');
    expect(m.getParticipants()[0].stream).toBeNull();
    delayedTrackEvent?.({ track: remoteTrack('late-old-mic', 'audio'), streams: [] } as unknown as RTCTrackEvent);
    expect(m.getParticipants()[0].stream).toBeNull();
    await m.createPeerConnection('peer-B');
    const replacement = created.at(-1);
    if (!replacement) throw new Error('Expected replacement connection');
    const live = remoteTrack('live-mic', 'audio');
    receive(replacement, live);
    expect(m.getParticipants()[0].stream?.getAudioTracks()).toEqual([live]);
  });
});

describe('sdpFingerprint', () => {
  it('reads the DTLS fingerprint', async () => {
    const { sdpFingerprint } = await import('../manager');
    expect(sdpFingerprint('v=0\r\na=fingerprint:sha-256 AB:CD\r\n')).toBe('sha-256 ab:cd');
    expect(sdpFingerprint(undefined)).toBeNull();
  });
});
