export type BlocklistDirection = 'inbound' | 'outbound' | 'all';

export interface BlocklistEntry {
  peerId: string;
  direction: BlocklistDirection;
  reason?: string | null;
  addedAt: number;
}

const STORAGE_KEY = 'p2p:blocklist:v1';

const isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export function normalizeBlocklist(entries: BlocklistEntry[]): BlocklistEntry[] {
  const seen = new Map<string, BlocklistEntry>();

  for (const entry of entries) {
    const peerId = entry.peerId.trim();
    if (!peerId) {
      continue;
    }
    const direction = entry.direction ?? 'all';
    const key = `${peerId}:${direction}`;
    const existing = seen.get(key);
    if (!existing || (entry.addedAt ?? 0) > (existing.addedAt ?? 0)) {
      seen.set(key, {
        peerId,
        direction,
        reason: entry.reason ?? null,
        addedAt: entry.addedAt ?? Date.now(),
      });
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.addedAt - a.addedAt);
}

export function loadBlocklistFromStorage(): BlocklistEntry[] {
  if (!isBrowser) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeBlocklist(
      parsed
        .filter((value): value is Partial<BlocklistEntry> => value && typeof value === 'object')
        .map((value) => ({
          peerId: typeof value.peerId === 'string' ? value.peerId : '',
          direction: value.direction === 'inbound' || value.direction === 'outbound' ? value.direction : 'all',
          reason: typeof value.reason === 'string' && value.reason.length > 0 ? value.reason : null,
          addedAt: typeof value.addedAt === 'number' ? value.addedAt : Date.now(),
        })),
    );
  } catch (error) {
    console.warn('[blocklistStore] Failed to load blocklist from storage', error);
    return [];
  }
}

export function persistBlocklist(entries: BlocklistEntry[]): void {
  if (!isBrowser) {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeBlocklist(entries)));
  } catch (error) {
    console.warn('[blocklistStore] Failed to persist blocklist', error);
  }
}

export function deriveBlockedPeerIds(entries: BlocklistEntry[]): string[] {
  return Array.from(
    new Set(
      entries
        .filter((entry) => entry.direction === 'all' || entry.direction === 'inbound')
        .map((entry) => entry.peerId.trim())
        .filter((peerId) => peerId.length > 0),
    ),
  );
}

export function deriveOutboundBlockedPeerIds(entries: BlocklistEntry[]): string[] {
  return Array.from(
    new Set(
      entries
        .filter((entry) => entry.direction === 'all' || entry.direction === 'outbound')
        .map((entry) => entry.peerId.trim())
        .filter((peerId) => peerId.length > 0),
    ),
  );
}

export function upsertBlocklistEntry(
  entries: BlocklistEntry[],
  peerId: string,
  direction: BlocklistDirection,
  reason?: string | null,
): BlocklistEntry[] {
  const normalizedPeerId = peerId.trim();
  if (!normalizedPeerId) {
    return entries;
  }
  const next: BlocklistEntry[] = entries.filter((entry) => !(entry.peerId === normalizedPeerId && entry.direction === direction));
  next.push({
    peerId: normalizedPeerId,
    direction,
    reason: reason?.trim() ? reason.trim() : null,
    addedAt: Date.now(),
  });
  return normalizeBlocklist(next);
}

export function removeBlocklistEntry(
  entries: BlocklistEntry[],
  peerId: string,
  direction?: BlocklistDirection,
): BlocklistEntry[] {
  const normalizedPeerId = peerId.trim();
  if (!normalizedPeerId) {
    return entries;
  }
  return entries.filter((entry) => {
    if (entry.peerId !== normalizedPeerId) {
      return true;
    }
    if (!direction) {
      return false;
    }
    return entry.direction !== direction;
  });
}
