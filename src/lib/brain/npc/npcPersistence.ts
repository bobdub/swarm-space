/**
 * npcPersistence — throttled IndexedDB snapshots of the NPC registry.
 *
 * Honors the project core rule: throttled writes (≥ 2.5 m project rule).
 * Uses non-destructive cross-tab upgrade handling — never deletes the
 * existing DB on `VersionError`.
 *
 * Stores a single rolling snapshot of `listNpcs()` keyed by 'roster'.
 * Hydration is best-effort: if any record fails to spawn (e.g. seed
 * collides after a personality-uniqueness epsilon change) we just skip
 * that NPC and continue. The seed roster fills the rest.
 */
import type { Npc } from './npcTypes';

const DB_NAME = 'swarm-npcs';
const STORE = 'roster';
const VERSION = 1;
const SAVE_THROTTLE_MS = 2.5 * 60 * 1000;

let lastSaveAt = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

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

/** Schedule a throttled save of the roster. Coalesces bursts. */
export function scheduleNpcRosterSave(roster: Npc[]): void {
  const now = Date.now();
  const elapsed = now - lastSaveAt;
  if (elapsed >= SAVE_THROTTLE_MS) {
    lastSaveAt = now;
    void dbPut('roster', roster);
    return;
  }
  if (saveTimer !== null) return;
  const wait = SAVE_THROTTLE_MS - elapsed;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    lastSaveAt = Date.now();
    void dbPut('roster', roster);
  }, wait);
}

/** Force a save right now (used on visibilitychange / beforeunload). */
export function flushNpcRosterSave(roster: Npc[]): void {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
  lastSaveAt = Date.now();
  void dbPut('roster', roster);
}

export async function loadNpcRoster(): Promise<Npc[] | null> {
  return dbGet<Npc[]>('roster');
}