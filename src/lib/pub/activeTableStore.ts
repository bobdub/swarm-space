/**
 * activeTableStore — which pub table the local player is at right now,
 * plus the function that leaves it.
 *
 * PubGameLayer (a DOM overlay) owns the open table; the 3D bar scene
 * reads this store to draw the in-world "hold to leave" button on the
 * card table and beside the dartboard.
 */

import { useSyncExternalStore } from 'react';

let activeTableId: string | null = null;
let leaveFn: (() => void) | null = null;
const listeners = new Set<() => void>();

export function setActiveTable(tableId: string | null, leave: (() => void) | null): void {
  if (tableId === activeTableId && leave === leaveFn) return;
  activeTableId = tableId;
  leaveFn = tableId ? leave : null;
  listeners.forEach((fn) => fn());
}

export function getActiveTableId(): string | null {
  return activeTableId;
}

export function leaveActiveTable(): void {
  leaveFn?.();
}

export function subscribeActiveTable(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useActiveTableId(): string | null {
  return useSyncExternalStore(subscribeActiveTable, getActiveTableId, getActiveTableId);
}
