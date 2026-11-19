import { getCallAudioContext, resumeCallAudio } from './sharedAudioContext';
import { onVoicePacket, sendVoicePacket, type VoicePacket } from './meshVoiceTransport';
import { isPeerMuted, subscribeMutedPeers } from '@/lib/brain/mutedPeersStore';
import { VoiceKeys } from './meshVoiceCrypto';

export class VoiceHealth {
  private bytes = -1;
  private lastGrowth = 0;
  private good = 0;
  fallback = true;
  sample(bytes: number, connected: boolean, now: number): boolean {
    if (connected && bytes > this.bytes && this.bytes >= 0) {
      this.lastGrowth = now;
      this.good++;
      if (this.good >= 3) this.fallback = false;
    } else {
      this.good = 0;
      if (!connected || now - this.lastGrowth >= 2000) this.fallback = true;
    }
    this.bytes = bytes;
    return this.fallback;
  }
}

type Peer = { peerId: string; isMuted: boolean };
type Owner = {
  getLocalStream(): MediaStream | null;
  isSelfMuted(): boolean;
  getParticipants(): Peer[];
  getInboundAudioBytes(peerId: string): Promise<{ bytes: number; connected: boolean }>;
};
let workletLoaded: Promise<void> | null = null;

/** Room-scoped receive-driven failover; RTP health is measured, not guessed from track existence. */
export class MeshVoice {
  private room: string | null = null;
  private session = '';
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private unmute: (() => void) | null = null;
  private capture: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private track: MediaStreamTrack | null = null;
  private health = new Map<string, VoiceHealth>();
  private requests = new Map<string, number>();
  private playUntil = new Map<string, number>();
  private playing = new Map<string, Set<AudioBufferSourceNode>>();
  private received = new Map<string, { session: string; seq: number }>();
  private lastPlayback = new Map<string, number>();
  private polling = false;
  private capturing = false;
  private keys: VoiceKeys | null = null;
  private sending = new Set<string>();
  constructor(private owner: Owner, private changed: () => void) {}

  isFallback(peer: string): boolean {
    return this.room !== null && this.keys !== null && typeof AudioWorkletNode !== 'undefined' &&
      (this.health.get(peer)?.fallback ?? true);
  }

  hasPlayback(peer: string): boolean {
    return this.isFallback(peer) && Date.now() - (this.lastPlayback.get(peer) ?? 0) < 1500;
  }

  start(room: string): void {
    if (this.room === room) return;
    this.stop();
    this.room = room;
    this.session = crypto.randomUUID();
    resumeCallAudio();
    const keys = new VoiceKeys();
    const session = this.session;
    void keys.init().then(() => {
      if (this.session === session && this.room === room) { this.keys = keys; this.changed(); }
    }).catch(() => {});
    this.unsub = onVoicePacket(p => { void this.receive(p).catch(() => {}); });
    this.unmute = subscribeMutedPeers(() => {
      for (const peer of this.playing.keys()) if (isPeerMuted(peer)) this.stopPlayback(peer);
    });
    window.addEventListener('pointerdown', resumeCallAudio);
    window.addEventListener('keydown', resumeCallAudio);
    this.timer = setInterval(() => { void this.poll(); }, 1000);
    void this.poll();
  }

  private async poll(): Promise<void> {
    if (this.polling || !this.room) return;
    this.polling = true;
    const room = this.room;
    try {
      const peers = this.owner.getParticipants();
      const ids = new Set(peers.map(p => p.peerId));
      for (const [peer, ts] of this.lastPlayback) if (Date.now() - ts >= 1500) {
        this.lastPlayback.delete(peer); this.changed();
      }
      for (const id of this.health.keys()) if (!ids.has(id)) {
        this.health.delete(id); this.requests.delete(id); this.received.delete(id); this.stopPlayback(id);
      }
      await Promise.all(peers.map(async peer => {
        const result = await this.owner.getInboundAudioBytes(peer.peerId).catch(() => ({ bytes: 0, connected: false }));
        if (this.room !== room) return;
        const health = this.health.get(peer.peerId) ?? new VoiceHealth();
        const before = health.fallback;
        const fallback = health.sample(result.bytes, result.connected, Date.now());
        this.health.set(peer.peerId, health);
        if (!fallback) this.stopPlayback(peer.peerId);
        if (before !== fallback) this.changed();
        if (this.keys) sendVoicePacket({ kind: 'request', roomId: room, to: peer.peerId, session: this.session,
          seq: this.seq++, key: this.keys.publicKey, enabled: fallback && !peer.isMuted && !isPeerMuted(peer.peerId) });
      }));
      await this.syncCapture();
    } finally { this.polling = false; }
  }

