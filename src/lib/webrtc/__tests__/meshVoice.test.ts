import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { VoiceHealth } from '../meshVoice';
import { VoiceKeys } from '../meshVoiceCrypto';
import { onVoicePacket, sendVoicePacket, startMeshVoiceTransport, validVoicePacket, type VoicePacket } from '../meshVoiceTransport';

afterEach(() => vi.unstubAllGlobals());
const packet = (): VoicePacket => ({ kind: 'audio', from: 'B', to: 'C', roomId: 'brain', session: 's', seq: 1,
  hops: 0, ts: Date.now(), pcm: 'a'.repeat(4288), iv: 'a'.repeat(16) });

describe('mesh voice fallback', () => {
  it('starts on mesh, hands off after sustained inbound RTP, and returns after a stall', () => {
    const health = new VoiceHealth();
    expect(health.sample(0, false, 0)).toBe(true);
    expect(health.sample(100, true, 1000)).toBe(true);
    expect(health.sample(200, true, 2000)).toBe(true);
    expect(health.sample(300, true, 3000)).toBe(false);
    expect(health.sample(300, true, 4000)).toBe(false);
    expect(health.sample(300, true, 5000)).toBe(true);
  });
  it('a connected but silent RTP transport never disables fallback', () => {
    const health = new VoiceHealth();
    for (let i = 0; i < 180; i++) expect(health.sample(0, true, i * 1000)).toBe(true);
  });
  it('rejects stale, oversized and over-hopped frames', () => {
    expect(validVoicePacket(packet())).toBe(true);
    expect(validVoicePacket({ ...packet(), ts: Date.now() - 2001 })).toBe(false);
    expect(validVoicePacket({ ...packet(), pcm: 'a'.repeat(50000) })).toBe(false);
    expect(validVoicePacket({ ...packet(), hops: 3 })).toBe(false);
  });
  it('relays B to C through A once and respects the two-hop ceiling', async () => {
    let receive: (via: string, raw: unknown) => void = () => {};
    const send = vi.fn(async () => true);
    const stop = startMeshVoiceTransport({ getPeerId: () => 'A', getConnectedPeerIds: () => ['B', 'C'], send,
      onMessage: (_channel, h) => { receive = h; return () => {}; } });
    const p = packet(); receive('B', p); receive('B', p);
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('mesh-voice', 'C', { ...p, hops: 1 });
    receive('B', { ...p, seq: 2, hops: 2 });
    expect(send).toHaveBeenCalledTimes(1);
    stop();
  });
  it('receives a relayed frame only once and stops delivery on cleanup', () => {
    let receive: (via: string, raw: unknown) => void = () => {};
    const listener = vi.fn(); const off = onVoicePacket(listener);
    const stop = startMeshVoiceTransport({ getPeerId: () => 'C', getConnectedPeerIds: () => ['A'], send: async () => true,
      onMessage: (_channel, h) => { receive = h; return () => {}; } });
    const p = { ...packet(), hops: 1 }; receive('A', p); receive('A', p);
    expect(listener).toHaveBeenCalledTimes(1);
    stop(); receive('A', { ...p, seq: 2 }); expect(listener).toHaveBeenCalledTimes(1); off();
  });
  it('drops rather than queues frames while the mesh send is busy', () => {
    const send = vi.fn(() => new Promise<boolean>(() => {}));
    const stop = startMeshVoiceTransport({ getPeerId: () => 'B', getConnectedPeerIds: () => ['A'], send,
      onMessage: () => () => {} });
    for (let seq = 0; seq < 100; seq++) sendVoicePacket({ roomId: 'brain', to: 'C', kind: 'audio', session: 's', seq, pcm: 'a'.repeat(4288), iv: 'a'.repeat(16) });
    expect(send).toHaveBeenCalledTimes(1); stop();
  });
  it('encrypts independent audio frames for the recipient and rejects changed room or ciphertext', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const b = new VoiceKeys(); const c = new VoiceKeys(); const relay = new VoiceKeys();
    await Promise.all([b.init(), c.init(), relay.init()]);
    await b.accept('C', c.publicKey); await c.accept('B', b.publicKey); await relay.accept('B', b.publicKey);
    const data = new Uint8Array(3200).fill(23);
    const encrypted = await b.encrypt('C', data.buffer, 'brain|s|1');
    if (!encrypted) throw new Error('Missing encrypted frame');
    expect(encrypted.pcm).toHaveLength(4288);
    expect(new Uint8Array(await c.decrypt('B', encrypted.pcm, encrypted.iv, 'brain|s|1') ?? new ArrayBuffer(0))).toEqual(data);
    expect(await relay.decrypt('B', encrypted.pcm, encrypted.iv, 'brain|s|1')).toBeNull();
    expect(await c.decrypt('B', encrypted.pcm, encrypted.iv, 'other|s|1')).toBeNull();
  });
});