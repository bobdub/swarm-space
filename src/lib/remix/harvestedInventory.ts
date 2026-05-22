/**
 * harvestedInventory — tracks the local user's in-world harvested chemical
 * inventory (element symbol → atom count). Persisted to IndexedDB so it
 * survives reload. Local-only; no P2P gossip (the user's inventory is not
 * something peers need to mirror).
 *
 * Public API:
 *   recordHarvest(symbol, count)
 *   recordHarvestMany(parts: { symbol; count }[])
 *   getHarvested(symbol): number
 *   listHarvested(): { symbol; count }[]
 *   subscribeHarvested(fn): unsub
 *   hydrateHarvestedInventory()
 *
 * Mapping helper:
 *   recordHarvestForResource(kind: 'water'|'wood'|'food'|'animal', qty)
 *
 * Throttled IDB writes (1.5s) per project core rule on browser perf.
 */

const DB_NAME = 'swarm-harvested-inventory';
const STORE = 'inventory';
const DB_VERSION = 1;
const KEY = 'local';

type Listener = (snap: { symbol: string; count: number }[]) => void;

const counts: Map<string, number> = new Map();
const listeners = new Set<Listener>();
let hydrated = false;
let writeTimer: number | null = null;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { try { db.close(); } catch { /* noop */ } };
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function readSnap(): Promise<Record<string, number>> {
  const db = await openDb();
  if (!db) return {};
  const out = await new Promise<Record<string, number>>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as Record<string, number>) ?? {});
    req.onerror = () => resolve({});
  });
  try { db.close(); } catch { /* noop */ }
  return out;
}

async function writeSnap(snap: Record<string, number>): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(snap, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  try { db.close(); } catch { /* noop */ }
}

function scheduleWrite(): void {
  if (writeTimer !== null) return;
  writeTimer = (typeof window !== 'undefined' ? window.setTimeout : setTimeout)(() => {
    writeTimer = null;
    const snap: Record<string, number> = {};
    for (const [k, v] of counts) snap[k] = v;
    void writeSnap(snap);
  }, 1500) as unknown as number;
}

function notify(): void {
  const snap = listHarvested();
  for (const fn of listeners) {
    try { fn(snap); } catch { /* noop */ }
  }
}

export function recordHarvest(symbol: string, count: number): void {
  if (!symbol || !Number.isFinite(count) || count === 0) return;
  const cur = counts.get(symbol) ?? 0;
  const next = Math.max(0, cur + count);
  counts.set(symbol, next);
  scheduleWrite();
  notify();
}

export function recordHarvestMany(parts: { symbol: string; count: number }[]): void {
  if (!parts || parts.length === 0) return;
  let changed = false;
  for (const { symbol, count } of parts) {
    if (!symbol || !Number.isFinite(count) || count === 0) continue;
    const cur = counts.get(symbol) ?? 0;
    counts.set(symbol, Math.max(0, cur + count));
    changed = true;
  }
  if (changed) { scheduleWrite(); notify(); }
}

/** Resource-kind → element atoms shorthand for in-world harvest events. */
const KIND_MAP: Record<string, { symbol: string; count: number }[]> = {
  water:  [{ symbol: 'H', count: 2 }, { symbol: 'O', count: 1 }],
  wood:   [{ symbol: 'C', count: 6 }, { symbol: 'H', count: 10 }, { symbol: 'O', count: 5 }],
  food:   [{ symbol: 'C', count: 5 }, { symbol: 'H', count: 10 }, { symbol: 'O', count: 2 }, { symbol: 'N', count: 2 }],
  animal: [{ symbol: 'C', count: 5 }, { symbol: 'H', count: 10 }, { symbol: 'O', count: 2 }, { symbol: 'N', count: 2 }],
};

export function recordHarvestForResource(kind: string, qty: number): void {
  const parts = KIND_MAP[kind];
  if (!parts || qty <= 0) return;
  recordHarvestMany(parts.map((p) => ({ symbol: p.symbol, count: p.count * qty })));
}

export function getHarvested(symbol: string): number {
  return counts.get(symbol) ?? 0;
}

export function listHarvested(): { symbol: string; count: number }[] {
  return [...counts.entries()]
    .filter(([, v]) => v > 0)
    .map(([symbol, count]) => ({ symbol, count }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function subscribeHarvested(fn: Listener): () => void {
  listeners.add(fn);
  try { fn(listHarvested()); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}

export async function hydrateHarvestedInventory(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const snap = await readSnap();
  for (const [k, v] of Object.entries(snap)) {
    if (typeof v === 'number' && v > 0) counts.set(k, v);
  }
  // Seed starter atoms so the user has something to draw with on first
  // run — small enough to motivate harvesting but enough to demo H₂O.
  if (counts.size === 0) {
    counts.set('H', 24);
    counts.set('O', 12);
    counts.set('C', 12);
    counts.set('N', 4);
    scheduleWrite();
  }
  notify();
}

/** Best-effort spend — returns false if not enough is held. */
export function spendHarvested(parts: { symbol: string; count: number }[]): boolean {
  for (const { symbol, count } of parts) {
    if ((counts.get(symbol) ?? 0) < count) return false;
  }
  for (const { symbol, count } of parts) {
    counts.set(symbol, (counts.get(symbol) ?? 0) - count);
  }
  scheduleWrite();
  notify();
  return true;
}

export function _resetHarvestedForTest(): void {
  counts.clear();
  listeners.clear();
  hydrated = false;
}