/**
 * labourLedger — Phase 3 surfacing of `coin.fill` events whose coinId
 * is namespaced `labour:<actorId>`.
 *
 * Local-first, throttled, P2P-friendly:
 *   • Subscribes to `scaffoldBus` `coin` events (one writer point).
 *   • Aggregates per-actor totals + a bounded recent-events ring.
 *   • Persists to IndexedDB (`swarm-labour` v1) on the project's 2.5 m
 *     throttle, with synchronous flush on visibilitychange / unload.
 *   • Cross-tab gossip via BroadcastChannel `swarm:labour:fills`.
 *   • Pure observer — never injects back into the field, never spends.
 *
 * The Wallet "Payouts" panel reads `getLabourLedger()` /
 * `subscribeLabourLedger()`; everything else stays decoupled.
 */
import { subscribeScaffold } from '@/lib/uqrc/scaffoldBus';
import type { CoinFillEvent } from '@/lib/uqrc/scaffoldPorts';

const DB_NAME = 'swarm-labour';
const STORE = 'ledger';
const VERSION = 1;
const SAVE_THROTTLE_MS = 2.5 * 60 * 1000;
const RECENT_CAP = 64;
const BROADCAST_NAME = 'swarm:labour:fills';

export interface LabourEntry {
  actorId: string;
  delta: number;
  at: number;
  origin: 'local' | 'peer';
}

export interface LabourSnapshot {
  totals: Record<string, number>;
  recent: LabourEntry[];
  lastUpdate: number;
}

const state: LabourSnapshot = { totals: {}, recent: [], lastUpdate: 0 };
const listeners = new Set<(s: LabourSnapshot) => void>();

let booted = false;
let lastSaveAt = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let bc: BroadcastChannel | null = null;
let unloadHooked = false;

function notify(): void {
  const snap = snapshot();
  for (const fn of listeners) {
    try { fn(snap); } catch { /* noop */ }
  }
}

function snapshot(): LabourSnapshot {
  return {
    totals: { ...state.totals },
    recent: state.recent.slice(),
    lastUpdate: state.lastUpdate,
  };
}

function applyEntry(entry: LabourEntry): void {
  if (!entry.actorId || entry.delta <= 0) return;
  state.totals[entry.actorId] = (state.totals[entry.actorId] ?? 0) + entry.delta;
  state.recent.unshift(entry);
  if (state.recent.length > RECENT_CAP) state.recent.length = RECENT_CAP;
  state.lastUpdate = entry.at;
}

function actorFromCoinId(coinId: string): string | null {
  if (!coinId.startsWith('labour:')) return null;
  const id = coinId.slice('labour:'.length);
  return id.length > 0 ? id : null;
}

// ── IndexedDB (non-destructive upgrade lifecycle) ────────────────────
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, VERSION); } catch { return resolve(null); }
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

async function dbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  try { db.close(); } catch { /* noop */ }
}

async function dbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  const out = await new Promise<T | null>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => resolve(null);
  });
  try { db.close(); } catch { /* noop */ }
  return out;
}

function scheduleSave(): void {
  const now = Date.now();
  const elapsed = now - lastSaveAt;
  if (elapsed >= SAVE_THROTTLE_MS) {
    lastSaveAt = now;
    void dbPut('snapshot', snapshot());
    return;
  }
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    lastSaveAt = Date.now();
    void dbPut('snapshot', snapshot());
  }, SAVE_THROTTLE_MS - elapsed);
}

function flushSaveSync(): void {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
  lastSaveAt = Date.now();
  void dbPut('snapshot', snapshot());
}

function hookUnloadOnce(): void {
  if (unloadHooked || typeof window === 'undefined') return;
  unloadHooked = true;
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSaveSync();
  });
  window.addEventListener('beforeunload', flushSaveSync);
}

// ── BroadcastChannel (cross-tab gossip) ──────────────────────────────
function ensureBroadcast(): void {
  if (bc || typeof BroadcastChannel === 'undefined') return;
  try {
    bc = new BroadcastChannel(BROADCAST_NAME);
    bc.onmessage = (msg) => {
      const e = msg?.data as LabourEntry | undefined;
      if (!e || typeof e.actorId !== 'string' || typeof e.delta !== 'number') return;
      applyEntry({ ...e, origin: 'peer' });
      notify();
      scheduleSave();
    };
  } catch { bc = null; }
}

function broadcast(entry: LabourEntry): void {
  if (!bc) return;
  try { bc.postMessage(entry); } catch { /* noop */ }
}

// ── Public API ───────────────────────────────────────────────────────
export function getLabourLedger(): LabourSnapshot {
  return snapshot();
}

export function subscribeLabourLedger(fn: (s: LabourSnapshot) => void): () => void {
  listeners.add(fn);
  fn(snapshot());
  return () => { listeners.delete(fn); };
}

/** Boot — idempotent. Hydrate, subscribe, hook persistence. */
export async function bootLabourLedger(): Promise<void> {
  if (booted) return;
  booted = true;
  hookUnloadOnce();
  ensureBroadcast();

  // Hydrate prior snapshot.
  try {
    const prior = await dbGet<LabourSnapshot>('snapshot');
    if (prior && prior.totals && typeof prior.totals === 'object') {
      Object.assign(state.totals, prior.totals);
      if (Array.isArray(prior.recent)) {
        state.recent = prior.recent.slice(0, RECENT_CAP);
      }
      state.lastUpdate = prior.lastUpdate ?? 0;
      notify();
    }
  } catch { /* ignore */ }

  // Subscribe to coin.fill events.
  subscribeScaffold<CoinFillEvent>('coin', (evt) => {
    const actorId = actorFromCoinId(evt.coinId);
    if (!actorId) return; // only labour:* lands in this ledger
    const entry: LabourEntry = {
      actorId,
      delta: evt.delta,
      at: Date.now(),
      origin: 'local',
    };
    applyEntry(entry);
    notify();
    broadcast(entry);
    scheduleSave();
  });
}

/** Test seam — wipe in-memory state. Persistence is left intact. */
export function _resetLabourLedgerForTest(): void {
  for (const k of Object.keys(state.totals)) delete state.totals[k];
  state.recent.length = 0;
  state.lastUpdate = 0;
  listeners.clear();
  booted = false;
  if (bc) { try { bc.close(); } catch { /* noop */ } bc = null; }
}