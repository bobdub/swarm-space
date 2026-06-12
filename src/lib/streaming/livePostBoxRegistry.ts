/**
 * Registry of live rooms currently being presented via a `LivePostBox`
 * in the feed. The global `BrainChatLauncher` consults this so it
 * doesn't double-up controls for a room the post box already owns.
 */
const active = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

export function registerLivePostBox(roomId: string): () => void {
  active.add(roomId);
  emit();
  return () => {
    active.delete(roomId);
    emit();
  };
}

export function isLivePostBoxActive(roomId: string | null | undefined): boolean {
  if (!roomId) return false;
  return active.has(roomId);
}

export function subscribeLivePostBoxes(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}