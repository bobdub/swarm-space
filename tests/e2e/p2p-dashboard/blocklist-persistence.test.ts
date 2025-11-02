import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { installMemoryStorage } from './testUtils';
import type { BlocklistEntry } from '@/lib/p2p/blocklistStore';

const STORAGE_KEY = 'p2p:blocklist:v1';

describe('blocklist persistence indicator', () => {
  let cleanup: (() => void) | null = null;
  let blockPersistence: typeof import('@/lib/p2p/blockPersistence');

  beforeEach(async () => {
    cleanup = installMemoryStorage();
    window.localStorage.clear();
    blockPersistence = await import('@/lib/p2p/blockPersistence');
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('hydrates entries from storage and reflects save progress states', async () => {
    const entry: BlocklistEntry = {
      peerId: 'peer-alpha',
      direction: 'all',
      reason: 'initial block',
      addedAt: Date.now() - 1_000,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([entry]));

    await blockPersistence.loadPersistentBlocklist();
    const hydrated = blockPersistence.getBlockPersistenceSnapshot();

    expect(hydrated.entries).toHaveLength(1);
    expect(hydrated.entries[0]?.peerId).toBe('peer-alpha');
    expect(hydrated.status).toBe('idle');
    expect(hydrated.lastSyncedAt).not.toBeNull();

    const phases: Array<typeof hydrated.status> = [];
    const unsubscribe = blockPersistence.subscribeToBlockPersistence((next) => {
      phases.push(next.status);
    });

    const updatedEntry: BlocklistEntry = {
      peerId: 'peer-alpha',
      direction: 'all',
      reason: 'updated reason',
      addedAt: Date.now(),
    };

    await blockPersistence.persistBlocklistEntries([updatedEntry]);
    unsubscribe();

    const snapshot = blockPersistence.getBlockPersistenceSnapshot();
    expect(snapshot.entries[0]?.reason).toBe('updated reason');
    expect(phases).toContain('saving');
    expect(phases.at(-1)).toBe('idle');

    const stored = window.localStorage.getItem(STORAGE_KEY);
    expect(stored).toBeTruthy();
    expect(stored).toContain('updated reason');
  });
});
