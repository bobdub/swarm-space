/**
 * Tiny pub/sub for the room id the local user is engaged with (spectator
 * or participant) from outside the StreamingContext join lifecycle. The
 * `LiveRoomVoiceHost` reads this and owns the single WebRTC `joinRoom`
 * call so concurrent UI surfaces (inline feed preview + floating dock)
 * never both call `leaveRoom` on unmount and kick each other out.
 *
 * Audio resolution: if any registrant wants audio (participant mode),
 * the host joins audio-enabled; otherwise it joins receive-only.
 *
 * Leave latch: after `LivePostBoxBody.handleLeave` the user must not be
 * silently re-joined by a remounting passive preview. `latchLeave` blocks
 * further registrations for the given room until it is cleared or its
 * TTL elapses (default 30s).
 */
import { useSyncExternalStore } from 'react';

type Listener = () => void;

interface Entry { audio: number; passive: number; }

const entries: Map<string, Entry> = new Map();
const leaveLatch: Map<string, number> = new Map(); // roomId -> expiresAt epoch ms
const listeners: Set<Listener> = new Set();

let snapshot: { roomId: string | null; audio: boolean } = { roomId: null, audio: false };

function emit() { for (const l of listeners) l(); }

function pruneLatch() {
  const now = Date.now();
  for (const [roomId, until] of leaveLatch) {
    if (until <= now) leaveLatch.delete(roomId);
  }
}

function recompute() {
  pruneLatch();
  let pickAudio: string | null = null;
  let pickPassive: string | null = null;
  let passiveBest = 0;
  for (const [roomId, e] of entries) {
    if (leaveLatch.has(roomId)) continue;
    if (e.audio > 0 && !pickAudio) pickAudio = roomId;
    const total = e.audio + e.passive;
    if (total > passiveBest) { passiveBest = total; pickPassive = roomId; }
  }
  const next = pickAudio
    ? { roomId: pickAudio, audio: true }
    : { roomId: pickPassive, audio: false };
  if (next.roomId !== snapshot.roomId || next.audio !== snapshot.audio) {
    snapshot = next;
    emit();
  }
}

export function registerLiveRoomBinding(roomId: string, opts: { audio: boolean }): () => void {
  pruneLatch();
  if (leaveLatch.has(roomId)) {
    // User explicitly left — refuse to re-bind until the latch clears.
    return () => { /* no-op */ };
  }
  const existing = entries.get(roomId) ?? { audio: 0, passive: 0 };
  if (opts.audio) existing.audio += 1; else existing.passive += 1;
  entries.set(roomId, existing);
  recompute();
  return () => {
    const cur = entries.get(roomId);
    if (!cur) return;
    if (opts.audio) cur.audio = Math.max(0, cur.audio - 1);
    else cur.passive = Math.max(0, cur.passive - 1);
    if (cur.audio === 0 && cur.passive === 0) entries.delete(roomId);
    else entries.set(roomId, cur);
    recompute();
  };
}

/** Block further registrations for `roomId` for `ttlMs` (default 30s) and
 *  drop any existing entries so the voice host leaves immediately. */
export function latchLeave(roomId: string, ttlMs = 30_000): void {
  leaveLatch.set(roomId, Date.now() + Math.max(1000, ttlMs));
  entries.delete(roomId);
  recompute();
}

export function clearLeaveLatch(roomId: string): void {
  if (leaveLatch.delete(roomId)) recompute();
}

export function isLeaveLatched(roomId: string | null | undefined): boolean {
  if (!roomId) return false;
  pruneLatch();
  return leaveLatch.has(roomId);
}

export function getLiveRoomBinding(): { roomId: string | null; audio: boolean } {
  return snapshot;
}

export function subscribeLiveRoomBinding(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useLiveRoomBinding(): { roomId: string | null; audio: boolean } {
  return useSyncExternalStore(subscribeLiveRoomBinding, getLiveRoomBinding, () => snapshot);
}
