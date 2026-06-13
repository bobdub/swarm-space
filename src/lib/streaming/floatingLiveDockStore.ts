import type { StreamRoom } from "@/types/streaming";

/**
 * Global "popped-out" live dock store. When a user clicks "Pop out" on
 * a LivePostBox, the body is detached from the inline post card and
 * re-rendered inside the app-level `FloatingLiveDock` so it survives
 * route navigation.
 */
export interface FloatingLiveDockEntry {
  roomId: string;
  room: StreamRoom;
  title: string;
  visibility?: string;
}

let current: FloatingLiveDockEntry | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

export function getFloatingLiveDock(): FloatingLiveDockEntry | null {
  return current;
}

export function setFloatingLiveDock(entry: FloatingLiveDockEntry | null): void {
  current = entry;
  emit();
}

export function isFloatingLiveDockActive(roomId: string | null | undefined): boolean {
  if (!roomId) return false;
  return current?.roomId === roomId;
}

export function subscribeFloatingLiveDock(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Keep the stored room snapshot fresh so the floating dock has the
 *  latest participants/title even after the inline post unmounts. */
export function refreshFloatingLiveDockRoom(room: StreamRoom): void {
  if (!current || current.roomId !== room.id) return;
  current = { ...current, room, title: (room.title || current.title || "Live room").trim() };
  emit();
}