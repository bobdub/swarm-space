import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/streaming/webrtcSignalingBridge.standalone', () => ({
  sendSignalViaMesh: vi.fn(),
  sendReconnectRequest: vi.fn(),
  sendScreenShareState: vi.fn(),
  sendScreenView: vi.fn(),
  sendMediaState: vi.fn(),
  announceJoinRoom: vi.fn(),
  announceLeaveRoom: vi.fn(),
  onSignal: () => () => {},
  getLocalMeshPeerId: () => 'local-peer',
  isBridgeActive: () => true,
  registerMediaPeerConnection: vi.fn(),
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
  dispatchEvent() { return true; }
  addTrack(t: FakeTrack) { this.tracks.push(t); }
  removeTrack(t: FakeTrack) { this.tracks = this.tracks.filter((x) => x !== t); }
}

function fakePeer(track: FakeTrack) {
  const sender = {
    track: track as unknown,
    replaceTrack: vi.fn(async (t: unknown): Promise<void> => { sender.track = t; }),
  };
  const audio = { sender: { track: null, replaceTrack: vi.fn() } };
  const pc = {
    getTransceivers: () => [audio, { sender }],
    getSenders: () => [audio.sender, sender],
    connectionState: 'connected',
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
    // @ts-expect-error – private
    m.cameraEnabled = true;
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

  it('abandons the switch and keeps peers dark when the camera is turned off mid-switch', async () => {
    const { m, front, a, b } = setup();
    a.sender.replaceTrack.mockImplementationOnce(async (t: unknown) => {
      a.sender.track = t;
      m.toggleVideo(false);
    });
    await expect(m.switchCamera('back')).rejects.toThrow(/abandoned/);
    // No peer may end up on the new camera, and nothing sent while switching was live.
    expect(a.sender.track).toBe(front);
    expect(b.sender.replaceTrack).not.toHaveBeenCalled();
    const acquired = (await getUserMedia.mock.results[0].value) as FakeStream;
    expect(acquired.tracks[0].stop).toHaveBeenCalled();
  });

  it('releases the new camera if the call ends while it is being opened', async () => {
    const { m } = setup();
    let resolve!: (s: FakeStream) => void;
    getUserMedia.mockImplementationOnce(() => new Promise<FakeStream>((r) => { resolve = r; }));
    const pending = m.switchCamera('back');
    m.stopLocalStream();
    const late = new FakeStream([new FakeTrack('back')]);
    resolve(late);
    await expect(pending).rejects.toThrow(/abandoned/);
    expect(late.tracks[0].stop).toHaveBeenCalled();
  });

  it('keeps the old camera for everyone when a peer rejects the new track', async () => {
    const { m, front, local, a, b } = setup();
    b.sender.replaceTrack.mockRejectedValueOnce(new Error('InvalidModificationError'));
    await expect(m.switchCamera('back')).rejects.toThrow(/abandoned/);
    expect(a.sender.track).toBe(front);
    expect(b.sender.track).toBe(front);
    expect(front.stop).not.toHaveBeenCalled();
    expect(local.getVideoTracks()).toEqual([front]);
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

  it('remembers the pick without opening a camera when the camera is off', async () => {
    const m = new WebRTCManager('local-peer', 'Local');
    localStorage.clear();
    await m.switchCamera('usb-cam');
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('swarm-preferred-devices') ?? '{}').videoInputId).toBe('usb-cam');
  });
});

describe('WebRTCManager.switchMicrophone', () => {
  it('swaps the mic on the audio sender and keeps the user muted', async () => {
    const getUserMedia = vi.fn(async (c: { audio: { deviceId: { exact: string } } }) => {
      const t = new FakeTrack(c.audio.deviceId.exact);
      t.kind = 'audio';
      return new FakeStream([t]);
    });
    Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });

    const m = new WebRTCManager('local-peer', 'Local');
    const oldMic = new FakeTrack('built-in');
    oldMic.kind = 'audio';
    const local = new FakeStream([oldMic]);
    // @ts-expect-error – private
    m.localStream = local;
    m.toggleAudio(false);
    const audioSender = { track: oldMic as unknown, replaceTrack: vi.fn(async (t: unknown) => { audioSender.track = t; }) };
    const pc = { getTransceivers: () => [{ sender: audioSender }], getSenders: () => [audioSender], connectionState: 'connected' };
    // @ts-expect-error – private
    m.connections.set('peer-a', pc);

    await m.switchMicrophone('headset');

    expect((audioSender.track as FakeTrack).deviceId).toBe('headset');
    expect(oldMic.stop).toHaveBeenCalled();
    expect(local.getAudioTracks()[0].deviceId).toBe('headset');
    expect(local.getAudioTracks()[0].enabled).toBe(false);
    expect(m.getActiveMicrophoneId()).toBe('headset');
  });
});
