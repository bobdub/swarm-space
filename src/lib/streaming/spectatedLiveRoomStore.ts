/**
 * Tiny pub/sub for the room id the local user is *passively* spectating
 * from the feed. The `LiveRoomVoiceHost` reads this and joins the mesh
 * receive-only so audio/video flow from the room into the feed post
 * without requiring an active participant join.
 */
import { useSyncExternalStore } from 'react';

type Listener = () => void;

let current: string | null = null;
const refCounts: Map<string, number> = new Map();
const listeners: Set<Listener> = new Set();

function emit() { for (const l of listeners) l(); }

function recomputeCurrent() {
  let pick: string | null = null;
  let best = 0;
  for (const [roomId, n] of refCounts) {
    if (n > best) { best = n; pick = roomId; }
  }
  if (pick !== current) { current = pick; emit(); }
}

export function registerSpectatedRoom(roomId: string): () => void {
  refCounts.set(roomId, (refCounts.get(roomId) ?? 0) + 1);
  recomputeCurrent();
  return () => {
    const n = (refCounts.get(roomId) ?? 1) - 1;
    if (n <= 0) refCounts.delete(roomId);
    else refCounts.set(roomId, n);
    recomputeCurrent();
  };
}

export function getSpectatedRoom(): string | null { return current; }
export function subscribeSpectatedRoom(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSpectatedRoom(): string | null {
  return useSyncExternalStore(subscribeSpectatedRoom, getSpectatedRoom, () => null);
}