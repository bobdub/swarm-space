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
 * Every change is also mirrored synchronously to localStorage, so a
 * refresh inside the 1.5 s window (or an unload that drops the IDB
 * write) never rolls counts back. Changes made before the stored bag has
 * loaded are kept as deltas and applied on top of it; nothing is written
 * until that load finishes, so an early write cannot wipe the inventory.
 */

const DB_NAME = 'swarm-harvested-inventory';
const STORE = 'inventory';
const DB_VERSION = 1;
const KEY = 'local';
const MIRROR_KEY = 'swarm-harvested-inventory:mirror';

type Listener = (snap: { symbol: string; count: number }[]) => void;

const counts: Map<string, number> = new Map();
const listeners = new Set<Listener>();
let hydrated = false;
let hydrating: Promise<void> | null = null;
let writeTimer: number | null = null;
/** Changes made before hydration finished, applied on top of the stored bag. */
const pendingDeltas: Map<string, number> = new Map();
let unloadHooked = false;

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

function currentSnap(): Record<string, number> {
  const snap: Record<string, number> = {};
  for (const [k, v] of counts) snap[k] = v;
  return snap;
}

function writeMirror(): void {
  if (!hydrated) return;
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify(currentSnap())); } catch {
    // A stale mirror would win over IndexedDB on the next load; drop it.
    try { localStorage.removeItem(MIRROR_KEY); } catch { /* private mode */ }
  }
}

function readMirror(): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, number> : null;
  } catch { return null; }
}

function flushNow(): void {
  if (!hydrated) return;
  if (writeTimer !== null) { clearTimeout(writeTimer); writeTimer = null; }
  writeMirror();
  void writeSnap(currentSnap());
}

function hookUnloadOnce(): void {
  if (unloadHooked || typeof window === 'undefined') return;
  unloadHooked = true;
  window.addEventListener('pagehide', flushNow);
  window.addEventListener('beforeunload', flushNow);
  window.addEventListener('visibilitychange', () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flushNow();
  });
}

function scheduleWrite(): void {
  if (!hydrated) return;
  writeMirror();
  if (writeTimer !== null) return;
  writeTimer = (typeof window !== 'undefined' ? window.setTimeout : setTimeout)(() => {
    writeTimer = null;
    void writeSnap(currentSnap());
  }, 1500) as unknown as number;
}

/** Apply a change; before hydration it is also remembered as a delta. */
function bump(symbol: string, count: number): void {
  counts.set(symbol, Math.max(0, (counts.get(symbol) ?? 0) + count));
  if (!hydrated) {
    pendingDeltas.set(symbol, (pendingDeltas.get(symbol) ?? 0) + count);
    // Load the stored bag now rather than waiting on the boot chain, so
    // this change gets persisted. (No IndexedDB → unit tests; skip.)
    if (typeof indexedDB !== 'undefined') void hydrateHarvestedInventory();
  }
}

function notify(): void {
  const snap = listHarvested();
  for (const fn of listeners) {
    try { fn(snap); } catch { /* noop */ }
  }
}

export function recordHarvest(symbol: string, count: number): void {
  if (!symbol || !Number.isFinite(count) || count === 0) return;
  bump(symbol, count);
  scheduleWrite();
  notify();
}

export function recordHarvestMany(parts: { symbol: string; count: number }[]): void {
  if (!parts || parts.length === 0) return;
  let changed = false;
  for (const { symbol, count } of parts) {
    if (!symbol || !Number.isFinite(count) || count === 0) continue;
    bump(symbol, count);
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
  // Trading goods that are not elements: kept in the same bag under a
  // `good:` key, one per unit, and left out of the element lists below.
  honey:  [{ symbol: 'good:honey', count: 1 }],
  gem:    [{ symbol: 'good:gem', count: 1 }],
  egg:    [{ symbol: 'good:egg', count: 1 }],
  fish:   [{ symbol: 'good:fish', count: 1 }],
  shark:  [{ symbol: 'good:shark', count: 1 }],
  chicken: [{ symbol: 'good:chicken', count: 1 }],
};

/** Bag keys for goods that are not elements (honey, gems). */
export const GOOD_KEY_PREFIX = 'good:';

export function recordHarvestForResource(kind: string, qty: number): void {
  const parts = KIND_MAP[kind];
  if (!parts || !Number.isFinite(qty) || qty <= 0) return;
  recordHarvestMany(parts.map((p) => ({ symbol: p.symbol, count: p.count * qty })));
}

export function getHarvested(symbol: string): number {
  return counts.get(symbol) ?? 0;
}

/** Held elements. Non-element goods (`good:` keys) are read with getHarvested. */
export function listHarvested(): { symbol: string; count: number }[] {
  return [...counts.entries()]
    .filter(([k, v]) => v > 0 && !k.startsWith(GOOD_KEY_PREFIX))
    .map(([symbol, count]) => ({ symbol, count }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function subscribeHarvested(fn: Listener): () => void {
  listeners.add(fn);
  try { fn(listHarvested()); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}

export function hydrateHarvestedInventory(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;
  hookUnloadOnce();
  hydrating = (async () => {
    // The mirror is written synchronously on every change, so when it is
    // present it is at least as fresh as the throttled IndexedDB copy.
    const stored = readMirror() ?? await readSnap();
    counts.clear();
    for (const [k, v] of Object.entries(stored)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) counts.set(k, v);
    }
    const isFirstRun = counts.size === 0 && Object.keys(stored).length === 0;
    for (const [k, d] of pendingDeltas) counts.set(k, Math.max(0, (counts.get(k) ?? 0) + d));
    const hadPending = pendingDeltas.size > 0;
    pendingDeltas.clear();
    // Seed starter atoms so the user has something to draw with on first
    // run — small enough to motivate harvesting but enough to demo H₂O.
    if (isFirstRun) {
      for (const [k, v] of [['H', 24], ['O', 12], ['C', 12], ['N', 4]] as const) {
        counts.set(k, (counts.get(k) ?? 0) + v);
      }
    }
    hydrated = true;
    if (isFirstRun || hadPending) scheduleWrite();
    notify();
  })();
  return hydrating;
}

/** Best-effort spend — returns false if not enough is held. */
export function spendHarvested(parts: { symbol: string; count: number }[]): boolean {
  for (const { symbol, count } of parts) {
    if ((counts.get(symbol) ?? 0) < count) return false;
  }
  for (const { symbol, count } of parts) bump(symbol, -count);
  scheduleWrite();
  notify();
  return true;
}

export function _resetHarvestedForTest(): void {
  counts.clear();
  listeners.clear();
  pendingDeltas.clear();
  hydrated = false;
  hydrating = null;
  if (writeTimer !== null) { clearTimeout(writeTimer); writeTimer = null; }
}

/** Test seam — write the mirror and IndexedDB copy now, as an unload would. */
export function _flushHarvestedForTest(): void {
  flushNow();
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