  private async syncCapture(): Promise<void> {
    const track = this.owner.getLocalStream()?.getAudioTracks().find(t => t.readyState === 'live');
    const wanted = this.room && !this.owner.isSelfMuted() && track && track.enabled &&
      [...this.requests.values()].some(until => until > Date.now());
    if (!wanted) { this.closeCapture(); return; }
    if (this.track === track || this.capturing) return;
    this.closeCapture();
    const ctx = getCallAudioContext();
    if (!ctx?.audioWorklet) return;
    const room = this.room;
    this.capturing = true;
    try {
      workletLoaded ??= ctx.audioWorklet.addModule('/audio/mesh-voice-capture.js').catch(error => { workletLoaded = null; throw error; });
      await workletLoaded;
      if (this.room !== room || this.owner.isSelfMuted() || !track.enabled || track.readyState !== 'live') return;
      this.capture = new AudioWorkletNode(ctx, 'mesh-voice-capture', { numberOfOutputs: 0 });
      this.source = ctx.createMediaStreamSource(new MediaStream([track]));
      this.track = track;
      this.capture.port.onmessage = e => {
        if (!this.room || this.owner.isSelfMuted() || !track.enabled || track.readyState !== 'live') return;
        const bytes = new Uint8Array(e.data as ArrayBuffer);
        if (bytes.length !== 3200) return;
        for (const [to, until] of this.requests) {
          if (until < Date.now()) { this.requests.delete(to); continue; }
          if (!this.owner.getParticipants().some(p => p.peerId === to)) continue;
          if (this.sending.has(to) || !this.keys) continue;
          this.sending.add(to);
          const roomId = this.room;
          const session = this.session;
          const seq = this.seq++;
          void this.keys.encrypt(to, bytes.buffer, `${roomId}|${session}|${seq}`).then(encrypted => {
            if (encrypted && this.room === roomId && this.session === session && !this.owner.isSelfMuted() && track.enabled &&
                (this.requests.get(to) ?? 0) > Date.now()) {
              sendVoicePacket({ kind: 'audio', roomId, to, session, seq, ...encrypted });
            }
          }).catch(() => {}).finally(() => this.sending.delete(to));
        }
      };
      this.source.connect(this.capture);
      resumeCallAudio();
    } catch { /* Unsupported audio worklet: retain ordinary WebRTC, never break the call. */ }
    finally { this.capturing = false; }
  }

  private async receive(p: VoicePacket): Promise<void> {
    const peer = this.owner.getParticipants().find(v => v.peerId === p.from);
    if (!this.room || p.roomId !== this.room || !peer) return;
    if (p.kind === 'request') {
      if (!this.keys || !p.key) return;
      await this.keys.accept(p.from, p.key);
      if (this.room !== p.roomId || !this.owner.getParticipants().some(v => v.peerId === p.from)) return;
      if (p.enabled) this.requests.set(p.from, Date.now() + 3000);
      else this.requests.delete(p.from);
      void this.syncCapture();
      return;
    }
    if (!this.isFallback(p.from) || peer.isMuted || isPeerMuted(p.from) || !p.pcm || !p.iv || !this.keys) return;
    const previous = this.received.get(p.from);
    if (previous?.session === p.session && p.seq <= previous.seq) return;
    const decoded = await this.keys.decrypt(p.from, p.pcm, p.iv, `${p.roomId}|${p.session}|${p.seq}`);
    if (!decoded || this.room !== p.roomId || !this.isFallback(p.from) || isPeerMuted(p.from) || peer.isMuted ||
        !this.owner.getParticipants().some(v => v.peerId === p.from)) return;
    const latest = this.received.get(p.from);
    if (latest?.session === p.session && p.seq <= latest.seq) return;
    this.received.set(p.from, { session: p.session, seq: p.seq });
    const ctx = getCallAudioContext();
    if (!ctx || ctx.state !== 'running') return; // No backlog awaiting an autoplay gesture.
    const start = Math.max(ctx.currentTime + 0.02, this.playUntil.get(p.from) ?? 0);
    if (start - ctx.currentTime > 0.3) return;
    try {
      if (decoded.byteLength !== 3200) return;
      const raw = new DataView(decoded);
      const buffer = ctx.createBuffer(1, 1600, 16000);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = raw.getInt16(i * 2, true) / 32768;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      const sources = this.playing.get(p.from) ?? new Set<AudioBufferSourceNode>();
      sources.add(source); this.playing.set(p.from, sources);
      source.onended = () => { source.disconnect(); sources.delete(source); };
      source.start(start);
      this.playUntil.set(p.from, start + 0.1);
      const wasPlaying = this.hasPlayback(p.from);
      this.lastPlayback.set(p.from, Date.now());
      if (!wasPlaying) this.changed();
    } catch { /* malformed live frame */ }
  }

  private closeCapture(): void {
    this.source?.disconnect();
    if (this.capture) { this.capture.port.onmessage = null; this.capture.disconnect(); this.capture.port.close(); }
    this.source = null; this.capture = null; this.track = null;
  }
  private stopPlayback(peer: string): void {
    for (const source of this.playing.get(peer) ?? []) { try { source.stop(); source.disconnect(); } catch { /* ended */ } }
    this.playing.delete(peer); this.playUntil.delete(peer);
    this.lastPlayback.delete(peer);
  }
  stop(): void {
    this.room = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.unsub?.(); this.unsub = null; this.unmute?.(); this.unmute = null;
    window.removeEventListener('pointerdown', resumeCallAudio);
    window.removeEventListener('keydown', resumeCallAudio);
    this.closeCapture();
    for (const peer of this.playing.keys()) this.stopPlayback(peer);
    this.health.clear(); this.requests.clear(); this.received.clear();
    this.keys = null; this.sending.clear();
  }
}