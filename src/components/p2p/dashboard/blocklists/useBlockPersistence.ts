import { useEffect, useMemo, useState } from 'react';
import {
  getBlockPersistenceSnapshot,
  subscribeToBlockPersistence,
  type BlockPersistenceSnapshot,
} from '@/lib/p2p/blockPersistence';

function formatRelativeTime(timestamp: number | null): string | null {
  if (!timestamp) {
    return null;
  }
  const delta = Date.now() - timestamp;
  if (delta < 1000) {
    return 'just now';
  }
  if (delta < 60_000) {
    return `${Math.floor(delta / 1000)}s ago`;
  }
  if (delta < 3_600_000) {
    return `${Math.floor(delta / 60_000)}m ago`;
  }
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

export interface BlockPersistenceView extends BlockPersistenceSnapshot {
  lastSyncedLabel: string | null;
}

export function useBlockPersistence(): BlockPersistenceView {
  const [snapshot, setSnapshot] = useState<BlockPersistenceSnapshot>(() => getBlockPersistenceSnapshot());

  useEffect(() => {
    return subscribeToBlockPersistence(setSnapshot);
  }, []);

  return useMemo<BlockPersistenceView>(() => ({
    ...snapshot,
    lastSyncedLabel: formatRelativeTime(snapshot.lastSyncedAt),
  }), [snapshot]);
}
