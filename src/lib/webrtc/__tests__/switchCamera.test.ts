import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/streaming/webrtcSignalingBridge.standalone', () => ({
  sendSignalViaMesh: vi.fn(),
  sendReconnectRequest: vi.fn(),
  sendScreenShareState: vi.fn(),
  sendMediaState: vi.fn(),
  announceJoinRoom: vi.fn(),
  announceLeaveRoom: vi.fn(),
  onSignal: () => () => {},
  getLocalMeshPeerId: () => 'local-peer',
  isBridgeActive: () => true,
}));

import { WebRTCManager } from '../manager';

class FakeTrack {
  kind = 'video';
  enabled = true;
  readyState: MediaStreamTrackState = 'live';
  constructor(public deviceId: string) {}
  getSettings() { return { deviceId: this.deviceId }; }
  stop = vi.fn(() => { this.readyState = 'ended'; });
}

class FakeStream {
  tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) { this.tracks = tracks; }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
  getTracks() { return [...this.tracks]; }
  addTrack(t: FakeTrack) { this.tracks.push(t); }
  removeTrack(t: FakeTrack) { this.tracks = this.tracks.filter((x) => x !== t); }
}

function fakePeer(track: FakeTrack) {
  const sender = { track: track as unknown, replaceTrack: vi.fn(async (t: unknown) => { sender.track = t; }) };
  const audio = { sender: { track: null, replaceTrack: vi.fn() } };
  const pc = {
    getTransceivers: () => [audio, { sender }],
    getSenders: () => [audio.sender, sender],
  };
  return { pc, sender };
}

describe('WebRTCManager.switchCamera', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getUserMedia = vi.fn(async (c: { video: { deviceId: { exact: string } } }) =>
      new FakeStream([new FakeTrack(c.video.deviceId.exact)]));
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
  });

  function setup() {
    const m = new WebRTCManager('local-peer', 'Local');
    const front = new FakeTrack('front');
    const local = new FakeStream([front]);
    // @ts-expect-error – private
    m.localStream = local;
    const a = fakePeer(front);
    const b = fakePeer(front);
    // @ts-expect-error – private
    m.connections.set('peer-a', a.pc);
    // @ts-expect-error – private
    m.connections.set('peer-b', b.pc);
    const offer = vi.spyOn(m as unknown as { createOfferForPeer: () => Promise<void> }, 'createOfferForPeer');
    return { m, front, local, a, b, offer };
  }

  it('replaces the video track on every peer without renegotiating', async () => {
    const { m, front, local, a, b, offer } = setup();
    await m.switchCamera('back');

    expect(a.sender.replaceTrack).toHaveBeenCalledTimes(1);
    expect(b.sender.replaceTrack).toHaveBeenCalledTimes(1);
    expect((a.sender.track as FakeTrack).deviceId).toBe('back');
    expect(offer).not.toHaveBeenCalled();
    expect(front.stop).toHaveBeenCalled();
    expect(local.getVideoTracks().map((t) => t.deviceId)).toEqual(['back']);
    expect(m.getActiveCameraId()).toBe('back');
  });

  it('keeps a camera that was turned off turned off', async () => {
    const { m, front, local } = setup();
    front.enabled = false;
    await m.switchCamera('back');
    expect(local.getVideoTracks()[0].enabled).toBe(false);
  });

  it('does nothing when the chosen camera is already active', async () => {
    const { m } = setup();
    await m.switchCamera('front');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('releases the old camera first when the device cannot open two at once', async () => {
    const { m, front } = setup();
    getUserMedia.mockRejectedValueOnce(new Error('NotReadableError'));
    await m.switchCamera('back');
    expect(front.stop).toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(m.getActiveCameraId()).toBe('back');
  });
});
