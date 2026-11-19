import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SignalEnvelope } from '@/lib/streaming/webrtcSignalingBridge.standalone';

const sent: Array<{ to: string; type: string; data: unknown }> = [];
let signalHandler: ((e: SignalEnvelope) => void) | null = null;

vi.mock('@/lib/streaming/webrtcSignalingBridge.standalone', () => ({
  sendSignalViaMesh: (to: string, _r: string, type: string, data: unknown) => { sent.push({ to, type, data }); },
  sendReconnectRequest: vi.fn(),
  sendScreenShareState: vi.fn(),
  sendMediaState: vi.fn(),
  announceJoinRoom: vi.fn(),
  announceLeaveRoom: vi.fn(),
  onSignal: (h: (e: SignalEnvelope) => void) => { signalHandler = h; return () => { signalHandler = null; }; },
  getLocalMeshPeerId: () => 'local-peer',
  isBridgeActive: () => true,
  isRoomPeerPresent: () => true,
}));

import { WebRTCManager } from '../manager';

type FakeTrack = { kind: 'audio' | 'video'; readyState: 'live' | 'ended'; enabled: boolean; id: string };

class FakeTransceiver {
  mid: string | null = null;
  direction: RTCRtpTransceiverDirection;
  currentDirection: RTCRtpTransceiverDirection | null = null;
  sender: { track: FakeTrack | null; replaceTrack: (t: FakeTrack | null) => Promise<void> };
  receiver: { track: { kind: string } };
  constructor(kind: string, direction: RTCRtpTransceiverDirection) {
    this.direction = direction;
    this.receiver = { track: { kind } };
    const sender = { track: null as FakeTrack | null, replaceTrack: async (t: FakeTrack | null) => { sender.track = t; } };
    this.sender = sender;
  }
  stop() { this.direction = 'stopped'; }
}

class FakePC {
  transceivers: FakeTransceiver[] = [];
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  onconnectionstatechange: (() => void) | null = null;
  addTransceiver = vi.fn((kind: string, init: { direction: RTCRtpTransceiverDirection }) => {
    const t = new FakeTransceiver(kind, init.direction);
    this.transceivers.push(t);
    return t;
  });
  getTransceivers() { return this.transceivers; }
  getSenders() { return this.transceivers.map((t) => t.sender); }
  getReceivers() { return this.transceivers.map((t) => t.receiver); }
  close = vi.fn();
  addIceCandidate = vi.fn(async () => {});
  async createOffer() { return { type: 'offer' as RTCSdpType, sdp: 'o' }; }
  async createAnswer() {
    // Mirrors the browser: the answer sends only on negotiated transceivers.
    const audio = this.transceivers.find((t) => t.mid !== null && t.receiver.track.kind === 'audio');
    const sends = !!audio?.sender.track && audio.direction === 'sendrecv';
    return { type: 'answer' as RTCSdpType, sdp: sends ? 'a=sendrecv' : 'a=recvonly' };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) { this.localDescription = d; }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteDescription = d;
    if (d.type === 'offer') {
      // Browsers never reuse addTransceiver() transceivers for remote m-lines.
      ['audio', 'video'].forEach((kind, i) => {
        if (this.transceivers.some((t) => t.mid === String(i))) return;
        const t = new FakeTransceiver(kind, 'recvonly');
        t.mid = String(i);
        this.transceivers.push(t);
      });
    }
  }
}

const created: FakePC[] = [];
const mic: FakeTrack = { kind: 'audio', readyState: 'live', enabled: true, id: 'mic' };

beforeEach(() => {
  sent.length = 0;
  created.length = 0;
  // @ts-expect-error – install fake constructor
  globalThis.RTCPeerConnection = class extends FakePC { constructor() { super(); created.push(this); } };
  // @ts-expect-error – test shim
  globalThis.RTCSessionDescription = function (init: RTCSessionDescriptionInit) { return init; };
});

async function managerWithMic() {
  const m = new WebRTCManager('local-peer', 'Local');
  await m.joinRoom('brain');
  // @ts-expect-error – private: a live microphone without getUserMedia
  m.localStream = { getAudioTracks: () => [mic], getVideoTracks: () => [], getTracks: () => [mic] };
  return m;
}

describe('answering side sends its microphone', () => {
  it('a newcomer answering an offer sends audio in the answer itself', async () => {
    await managerWithMic();
    signalHandler!({ msgType: 'offer', from: 'peer-Z', roomId: 'brain', ts: 1, data: { type: 'offer', sdp: 'x' } });
    await new Promise((r) => setTimeout(r, 0));
    const pc = created[0];
    expect(pc.addTransceiver).not.toHaveBeenCalled();
    const answer = sent.find((s) => s.type === 'answer');
    expect((answer?.data as { sdp: string }).sdp).toBe('a=sendrecv');
    expect(pc.transceivers[0].sender.track).toBe(mic);
  });

  it('after glare rollback the mic moves to the offered transceiver', async () => {
    const m = await managerWithMic();
    // Our own connection exists with upfront transceivers (we were offering).
    await m.createPeerConnection('peer-0');
    const pc = created[0];
    expect(pc.transceivers).toHaveLength(2);
    signalHandler!({ msgType: 'offer', from: 'peer-0', roomId: 'brain', ts: 1, data: { type: 'offer', sdp: 'x' } });
    await new Promise((r) => setTimeout(r, 0));
    const answer = sent.find((s) => s.type === 'answer');
    expect((answer?.data as { sdp: string }).sdp).toBe('a=sendrecv');
    expect(pc.transceivers[0].direction).toBe('stopped');
    expect(pc.transceivers[0].sender.track).toBeNull();
    expect(pc.transceivers.find((t) => t.mid === '0')?.sender.track).toBe(mic);
  });
});
