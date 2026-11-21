/**
 * harvestJournal — the player's running harvest tally, kept so harvested
 * goods can be engraved onto their open coin.
 *
 * Two records per user live in the shared `meta` store:
 *   • `harvest-tally:<userId>`    lifetime totals per resource kind,
 *                                 written only by `journalHarvest`.
 *   • `harvest-engraved:<userId>` the part of those totals already
 *                                 engraved, written only by the coin
 *                                 engraving writer (contentPayload.pack).
 * "Waiting to be engraved" is tally − engraved, so the game writing a new
 * harvest can never race the engraver clearing a batch.
 *
 * The tally is mirrored synchronously to localStorage on every harvest,
 * so a refresh right after collecting something never loses it.
 */
import { get, put } from '@/lib/store';

export interface HarvestTally {
  k: string;
  userId: string;
  /** Lifetime units harvested, by resource kind (wood, stone, water, fibre, food). */
  totals: Record<string, number>;
  /** Number of harvest actions recorded; only ever grows. */
  events: number;
  firstAt?: string;
  lastAt?: string;
}

export interface EngravedHarvest {
  k: string;
  userId: string;
  totals: Record<string, number>;
  /** `events` of the tally at the last engraving. */
  events: number;
}

export const tallyKey = (userId: string): string => `harvest-tally:${userId}`;
export const engravedKey = (userId: string): string => `harvest-engraved:${userId}`;
const mirrorKey = (userId: string): string => `swarm-harvest-tally:${userId}`;

const tallies = new Map<string, HarvestTally>();
const loading = new Map<string, Promise<HarvestTally>>();
const writes = new Map<string, Promise<void>>();

function emptyTally(userId: string): HarvestTally {
  return { k: tallyKey(userId), userId, totals: {}, events: 0 };
}

function isTally(v: unknown): v is HarvestTally {
  const t = v as HarvestTally | null;
  return !!t && typeof t === 'object' && !!t.totals && typeof t.totals === 'object' && typeof t.events === 'number';
}

function readMirror(userId: string): HarvestTally | null {
  try {
    const raw = localStorage.getItem(mirrorKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isTally(parsed) ? parsed : null;
  } catch { return null; }
}

function writeMirror(tally: HarvestTally): void {
  try { localStorage.setItem(mirrorKey(tally.userId), JSON.stringify(tally)); } catch {
    try { localStorage.removeItem(mirrorKey(tally.userId)); } catch { /* private mode */ }
  }
}

async function load(userId: string): Promise<HarvestTally> {
  const cached = tallies.get(userId);
  if (cached) return cached;
  let pending = loading.get(userId);
  if (!pending) {
    pending = (async () => {
      let stored: HarvestTally | null = null;
      try {
        const v = await get<HarvestTally>('meta', tallyKey(userId));
        stored = isTally(v) ? v : null;
      } catch { stored = null; }
      const mirror = readMirror(userId);
      // Whichever copy has seen more harvests is the fresher one.
      const best = [stored, mirror].filter(isTally).sort((a, b) => b.events - a.events)[0];
      const tally = best ? { ...best, k: tallyKey(userId), userId, totals: { ...best.totals } } : emptyTally(userId);
      // A harvest recorded while we were loading already sits in memory.
      return tallies.get(userId) ?? tally;
    })();
    loading.set(userId, pending);
  }
  const tally = await pending;
  loading.delete(userId);
  if (!tallies.has(userId)) tallies.set(userId, tally);
  return tallies.get(userId)!;
}

function persist(tally: HarvestTally): void {
  writeMirror(tally);
  const snapshot: HarvestTally = { ...tally, totals: { ...tally.totals } };
  const prev = writes.get(tally.userId) ?? Promise.resolve();
  const next = prev.catch(() => undefined)
    .then(() => put('meta', snapshot))
    .catch((err) => { console.warn('[harvestJournal] save failed', err); });
  writes.set(tally.userId, next);
}

/** Record one harvest action by `userId`: `qty` units of resource `kind`. */
export async function journalHarvest(userId: string, kind: string, qty: number, at = new Date()): Promise<void> {
  if (!userId || !kind || !Number.isFinite(qty) || qty <= 0) return;
  const tally = await load(userId);
  tally.totals[kind] = (tally.totals[kind] ?? 0) + qty;
  tally.events += 1;
  const iso = at.toISOString();
  tally.firstAt ??= iso;
  tally.lastAt = iso;
  persist(tally);
}

/** Current lifetime tally for `userId` (fresh copy). */
export async function readHarvestTally(userId: string): Promise<HarvestTally> {
  const t = await load(userId);
  return { ...t, totals: { ...t.totals } };
}

export async function readEngravedHarvest(userId: string): Promise<EngravedHarvest> {
  try {
    const v = await get<EngravedHarvest>('meta', engravedKey(userId));
    if (v && v.totals && typeof v.totals === 'object') return { ...v, totals: { ...v.totals } };
  } catch { /* fall through */ }
  return { k: engravedKey(userId), userId, totals: {}, events: 0 };
}

export async function writeEngravedHarvest(userId: string, totals: Record<string, number>, events: number): Promise<void> {
  await put('meta', { k: engravedKey(userId), userId, totals: { ...totals }, events });
}

/** Units harvested but not yet engraved, by kind (only positive amounts). */
export function unengraved(tally: HarvestTally, engraved: EngravedHarvest): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [kind, total] of Object.entries(tally.totals)) {
    const left = total - (engraved.totals[kind] ?? 0);
    if (Number.isFinite(left) && left > 0) out[kind] = left;
  }
  return out;
}

/** Wait for queued tally writes (tests and unload paths). */
export async function flushHarvestJournal(): Promise<void> {
  await Promise.all([...writes.values()]);
}

export function _resetHarvestJournalForTest(): void {
  tallies.clear();
  loading.clear();
  writes.clear();
}
