/**
 * Viewers tell a sharer how they show the screen, and the sharer encodes for
 * each viewer accordingly: thumbnails get a small, slow picture and a closed
 * share gets nothing, instead of everyone decoding full 1080p.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SignalEnvelope } from '@/lib/streaming/webrtcSignalingBridge.standalone';

const sentSignals: Array<{ to: string; type: string; data: unknown }> = [];
const reconnectSignals: Array<{ to: string; kind: string }> = [];
let signalHandler: ((e: SignalEnvelope) => void) | null = null;
let peerPresent = true;
const viewSignals: Array<{ to: string; view: string }> = [];

vi.mock('@/lib/streaming/webrtcSignalingBridge.standalone', () => ({
  sendSignalViaMesh: (to: string, _room: string, type: string, data: unknown) => {
    sentSignals.push({ to, type, data });
  },
  sendReconnectRequest: (to: string, _room: string, kind: string) => {
    reconnectSignals.push({ to, kind });
  },
  sendScreenShareState: vi.fn(),
  sendScreenView: (to: string, _room: string, view: string) => { viewSignals.push({ to, view }); },
  sendMediaState: vi.fn(),
  announceJoinRoom: vi.fn(),
  announceLeaveRoom: vi.fn(),
  onSignal: (h: (e: SignalEnvelope) => void) => { signalHandler = h; return () => { signalHandler = null; }; },
  getLocalMeshPeerId: () => 'local-peer',
  isBridgeActive: () => true,
  isRoomPeerPresent: () => peerPresent,
  registerMediaPeerConnection: vi.fn(),
  registerCallLivenessProbe: vi.fn(),
}));

import { WebRTCManager, screenEncodingFor, strongestScreenView } from '../manager';
import { sameParticipants } from '../participantsEqual';

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
  viewSignals.length = 0;
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


function screenSender() {
  const encodings: RTCRtpEncodingParameters[] = [{}];
  const applied: RTCRtpEncodingParameters[] = [];
  const sender = {
    track: { kind: 'video' },
    replaceTrack: async () => {},
    getParameters: vi.fn(() => ({ encodings: encodings.map((e) => ({ ...e })) })),
    setParameters: vi.fn(async (p: RTCRtpSendParameters) => {
      Object.assign(encodings[0], p.encodings[0]);
      applied.push({ ...p.encodings[0] });
    }),
  };
  return { sender, applied };
}

describe('screen share quality per viewer', () => {
  it('picks the strongest need among open elements', () => {
    expect(strongestScreenView([])).toBe('off');
    expect(strongestScreenView(['preview'])).toBe('preview');
    expect(strongestScreenView(['preview', 'full'])).toBe('full');
    expect(screenEncodingFor('off').active).toBe(false);
    expect(screenEncodingFor('preview').scaleResolutionDownBy).toBeGreaterThan(1);
  });

  it('sharer encodes full by default, then follows the viewer', async () => {
    const { m, pc } = await connectedManager('peer-V');
    const { sender, applied } = screenSender();
    pc.addTrack.mockReturnValue(sender);
    const screen = Object.assign(new EventTarget(), { kind: 'video', readyState: 'live', stop: vi.fn() }) as unknown as MediaStreamTrack;
    await m.publishScreenStream(new FakeStream([screen]) as unknown as MediaStream);
    await vi.advanceTimersByTimeAsync(0);
    expect(applied.at(-1)).toMatchObject({ active: true, scaleResolutionDownBy: 1 });

    signalHandler?.({ msgType: 'screen-view', from: 'peer-V', roomId: 'brain', data: { view: 'preview' }, ts: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(applied.at(-1)).toMatchObject(screenEncodingFor('preview'));

    signalHandler?.({ msgType: 'screen-view', from: 'peer-V', roomId: 'brain', data: { view: 'off' }, ts: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(applied.at(-1)?.active).toBe(false);

    signalHandler?.({ msgType: 'screen-view', from: 'peer-V', roomId: 'brain', data: { view: 'bogus' }, ts: 4 });
    await vi.advanceTimersByTimeAsync(0);
    expect(applied.at(-1)?.active).toBe(false);
    await m.leaveRoom();
  });

  it('viewer asks for a thumbnail, full size, then nothing', async () => {
    const { m, pc } = await connectedManager('peer-S');
    const track = { id: 'scr', kind: 'video', readyState: 'live', muted: false } as MediaStreamTrack;
    const stream = Object.assign(new EventTarget(), { id: 'scr-stream', getVideoTracks: () => [track], getTracks: () => [track] });
    pc.ontrack?.({ track, streams: [stream] } as unknown as RTCTrackEvent);

    const stopThumb = m.watchRemoteScreen('peer-S', 'preview');
    await vi.advanceTimersByTimeAsync(150);
    // Full is what an un-told sharer sends, so a thumbnail is a step down.
    expect(viewSignals).toEqual([]);
    await vi.advanceTimersByTimeAsync(2500);
    expect(viewSignals).toEqual([{ to: 'peer-S', view: 'preview' }]);

    const stopFull = m.watchRemoteScreen('peer-S', 'full');
    await vi.advanceTimersByTimeAsync(150);
    expect(viewSignals.at(-1)).toEqual({ to: 'peer-S', view: 'full' });

    stopFull();
    stopThumb();
    await vi.advanceTimersByTimeAsync(1000);
    expect(viewSignals.at(-1)?.view).toBe('full');
    await vi.advanceTimersByTimeAsync(2000);
    expect(viewSignals.at(-1)).toEqual({ to: 'peer-S', view: 'off' });

    // A quick remount within the pause sends nothing extra.
    const n = viewSignals.length;
    const again = m.watchRemoteScreen('peer-S', 'preview');
    again();
    const back = m.watchRemoteScreen('peer-S', 'preview');
    await vi.advanceTimersByTimeAsync(150);
    expect(viewSignals.length).toBe(n + 1);
    expect(viewSignals.at(-1)?.view).toBe('preview');
    back();
    await m.leaveRoom();
  });
});

describe('a screen share arriving mid-call', () => {
  it('shows up as a change to an earlier participant list', async () => {
    const { m, pc } = await connectedManager('peer-S');
    const before = m.getParticipants();
    const track = { id: 'scr', kind: 'video', readyState: 'live', muted: false } as MediaStreamTrack;
    const stream = Object.assign(new EventTarget(), { id: 'scr-stream', getVideoTracks: () => [track], getTracks: () => [track] });
    pc.ontrack?.({ track, streams: [stream] } as unknown as RTCTrackEvent);
    const after = m.getParticipants();
    expect(before.find((p) => p.peerId === 'peer-S')?.screenStream ?? null).toBeNull();
    expect(after.find((p) => p.peerId === 'peer-S')?.screenStream).toBe(stream);
    expect(sameParticipants(before, after)).toBe(false);
    await m.leaveRoom();
  });
});
