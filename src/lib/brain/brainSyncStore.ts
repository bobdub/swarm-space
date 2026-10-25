/**
 * Brain sync — app-wide "stay in this Brain room" setting. Leaving the
 * Brain page does not end the conversation; only an explicit Disconnect
 * (or joining a live stream room) clears it. A page refresh starts fresh:
 * the setting lives in memory only, never restored.
 */
import { useSyncExternalStore } from 'react';

let syncedRoomId: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });

export function getBrainSyncRoom(): string | null { return syncedRoomId; }

export function isBrainSynced(roomId: string): boolean { return syncedRoomId === roomId; }

export function syncBrainRoom(roomId: string): void {
  if (syncedRoomId === roomId) return;
  syncedRoomId = roomId;
  emit();
}

export function clearBrainSync(): void {
  if (syncedRoomId === null) return;
  syncedRoomId = null;
  emit();
}

export function subscribeBrainSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useBrainSyncRoom(): string | null {
  return useSyncExternalStore(subscribeBrainSync, getBrainSyncRoom, getBrainSyncRoom);
}
