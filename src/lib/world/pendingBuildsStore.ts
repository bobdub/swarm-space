/**
 * pendingBuildsStore — staged ghosts waiting to be built.
 *
 * A staged ghost is a *local, private* intent: only its owner sees it, it
 * is never gossiped, and it holds no field body. When the owner finishes
 * the press-and-hold, the completion path calls
 * `getBuilderBlockEngine().placeBlock(...)` via `placePrefabAtHit` — still
 * the single writer to the lattice — and the pending record is dropped.
 *
 * Position is stored as an Earth-LOCAL unit direction plus a vertical
 * offset, exactly like placements, so a staged ghost stays glued to the
 * turning planet instead of drifting in world space.
 *
 * Throttled IDB writes per the project browser-performance rule.
 */
import type { Vec3 } from '@/lib/brain/earth';

const DB_NAME = 'swarm-pending-builds';
const STORE = 'pending';
const DB_VERSION = 1;
const KEY = 'local';

export interface PendingBuild {
  id: string;
  prefabId: string;
  /** Earth-local unit direction of the ground cell under the ghost. */
  localDir: Vec3;
  /** Yaw around the local surface normal, radians. */
  yaw: number;
  /** Vertical stack offset above the local surface, metres. */
  upOffset: number;
  createdAt: number;
}

type Listener = (list: PendingBuild[]) => void;

const items = new Map<string, PendingBuild>();
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
      // Non-destructive cross-tab upgrade per project rule.
      db.onversionchange = () => { try { db.close(); } catch { /* noop */ } };
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function scheduleWrite(): void {
  if (writeTimer !== null) return;
  const timer = typeof window !== 'undefined' ? window.setTimeout : setTimeout;
  writeTimer = timer(async () => {
    writeTimer = null;
    const snap = [...items.values()];
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
  }, 1200) as unknown as number;
}

function notify(): void {
  const snap = listPendingBuilds();
  for (const fn of listeners) {
    try { fn(snap); } catch { /* noop */ }
  }
}

export function listPendingBuilds(): PendingBuild[] {
  return [...items.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export function getPendingBuild(id: string): PendingBuild | undefined {
  return items.get(id);
}

export function stagePendingBuild(
  input: Omit<PendingBuild, 'id' | 'createdAt'> & { id?: string },
): PendingBuild {
  const rec: PendingBuild = {
    id: input.id ?? `pending:${input.prefabId}:${Date.now().toString(36)}:${Math.floor(Math.random() * 1e6).toString(36)}`,
    prefabId: input.prefabId,
    localDir: input.localDir,
    yaw: input.yaw ?? 0,
    upOffset: input.upOffset ?? 0,
    createdAt: Date.now(),
  };
  items.set(rec.id, rec);
  scheduleWrite();
  notify();
  return rec;
}

export function updatePendingBuild(id: string, patch: Partial<Omit<PendingBuild, 'id'>>): void {
  const cur = items.get(id);
  if (!cur) return;
  items.set(id, { ...cur, ...patch });
  scheduleWrite();
  notify();
}

export function removePendingBuild(id: string): void {
  if (!items.delete(id)) return;
  scheduleWrite();
  notify();
}

export function subscribePendingBuilds(fn: Listener): () => void {
  listeners.add(fn);
  try { fn(listPendingBuilds()); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}

export async function hydratePendingBuilds(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const db = await openDb();
  if (!db) return;
  const snap = await new Promise<PendingBuild[]>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as PendingBuild[]) ?? []);
    req.onerror = () => resolve([]);
  });
  try { db.close(); } catch { /* noop */ }
  for (const rec of snap) {
    if (rec && typeof rec.id === 'string' && Array.isArray(rec.localDir)) items.set(rec.id, rec);
  }
  notify();
}

export function _resetPendingBuildsForTest(): void {
  items.clear();
  listeners.clear();
  hydrated = false;
}
