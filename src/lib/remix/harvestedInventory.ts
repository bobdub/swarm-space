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
 * Online and offline gathers are kept apart (see `playMode.ts`). Gathered
 * goods are tradable, so a gather made in offline play lands in the offline
 * bag (`offline:<symbol>` keys): it is usable in local play while offline,
 * locked away while online, and never drawn by a ledger, coin or stand path
 * (`{ onlineOnly: true }`). A project's creator can move the offline bag
 * into that project's seed pool (`seed:<projectId>|<symbol>` keys, see
 * `offlineProjectSeed.ts`), which only that project's Brain can build with.
 * Plain keys are the online bag; bags stored before the split read as
 * online, since nothing then recorded where a gather happened.
 *
 * Throttled IDB writes (1.5s) per project core rule on browser perf.
 * Every change is also mirrored synchronously to localStorage, so a
 * refresh inside the 1.5 s window (or an unload that drops the IDB
 * write) never rolls counts back. Changes made before the stored bag has
 * loaded are kept as deltas and applied on top of it; nothing is written
 * until that load finishes, so an early write cannot wipe the inventory.
 */

import {
  activeBrainProject,
  currentHarvestOrigin,
  isOnlinePlay,
  subscribePlayMode,
  type HarvestOrigin,
} from '@/lib/world/playMode';

export type { HarvestOrigin } from '@/lib/world/playMode';

/** Which bags a read or spend may use. */
export interface BagScope {
  /**
   * Only the online bag: for anything that leaves the device or reaches the
   * ledger (Trading Stand trades and stock, coin crafting).
   */
  onlineOnly?: boolean;
  /**
   * Only the offline bag: a read lens, so panels can mark how much of what
   * the player holds in offline play was gathered offline.
   */
  offlineOnly?: boolean;
}

const OFFLINE_PREFIX = 'offline:';
const SEED_PREFIX = 'seed:';
const offlineKey = (symbol: string) => `${OFFLINE_PREFIX}${symbol}`;
const seedKey = (projectId: string, symbol: string) => `${SEED_PREFIX}${projectId}|${symbol}`;

/** The bag a raw key belongs to, and its symbol. */
function parseKey(key: string): { bag: 'online' | 'offline' | 'seed'; symbol: string; projectId?: string } {
  if (key.startsWith(OFFLINE_PREFIX)) return { bag: 'offline', symbol: key.slice(OFFLINE_PREFIX.length) };
  if (key.startsWith(SEED_PREFIX)) {
    const rest = key.slice(SEED_PREFIX.length);
    const bar = rest.indexOf('|');
    if (bar > 0) return { bag: 'seed', projectId: rest.slice(0, bar), symbol: rest.slice(bar + 1) };
  }
  return { bag: 'online', symbol: key };
}

/** Raw keys a scope may draw `symbol` from, in spend order. */
function visibleKeys(symbol: string, scope?: BagScope): string[] {
  if (scope?.onlineOnly) return [symbol];
  if (scope?.offlineOnly) return [offlineKey(symbol)];
  const keys: string[] = [];
  const project = activeBrainProject();
  if (project) keys.push(seedKey(project, symbol));
  if (!isOnlinePlay()) keys.push(offlineKey(symbol));
  keys.push(symbol);
  return keys;
}

function rawKeyFor(symbol: string, origin: HarvestOrigin): string {
  return origin === 'offline' ? offlineKey(symbol) : symbol;
}

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

/**
 * Add `count` of `symbol` to the bag `origin` names: by default where the
 * player is right now (offline play → the offline bag). Ledger-backed
 * receipts (a Trading Stand buy, a refund of an online-only spend) pass
 * 'online'.
 */
export function recordHarvest(symbol: string, count: number, origin: HarvestOrigin = currentHarvestOrigin()): void {
  if (!symbol || !Number.isFinite(count) || count === 0) return;
  bump(rawKeyFor(symbol, origin), count);
  scheduleWrite();
  notify();
}

