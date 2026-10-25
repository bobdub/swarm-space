/**
 * Muted peers (Brain) — a LOCAL-ONLY presentation mute.
 *
 * Muting a peer hides their audio, camera tile, avatar, world placements
 * and chat messages on THIS device only. It never severs the mesh edge —
 * that is what Block does (via the P2P blocklist). Because blocking also
 * writes a mute entry here, every render filter only has to consult this
 * one store.
 *
 * Identities are matched against BOTH the WebRTC peer id and the signed-in
 * user id, because different layers key the same person differently:
 * avatars/audio/video use peerId, world placements use actorId (user id),
 * chat lines carry both.
 */
import { useSyncExternalStore } from 'react';

export interface MutedPeerEntry {
  peerId?: string;
  userId?: string;
  username: string;
  mutedAt: number;
}

const STORAGE_KEY = 'brain:muted-peers:v1';

function hasBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function load(): MutedPeerEntry[] {
  if (!hasBrowserStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is Partial<MutedPeerEntry> => Boolean(v) && typeof v === 'object')
      .map((v) => ({
        peerId: typeof v.peerId === 'string' && v.peerId ? v.peerId : undefined,
        userId: typeof v.userId === 'string' && v.userId ? v.userId : undefined,
        username: typeof v.username === 'string' && v.username ? v.username : 'peer',
        mutedAt: typeof v.mutedAt === 'number' ? v.mutedAt : Date.now(),
      }))
      .filter((e) => e.peerId || e.userId);
  } catch {
    return [];
  }
}

let entries: MutedPeerEntry[] = load();
const listeners = new Set<() => void>();

function persist(): void {
  if (!hasBrowserStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* storage full / unavailable — mute still works for the session */
  }
}

function emit(): void {
  listeners.forEach((fn) => {
    try { fn(); } catch { /* listener errors must not break the store */ }
  });
}

export function listMutedPeers(): MutedPeerEntry[] {
  return entries;
}

/** True when `id` matches any muted entry's peerId OR userId. */
export function isPeerMuted(id?: string | null): boolean {
  if (!id) return false;
  return entries.some((e) => e.peerId === id || e.userId === id);
}

export function mutePeer(entry: { peerId?: string; userId?: string; username: string }): void {
  if (!entry.peerId && !entry.userId) return;
  entries = entries.filter(
    (e) => e.peerId !== entry.peerId && e.userId !== entry.userId,
  );
  entries.push({
    peerId: entry.peerId,
    userId: entry.userId,
    username: entry.username || 'peer',
    mutedAt: Date.now(),
  });
  persist();
  emit();
}

/** Remove every mute entry whose peerId or userId matches `id`. */
export function unmutePeer(id: string): void {
  const next = entries.filter((e) => e.peerId !== id && e.userId !== id);
  if (next.length === entries.length) return;
  entries = next;
  persist();
  emit();
}

export function subscribeMutedPeers(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** React hook — re-renders whenever the mute list changes. */
export function useMutedPeers(): MutedPeerEntry[] {
  return useSyncExternalStore(subscribeMutedPeers, listMutedPeers, listMutedPeers);
}
