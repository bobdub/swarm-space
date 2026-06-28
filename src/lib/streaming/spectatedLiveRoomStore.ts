/**
 * Tiny pub/sub for the room id the local user is *passively* spectating
 * from the feed. The `LiveRoomVoiceHost` reads this and joins the mesh
 * receive-only so audio/video flow from the room into the feed post
 * without requiring an active participant join.
 */
/**
 * Tiny pub/sub for the room id the local user is engaged with (spectator
 * or participant) from outside the StreamingContext join lifecycle. The
 * `LiveRoomVoiceHost` reads this and owns the single WebRTC `joinRoom`
 * call so concurrent UI surfaces (inline feed preview + floating dock)
 * never both call `leaveRoom` on unmount and kick each other out.
 *
 * Audio resolution: if any registrant wants audio (participant mode),
 * the host joins audio-enabled; otherwise it joins receive-only.
 */
import { useSyncExternalStore } from 'react';

type Listener = () => void;

interface Entry { audio: number; passive: number; }

const entries: Map<string, Entry> = new Map();
const listeners: Set<Listener> = new Set();

let snapshot: { roomId: string | null; audio: boolean } = { roomId: null, audio: false };

function emit() { for (const l of listeners) l(); }

function recompute() {
  // Pick the room with any participant registrant first (audio wins);
  // otherwise the room with the most registrants. Stable across renders.
  let pickAudio: string | null = null;
  let pickPassive: string | null = null;
  let passiveBest = 0;
  for (const [roomId, e] of entries) {
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