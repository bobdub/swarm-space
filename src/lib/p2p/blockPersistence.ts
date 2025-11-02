import type { BlocklistEntry } from './blocklistStore';
import {
  loadBlocklistFromStorage,
  persistBlocklist,
  normalizeBlocklist,
} from './blocklistStore';

export type BlockPersistencePhase = 'idle' | 'loading' | 'saving' | 'error';

export interface BlockPersistenceSnapshot {
  status: BlockPersistencePhase;
  lastSyncedAt: number | null;
  pendingWrites: number;
  error: string | null;
  entries: BlocklistEntry[];
}

type BlockPersistenceListener = (snapshot: BlockPersistenceSnapshot) => void;

const listeners = new Set<BlockPersistenceListener>();

let snapshot: BlockPersistenceSnapshot = {
  status: 'idle',
  lastSyncedAt: null,
  pendingWrites: 0,
  error: null,
  entries: [],
};

function emit(next: Partial<BlockPersistenceSnapshot>): void {
  snapshot = {
    ...snapshot,
    ...next,
  };
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[blockPersistence] listener threw', error);
    }
  }
}

export function getBlockPersistenceSnapshot(): BlockPersistenceSnapshot {
  return snapshot;
}

export function subscribeToBlockPersistence(
  listener: BlockPersistenceListener,
): () => void {
  listeners.add(listener);
  try {
    listener(snapshot);
  } catch (error) {
    console.warn('[blockPersistence] listener threw during subscribe', error);
  }
  return () => {
    listeners.delete(listener);
  };
}

export async function loadPersistentBlocklist(): Promise<BlocklistEntry[]> {
  emit({ status: 'loading', error: null });
  try {
    const entries = loadBlocklistFromStorage();
    const normalized = normalizeBlocklist(entries);
    emit({
      status: 'idle',
      entries: normalized,
      lastSyncedAt: Date.now(),
      error: null,
    });
    return normalized;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    emit({ status: 'error', error: message });
    return [];
  }
}

export async function persistBlocklistEntries(
  entries: BlocklistEntry[],
): Promise<void> {
  const normalized = normalizeBlocklist(entries);
  emit({ status: 'saving', pendingWrites: snapshot.pendingWrites + 1, error: null, entries: normalized });
  try {
    persistBlocklist(normalized);
    emit({
      status: 'idle',
      lastSyncedAt: Date.now(),
      pendingWrites: Math.max(0, snapshot.pendingWrites - 1),
      entries: normalized,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    emit({
      status: 'error',
      error: message,
      pendingWrites: Math.max(0, snapshot.pendingWrites - 1),
    });
  }
}

export function markBlockPersistenceError(message: string): void {
  emit({ status: 'error', error: message });
}

export function resetBlockPersistenceError(): void {
  if (snapshot.status === 'error') {
    emit({ status: 'idle', error: null });
  }
}
