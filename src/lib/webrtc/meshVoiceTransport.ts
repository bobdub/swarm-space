import { loadBlocklistFromStorage } from '@/lib/p2p/blocklistStore';

export interface VoiceMesh {
  getPeerId(): string;
  getConnectedPeerIds(): string[];
  send(channel: string, peerId: string, payload: unknown): Promise<boolean>;
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void;
}

export type VoicePacket = {
  roomId: string; from: string; to: string; session: string; seq: number;
  ts: number; hops: number; kind: 'request' | 'audio';
  enabled?: boolean; key?: string; pcm?: string; iv?: string;
};
const CHANNEL = 'mesh-voice';
let mesh: VoiceMesh | null = null;
const handlers = new Set<(packet: VoicePacket) => void>();
const seen = new Map<string, number>();
const pending = new Set<string>();

export function validVoicePacket(raw: unknown, now = Date.now()): raw is VoicePacket {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as VoicePacket;
  return [p.roomId, p.from, p.to, p.session].every(v => typeof v === 'string' && v.length > 0 && v.length <= 256)
    && Number.isSafeInteger(p.seq) && p.seq >= 0 && Number.isInteger(p.hops) && p.hops >= 0 && p.hops <= 2
    && Number.isFinite(p.ts) && Math.abs(now - p.ts) <= 2000
    && (p.kind === 'request' ? typeof p.enabled === 'boolean' && typeof p.key === 'string' && p.key.length === 88
      : p.kind === 'audio' && typeof p.pcm === 'string' && p.pcm.length === 4288 && /^[A-Za-z0-9+/]+={0,2}$/.test(p.pcm)
        && typeof p.iv === 'string' && p.iv.length === 16);
}

async function deliver(p: VoicePacket, exclude?: string): Promise<void> {
  const current = mesh;
  if (!current) return;
  const peers = current.getConnectedPeerIds();
  const blocked = new Set(loadBlocklistFromStorage().map(entry => entry.peerId));
  if (blocked.has(p.to) || blocked.has(p.from)) return;
  const relay = peers.filter(id => id !== exclude && id !== p.from && id !== p.to && !blocked.has(id)).slice(0, 3);
  const send = async (id: string): Promise<boolean> => {
    if (pending.has(id)) return; // Never accumulate an audio send queue.
    pending.add(id);
    try { return await current.send(CHANNEL, id, p); } catch { return false; }
    finally { pending.delete(id); }
  };
  if (peers.includes(p.to)) {
    const sent = await send(p.to);
    if (sent !== false || mesh !== current) return;
  }
  await Promise.all(relay.map(send));
}

export function startMeshVoiceTransport(next: VoiceMesh): () => void {
  mesh = next;
  const unsub = next.onMessage(CHANNEL, (via, raw) => {
    if (mesh !== next || !validVoicePacket(raw) || raw.from === next.getPeerId()) return;
    if (loadBlocklistFromStorage().some(entry => entry.peerId === raw.from || entry.peerId === via)) return;
    if (raw.hops === 0 && raw.from !== via) return;
    const key = `${raw.from}|${raw.to}|${raw.session}|${raw.kind}|${raw.seq}`;
    if (seen.has(key)) return;
    seen.set(key, Date.now());
    for (const [k, ts] of seen) if (Date.now() - ts > 2000 || seen.size > 1024) seen.delete(k);
    if (raw.to === next.getPeerId()) handlers.forEach(h => h(raw));
    else if (raw.hops < 2) void deliver({ ...raw, hops: raw.hops + 1 }, via);
  });
  return () => { unsub(); if (mesh === next) mesh = null; seen.clear(); pending.clear(); };
}

export function sendVoicePacket(packet: Omit<VoicePacket, 'from' | 'hops' | 'ts'>): void {
  if (mesh) void deliver({ ...packet, from: mesh.getPeerId(), hops: 0, ts: Date.now() });
}

export function onVoicePacket(handler: (packet: VoicePacket) => void): () => void {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}