export function recordHarvestMany(
  parts: { symbol: string; count: number }[],
  origin: HarvestOrigin = currentHarvestOrigin(),
): void {
  if (!parts || parts.length === 0) return;
  let changed = false;
  for (const { symbol, count } of parts) {
    if (!symbol || !Number.isFinite(count) || count === 0) continue;
    bump(rawKeyFor(symbol, origin), count);
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
  dirt:   [{ symbol: 'good:dirt', count: 1 }],
  clay:   [{ symbol: 'good:clay', count: 1 }],
  gold:   [{ symbol: 'good:gold', count: 1 }],
  salt:   [{ symbol: 'good:salt', count: 1 }],
};

/** Bag keys for goods that are not elements (honey, gems). */
export const GOOD_KEY_PREFIX = 'good:';

export function recordHarvestForResource(
  kind: string,
  qty: number,
  origin: HarvestOrigin = currentHarvestOrigin(),
): void {
  const parts = KIND_MAP[kind];
  if (!parts || !Number.isFinite(qty) || qty <= 0) return;
  recordHarvestMany(parts.map((p) => ({ symbol: p.symbol, count: p.count * qty })), origin);
}

/**
 * How much of `symbol` the player can use right now: the online bag, plus
 * the offline bag in offline play, plus the active project's seed pool.
 * `{ onlineOnly: true }` reads the online bag alone.
 */
export function getHarvested(symbol: string, scope?: BagScope): number {
  let total = 0;
  for (const key of visibleKeys(symbol, scope)) total += counts.get(key) ?? 0;
  return total;
}

/** Held elements. Non-element goods (`good:` keys) are read with getHarvested. */
export function listHarvested(scope?: BagScope): { symbol: string; count: number }[] {
  const symbols = new Set<string>();
  for (const [k, v] of counts) {
    if (v <= 0) continue;
    const { symbol } = parseKey(k);
    if (!symbol.startsWith(GOOD_KEY_PREFIX)) symbols.add(symbol);
  }
  const out: { symbol: string; count: number }[] = [];
  for (const symbol of symbols) {
    const count = getHarvested(symbol, scope);
    if (count > 0) out.push({ symbol, count });
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Everything gathered in offline play (elements and goods), still held. */
export function listOfflineHarvested(): { symbol: string; count: number }[] {
  const out: { symbol: string; count: number }[] = [];
  for (const [k, v] of counts) {
    if (v <= 0) continue;
    const parsed = parseKey(k);
    if (parsed.bag === 'offline') out.push({ symbol: parsed.symbol, count: v });
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** A project's seed pool (offline gathers its creator brought in). */
export function listSeededHarvested(projectId: string): { symbol: string; count: number }[] {
  const out: { symbol: string; count: number }[] = [];
  if (!projectId) return out;
  for (const [k, v] of counts) {
    if (v <= 0) continue;
    const parsed = parseKey(k);
    if (parsed.bag === 'seed' && parsed.projectId === projectId) out.push({ symbol: parsed.symbol, count: v });
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Move the whole offline bag into `projectId`'s seed pool and return what
 * moved. The caller (`seedProjectWithOfflineGathers`) checks the project
 * and takes the fee first.
 */
export function moveOfflineToProjectSeed(projectId: string): { symbol: string; count: number }[] {
  if (!projectId) return [];
  const moved = listOfflineHarvested();
  if (moved.length === 0) return moved;
  for (const { symbol, count } of moved) {
    bump(offlineKey(symbol), -count);
    bump(seedKey(projectId, symbol), count);
  }
  scheduleWrite();
  notify();
  return moved;
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

/** One draw from one bag: the raw bag key and how much was taken from it. */
export interface BagDraw { key: string; count: number }

/**
 * Spend, and say which bags it drew from (null, nothing spent, when not
 * enough is held in the bags `scope` may use). Draws the project seed pool
 * first, then the offline bag, then the online bag, so local play uses up
 * local goods before tradable ones. A later refund passes the draws to
 * `restoreDraws` so goods go back to the bag they came from.
 */
export function spendHarvestedDraws(parts: { symbol: string; count: number }[], scope?: BagScope): BagDraw[] | null {
  const need = new Map<string, number>();
  for (const { symbol, count } of parts) {
    if (!symbol || !Number.isFinite(count) || count <= 0) continue;
    need.set(symbol, (need.get(symbol) ?? 0) + count);
  }
  for (const [symbol, count] of need) {
    if (getHarvested(symbol, scope) < count) return null;
  }
  const draws: BagDraw[] = [];
  for (const [symbol, count] of need) {
    let left = count;
    for (const key of visibleKeys(symbol, scope)) {
      if (left <= 0) break;
      const take = Math.min(left, counts.get(key) ?? 0);
      if (take > 0) { bump(key, -take); left -= take; draws.push({ key, count: take }); }
    }
  }
  scheduleWrite();
  notify();
  return draws;
}

/** Best-effort spend — returns false (nothing spent) if not enough is held. */
export function spendHarvested(parts: { symbol: string; count: number }[], scope?: BagScope): boolean {
  return spendHarvestedDraws(parts, scope) !== null;
}

/** Put drawn goods back into exactly the bags they were drawn from. */
export function restoreDraws(draws: BagDraw[]): void {
  let changed = false;
  for (const { key, count } of draws) {
    if (!key || !Number.isFinite(count) || count <= 0) continue;
    bump(key, count);
    changed = true;
  }
  if (changed) { scheduleWrite(); notify(); }
}

/**
 * The bag a draw came from, as a key prefix ('' is the online bag). With
 * `recordHarvestInBag`, something made from a drawn good (a grilled fish)
 * lands in the same bag as what it was made from.
 */
export function bagOfDraw(key: string): string {
  const parsed = parseKey(key);
  if (parsed.bag === 'offline') return OFFLINE_PREFIX;
  if (parsed.bag === 'seed') return `${SEED_PREFIX}${parsed.projectId}|`;
  return '';
}

export function recordHarvestInBag(bag: string, symbol: string, count: number): void {
  if (!symbol || !Number.isFinite(count) || count === 0) return;
  const known = bag === '' || bag === OFFLINE_PREFIX || (bag.startsWith(SEED_PREFIX) && bag.endsWith('|'));
  // An unknown bag is treated as offline, never as online.
  bump(`${known ? bag : OFFLINE_PREFIX}${symbol}`, count);
  scheduleWrite();
  notify();
}

// What the player can use changes when they go online/offline or step
// into another project's Brain.
subscribePlayMode(() => notify());

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