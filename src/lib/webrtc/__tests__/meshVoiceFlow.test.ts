import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { MeshVoice } from '../meshVoice';
import { VoiceKeys } from '../meshVoiceCrypto';
import { startMeshVoiceTransport, type VoicePacket } from '../meshVoiceTransport';

const audio = vi.hoisted(() => {
  const frames: Float32Array[] = [];
  const played: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const ctx = {
    state: 'running', currentTime: 0, destination: {},
    audioWorklet: { addModule: vi.fn(async () => {}) },
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
    createBuffer: () => { const data = new Float32Array(1600); frames.push(data); return { getChannelData: () => data }; },
    createBufferSource: () => {
      const source = { start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), buffer: null, onended: null };
      played.push(source); return source;
    },
  };
  return { ctx, frames, played };
});
vi.mock('../sharedAudioContext', () => ({ getCallAudioContext: () => audio.ctx, resumeCallAudio: vi.fn() }));
vi.mock('@/lib/brain/mutedPeersStore', () => ({ isPeerMuted: () => false, subscribeMutedPeers: () => () => {} }));

let stopTransport: (() => void) | undefined;
let voice: MeshVoice | undefined;
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 25)); };

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('AudioWorkletNode', class { port = { onmessage: null, close() {} }; disconnect() {} });
  audio.played.length = 0; audio.frames.length = 0;
});
afterEach(() => { voice?.stop(); stopTransport?.(); vi.unstubAllGlobals(); });

describe('room-scoped encrypted voice playback', () => {
  it('plays a relayed microphone frame, rejects duplicates/wrong rooms, and stops on departure', async () => {
    const packets: VoicePacket[] = [];
    let deliver: (via: string, payload: unknown) => void = () => {};
    stopTransport = startMeshVoiceTransport({ getPeerId: () => 'C', getConnectedPeerIds: () => ['A'],
      send: async (_channel, _to, p) => { packets.push(p as VoicePacket); return true; },
      onMessage: (_channel, handler) => { deliver = handler; return () => {}; } });
    const peers = [{ peerId: 'B', isMuted: false }];
    voice = new MeshVoice({ getParticipants: () => peers, getLocalStream: () => null, isSelfMuted: () => false,
      getInboundAudioBytes: async () => ({ bytes: 0, connected: false }) }, vi.fn());
    voice.start('brain');
    await flush();
    // Exercise the same poll used by the room timer, without a live browser.
    await (voice as unknown as { poll(): Promise<void> }).poll();
    const request = packets.find(p => p.kind === 'request');
    if (!request?.key) throw new Error('Receiver did not request mesh voice');
    const sender = new VoiceKeys(); await sender.init(); await sender.accept('C', request.key);
    deliver('A', { kind: 'request', from: 'B', to: 'C', roomId: 'brain', session: 'b', seq: 0, ts: Date.now(), hops: 1,
      enabled: false, key: sender.publicKey });
    await flush();
    const data = new Int16Array(1600).fill(8192);
    const encrypted = await sender.encrypt('C', data.buffer, 'brain|b|1');
    if (!encrypted) throw new Error('No encrypted microphone frame');
    const frame = { kind: 'audio', from: 'B', to: 'C', roomId: 'brain', session: 'b', seq: 1, ts: Date.now(), hops: 1, ...encrypted };
    deliver('A', frame); deliver('A', frame);
    await flush();
    expect(audio.played).toHaveLength(1);
    expect(audio.frames[0][0]).toBe(0.25);
    expect(audio.played[0].start).toHaveBeenCalledWith(0.02);
    deliver('A', { ...frame, seq: 2, roomId: 'other' }); await flush();
    expect(audio.played).toHaveLength(1);
    voice.stop();
    expect(audio.played[0].stop).toHaveBeenCalledTimes(1);
    deliver('A', { ...frame, seq: 3 }); await flush();
    expect(audio.played).toHaveLength(1);
  });
});