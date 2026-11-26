/**
 * Public Cells — a discovery directory of user cells their owners opened up.
 *
 * Owners announce each public cell into its own slot on the Global Cell Gun
 * registry (`public-cells` channel). Peers keep the fresh, non-withdrawn
 * listings so Explore can show them with a 1-click join.
 *
 * Payloads travel as JSON strings: Gun stores nested objects as links, and a
 * string round-trips intact through every relay.
 */

export const PUBLIC_CELLS_CHANNEL = 'public-cells';
/** Owners re-announce on this cadence while online. */
export const PUBLIC_CELL_REANNOUNCE_MS = 60_000;
/** Listings not refreshed within this window are treated as offline. */
export const PUBLIC_CELL_STALE_MS = 5 * 60_000;

export interface PublicCellListing {
  cellId: string;
  name: string;
  ownerUsername: string;
  ownerUserId: string;
  /** Owner's cell (Builder) engine peerId — a cache, refreshed at dial-time. */
  ownerPeerId: string;
  /** Owner's main-mesh peerId, used for `/connect?cell=…#peer-…` invite links. */
  ownerMeshPeerId: string;
  /** Owner plus currently connected cell peers, as last announced. */
  members: number;
  announcedAt: number;
  withdrawn?: boolean;
}

type Listener = (cells: PublicCellListing[]) => void;

const listings = new Map<string, PublicCellListing>();
const listeners = new Set<Listener>();
let listening = false;
let pruneTimer: ReturnType<typeof setInterval> | null = null;

/** One registry slot per cell, so a cell's listing never overwrites presence. */
export function publicCellSlot(cellId: string): string {
  return `public-cell~${cellId.replace(/[^a-zA-Z0-9_-]/g, '~')}`;
}

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

/** Validate a registry payload (pure — exported for tests). */
export function parsePublicCellListing(raw: unknown, nowTs = Date.now()): PublicCellListing | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { return null; }
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const cellId = str(d.cellId, 120);
  if (!/^u\/[^/\s]+\/[^/\s]+$/.test(cellId)) return null;
  const announcedAt = typeof d.announcedAt === 'number' ? d.announcedAt : NaN;
  if (!Number.isFinite(announcedAt)) return null;
  // Reject replays of old listings and clocks far in the future.
  if (nowTs - announcedAt > PUBLIC_CELL_STALE_MS || announcedAt - nowTs > PUBLIC_CELL_STALE_MS) return null;
  const ownerUsername = str(d.ownerUsername, 64) || cellId.split('/')[1];
  const ownerMeshPeerId = str(d.ownerMeshPeerId, 128);
  return {
    cellId,
    name: str(d.name, 48) || `Cell ${ownerUsername}`,
    ownerUsername,
    ownerUserId: str(d.ownerUserId, 128),
    ownerPeerId: str(d.ownerPeerId, 128),
    ownerMeshPeerId: /^peer-[a-zA-Z0-9_-]{1,120}$/.test(ownerMeshPeerId) ? ownerMeshPeerId : '',
    members: typeof d.members === 'number' && d.members > 0 ? Math.min(Math.floor(d.members), 10_000) : 1,
    announcedAt,
    ...(d.withdrawn === true ? { withdrawn: true } : {}),
  };
}

/** Keep the newest listing per cell (pure — exported for tests). */
export function mergePublicCellListing(
  store: Map<string, PublicCellListing>,
  next: PublicCellListing,
): boolean {
  const prev = store.get(next.cellId);
  if (prev && prev.announcedAt >= next.announcedAt) return false;
  store.set(next.cellId, next);
  return true;
}

/** Fresh, open listings, busiest first (pure — exported for tests). */
export function freshPublicCells(
  store: Map<string, PublicCellListing>,
  nowTs = Date.now(),
): PublicCellListing[] {
  return [...store.values()]
    .filter(l => !l.withdrawn && nowTs - l.announcedAt <= PUBLIC_CELL_STALE_MS)
    .sort((a, b) => b.members - a.members || b.announcedAt - a.announcedAt);
}

function emit(): void {
  const list = freshPublicCells(listings);
  listeners.forEach(fn => { try { fn(list); } catch { /* ignore */ } });
}

/** Record a listing seen locally (our own announcements never echo back from Gun). */
export function recordPublicCellListing(listing: PublicCellListing): void {
  if (mergePublicCellListing(listings, listing)) emit();
}

async function startListening(): Promise<void> {
  if (listening) return;
  listening = true;
  try {
    const { getGlobalCell } = await import('./globalCell');
    getGlobalCell().onRegistry(PUBLIC_CELLS_CHANNEL, (_from, payload) => {
      const listing = parsePublicCellListing(payload);
      if (listing) recordPublicCellListing(listing);
    });
  } catch (err) {
    listening = false;
    console.warn('[publicCells] registry unavailable', err);
  }
  if (!pruneTimer) pruneTimer = setInterval(emit, 30_000);
}

export function getPublicCells(): PublicCellListing[] {
  return freshPublicCells(listings);
}

export function subscribePublicCells(fn: Listener): () => void {
  listeners.add(fn);
  void startListening();
  try { fn(getPublicCells()); } catch { /* ignore */ }
  return () => { listeners.delete(fn); };
}

/** Announce (or withdraw) one listing on the global registry. */
export async function publishPublicCellListing(listing: PublicCellListing): Promise<boolean> {
  recordPublicCellListing(listing);
  try {
    const { getGlobalCell } = await import('./globalCell');
    return getGlobalCell().publishRegistry(PUBLIC_CELLS_CHANNEL, publicCellSlot(listing.cellId), JSON.stringify(listing));
  } catch (err) {
    console.warn('[publicCells] announce failed', err);
    return false;
  }
}
