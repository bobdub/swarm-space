/**
 * worldPlacementsStore — IDB persistence + cross-tab/P2P gossip for
 * Phase 5 user-placed prefabs. Mirrors the mintedPrefabsStore pattern:
 * local-first, BroadcastChannel fan-out, gossip-bridge plug-point,
 * non-destructive IDB upgrade, local-protect against peer overwrite.
 */
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { placePrefabAtHit, type PlacedHandle } from '@/lib/world/placementController';

const DB_NAME = 'swarm-world-placements';
const STORE = 'placements';
const DB_VERSION = 1;
const CHANNEL_NAME = 'swarm:world:placements';

export interface PlacementRecord extends PlacedHandle {
  _origin: 'local' | 'peer';
  /** Wall decoration: a Post pinned to this wall's front face. */
  decoration?: { postId: string; updatedAt: number };
}

type Listener = (records: PlacementRecord[]) => void;
const listeners = new Set<Listener>();
const records = new Map<string, PlacementRecord>();
let hydrated = false;
let channel: BroadcastChannel | null = null;
let gossipBridge: ((rec: PlacementRecord) => void) | null = null;

function chan(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try { channel = new BroadcastChannel(CHANNEL_NAME); } catch { channel = null; }
  if (channel) {
    channel.onmessage = (ev) => {
      const rec = ev?.data as PlacementRecord | undefined;
      if (!rec || !rec.placementId) return;
      ingest({ ...rec, _origin: 'peer' });
    };
  }
  return channel;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'placementId' });
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

async function dbPut(rec: PlacementRecord): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  try { db.close(); } catch { /* noop */ }
}

async function dbDelete(placementId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(placementId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  try { db.close(); } catch { /* noop */ }
}

async function dbAll(): Promise<PlacementRecord[]> {
  const db = await openDb();
  if (!db) return [];
  const out = await new Promise<PlacementRecord[]>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as PlacementRecord[]) ?? []);
    req.onerror = () => resolve([]);
  });
  try { db.close(); } catch { /* noop */ }
  return out;
}

let notifyHandle: number | null = null;
function scheduleNotify(): void {
  if (notifyHandle !== null) return;
  notifyHandle = (typeof window !== 'undefined' ? window.setTimeout : setTimeout)(() => {
    notifyHandle = null;
    const snap = listPlacements();
    for (const fn of listeners) {
      try { fn(snap); } catch (err) { console.warn('[worldPlacements] listener error', err); }
    }
  }, 250) as unknown as number;
}

function ingest(rec: PlacementRecord, opts: { replay?: boolean } = {}): void {
  const existing = records.get(rec.placementId);
  if (existing && existing._origin === 'local' && rec._origin === 'peer') return;
  records.set(rec.placementId, rec);
  // Replay onto the BuilderBlockEngine on hydration / peer arrival.
  if (opts.replay || rec._origin === 'peer') {
    try {
      const changed = !existing
        || existing.prefabId !== rec.prefabId
        || existing.yaw !== rec.yaw
        || existing.hitPoint.some((value, index) => Math.abs(value - rec.hitPoint[index]) > 0.001);
      if (changed) getBuilderBlockEngine().removeBlock(rec.placementId, existing?.prefabId ?? rec.prefabId);
      placePrefabAtHit({
        hitPoint: rec.hitPoint,
        prefabId: rec.prefabId,
        actorId: rec.actorId,
        yaw: rec.yaw,
        placementId: rec.placementId,
      });
    } catch (err) {
      console.warn('[worldPlacements] replay failed', err);
    }
  }
  scheduleNotify();
}

export async function hydrateWorldPlacements(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  chan();
  const all = await dbAll();
  for (const r of all) ingest({ ...r, _origin: 'local' }, { replay: true });
}

export async function recordLocalPlacement(handle: PlacedHandle): Promise<PlacementRecord> {
  const rec: PlacementRecord = { ...handle, _origin: 'local' };
  records.set(rec.placementId, rec);
  await dbPut(rec);
  try { chan()?.postMessage(rec); } catch { /* noop */ }
  try { gossipBridge?.(rec); } catch (err) { console.warn('[worldPlacements] gossip error', err); }
  scheduleNotify();
  return rec;
}

export async function updateLocalPlacement(handle: PlacedHandle): Promise<PlacementRecord> {
  const rec: PlacementRecord = { ...handle, _origin: 'local' };
  const prev = records.get(rec.placementId);
  if (prev) getBuilderBlockEngine().removeBlock(rec.placementId, prev.prefabId);
  placePrefabAtHit({
    hitPoint: rec.hitPoint,
    prefabId: rec.prefabId,
    actorId: rec.actorId,
    yaw: rec.yaw,
    placementId: rec.placementId,
  });
  records.set(rec.placementId, rec);
  await dbPut(rec);
  try { chan()?.postMessage(rec); } catch { /* noop */ }
  try { gossipBridge?.(rec); } catch (err) { console.warn('[worldPlacements] gossip error', err); }
  scheduleNotify();
  return rec;
}

/**
 * Patch metadata on an existing placement (e.g. wall decoration) without
 * touching the underlying BuilderBlock. Re-placing the block for a pure
 * metadata change tears down the physics body for a frame and makes the
 * wall visibly vanish — this path keeps the block intact.
 */
export async function patchLocalPlacementMeta(
  placementId: string,
  patch: Partial<Pick<PlacementRecord, 'decoration'>>,
): Promise<PlacementRecord | null> {
  const prev = records.get(placementId);
  if (!prev) return null;
  const next: PlacementRecord = { ...prev, ...patch, _origin: 'local' };
  records.set(placementId, next);
  await dbPut(next);
  try { chan()?.postMessage(next); } catch { /* noop */ }
  try { gossipBridge?.(next); } catch (err) { console.warn('[worldPlacements] gossip error', err); }
  scheduleNotify();
  return next;
}

export async function removeLocalPlacement(placementId: string): Promise<void> {
  const rec = records.get(placementId);
  if (!rec) return;
  records.delete(placementId);
  getBuilderBlockEngine().removeBlock(placementId, rec.prefabId);
  await dbDelete(placementId);
  scheduleNotify();
}

export function listPlacements(): PlacementRecord[] {
  return [...records.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function subscribePlacements(fn: Listener): () => void {
  listeners.add(fn);
  try { fn(listPlacements()); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}

export function attachPlacementGossip(bridge: (rec: PlacementRecord) => void): () => void {
  gossipBridge = bridge;
  return () => { if (gossipBridge === bridge) gossipBridge = null; };
}

export function acceptPeerPlacement(rec: Omit<PlacementRecord, '_origin'>): void {
  ingest({ ...rec, _origin: 'peer' });
}

export function _resetWorldPlacementsForTest(): void {
  records.clear();
  listeners.clear();
  hydrated = false;
  if (channel) { try { channel.close(); } catch { /* noop */ } channel = null; }
  gossipBridge = null;
}