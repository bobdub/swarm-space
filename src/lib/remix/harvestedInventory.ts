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
 *   recordHarvestForResource(kind: 'wood'|'stone'|'water'|'fibre'|'food'|'animal', qty)
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

/**
 * Resource-kind → element atoms for ONE gathered unit.
 *
 * The tool menu's "Gathered" tally (`materials.ts`) folds this bag back
 * into Wood / Stone / Water / Fibre / Food by element (C→Wood, Si→Stone,
 * O→Water, H→Fibre, N→Food) and divides by atoms-per-unit (2/2/3/4/2).
 * Each recipe below is exactly one unit of its own material and nothing
 * else, so one gathered piece moves its own counter by exactly 1.
 *
 * (The old recipes were whole molecules — wood as C₆H₁₀O₅, water as H₂O —
 * which leaked across counters: chopping a tree raised Water by more than
 * filling a bucket did, and a bucket of water rounded down to zero.)
 * Keep in step with ATOMS_PER_UNIT / ELEMENT_MATERIAL in materials.ts —
 * the materials test guards it.
 */
const KIND_MAP: Record<string, { symbol: string; count: number }[]> = {
  wood:   [{ symbol: 'C', count: 2 }],
  stone:  [{ symbol: 'Si', count: 2 }],
  water:  [{ symbol: 'O', count: 3 }],
  fibre:  [{ symbol: 'H', count: 4 }],
  food:   [{ symbol: 'N', count: 2 }],
  animal: [{ symbol: 'N', count: 2 }],
};

export function recordHarvestForResource(kind: string, qty: number): void {
  const parts = KIND_MAP[kind];
  if (!parts || !Number.isFinite(qty) || qty <= 0) return;
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

// ── Project-scoped inventory (separate IDB key per projectId) ────────────
// Used by the Smelting flow: a smelted coin unseals its chemicals into the
// active project's pool rather than the user's global inventory.

const projectCounts = new Map<string, Map<string, number>>();
const projectListeners = new Map<string, Set<Listener>>();

function projectKey(projectId: string): string { return `project:${projectId}`; }

async function readProjectSnap(projectId: string): Promise<Record<string, number>> {
  const db = await openDb();
  if (!db) return {};
  const out = await new Promise<Record<string, number>>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(projectKey(projectId));
    req.onsuccess = () => resolve((req.result as Record<string, number>) ?? {});
    req.onerror = () => resolve({});
  });
  try { db.close(); } catch { /* noop */ }
  return out;
}

async function writeProjectSnap(projectId: string, snap: Record<string, number>): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(snap, projectKey(projectId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  try { db.close(); } catch { /* noop */ }
}

function notifyProject(projectId: string): void {
  const set = projectListeners.get(projectId);
  if (!set) return;
  const snap = listHarvestedForProject(projectId);
  for (const fn of set) {
    try { fn(snap); } catch { /* noop */ }
  }
}

async function ensureProjectLoaded(projectId: string): Promise<Map<string, number>> {
  let m = projectCounts.get(projectId);
  if (m) return m;
  m = new Map();
  projectCounts.set(projectId, m);
  const snap = await readProjectSnap(projectId);
  for (const [k, v] of Object.entries(snap)) {
    if (typeof v === 'number' && v > 0) m.set(k, v);
  }
  notifyProject(projectId);
  return m;
}

export async function recordHarvestForProject(
  projectId: string,
  parts: { symbol: string; count: number }[],
): Promise<void> {
  if (!projectId || !parts || parts.length === 0) return;
  const m = await ensureProjectLoaded(projectId);
  let changed = false;
  for (const { symbol, count } of parts) {
    if (!symbol || !Number.isFinite(count) || count === 0) continue;
    m.set(symbol, Math.max(0, (m.get(symbol) ?? 0) + count));
    changed = true;
  }
  if (changed) {
    const snap: Record<string, number> = {};
    for (const [k, v] of m) snap[k] = v;
    void writeProjectSnap(projectId, snap);
    notifyProject(projectId);
  }
}

export function getHarvestedForProject(projectId: string, symbol: string): number {
  return projectCounts.get(projectId)?.get(symbol) ?? 0;
}

export function listHarvestedForProject(projectId: string): { symbol: string; count: number }[] {
  const m = projectCounts.get(projectId);
  if (!m) return [];
  return [...m.entries()]
    .filter(([, v]) => v > 0)
    .map(([symbol, count]) => ({ symbol, count }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function subscribeHarvestedForProject(projectId: string, fn: Listener): () => void {
  let set = projectListeners.get(projectId);
  if (!set) { set = new Set(); projectListeners.set(projectId, set); }
  set.add(fn);
  // Lazy-load on first subscribe.
  void ensureProjectLoaded(projectId).then(() => {
    try { fn(listHarvestedForProject(projectId)); } catch { /* noop */ }
  });
  return () => { set!.delete(fn); };
}