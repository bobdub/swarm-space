/**
 * mintedPrefabsStore — IndexedDB persistence + cross-tab/P2P gossip for
 * Lab-minted prefabs. Phase 1 wiring of the Lab → World scaffold.
 *
 * Design:
 *   • Local-first: every mint hits IndexedDB (`swarm-lab-mints` / `mints`).
 *   • Cross-tab: BroadcastChannel `swarm:lab:mints` for instant fan-out.
 *   • Gun bridge hook: `attachGossip()` lets the P2P layer subscribe and
 *     re-broadcast without this module importing Gun directly (keeps the
 *     stability rule — standalone, no P2P imports).
 *   • Hydration registers every saved prefab into `prefabHouseCatalog`
 *     so the Builder Bar sees them after reload.
 *   • Throttled writes: each mint fires its own put (mints are rare),
 *     but listeners debounce notifications to ≤4 Hz.
 *
 * Honors the project rule: "Local Data: Protect local entries from P2P
 * upsert overwrites." We tag every record with `_origin: 'local' | 'peer'`
 * and never let a peer record overwrite a local one with the same id.
 */
import {
  registerCustomPrefab,
  type Prefab,
} from '@/lib/brain/prefabHouseCatalog';

const DB_NAME = 'swarm-lab-mints';
const STORE = 'mints';
const CHANNEL_NAME = 'swarm:lab:mints';
const DB_VERSION = 1;

export interface MintedRecord {
  id: string;            // prefab id (`mint:<molId>:<actor>:<ts>` or `mint:<molId>`)
  prefab: Prefab;
  actorId: string;
  createdAt: number;
  _origin: 'local' | 'peer';
}

type Listener = (records: MintedRecord[]) => void;
const listeners = new Set<Listener>();
const records = new Map<string, MintedRecord>();
let hydrated = false;
let channel: BroadcastChannel | null = null;
let gossipBridge: ((rec: MintedRecord) => void) | null = null;

function safeBroadcastChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try { channel = new BroadcastChannel(CHANNEL_NAME); } catch { channel = null; }
  if (channel) {
    channel.onmessage = (ev) => {
      const rec = ev?.data as MintedRecord | undefined;
      if (!rec || !rec.id || !rec.prefab) return;
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
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Non-destructive cross-tab upgrade handling (project core rule).
      db.onversionchange = () => { try { db.close(); } catch { /* noop */ } };
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function dbPut(rec: MintedRecord): Promise<void> {
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

async function dbAll(): Promise<MintedRecord[]> {
  const db = await openDb();
  if (!db) return [];
  const out = await new Promise<MintedRecord[]>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as MintedRecord[]) ?? []);
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
    const snap = listMintedPrefabs();
    for (const fn of listeners) {
      try { fn(snap); } catch (err) { console.warn('[mintedPrefabs] listener error', err); }
    }
  }, 250) as unknown as number;
}

function ingest(rec: MintedRecord): void {
  const existing = records.get(rec.id);
  // Local protection: never let a peer record overwrite a local one.
  if (existing && existing._origin === 'local' && rec._origin === 'peer') return;
  records.set(rec.id, rec);
  try { registerCustomPrefab(rec.prefab); } catch (err) {
    console.warn('[mintedPrefabs] register failed', err);
  }
  scheduleNotify();
}

export async function hydrateMintedPrefabs(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  safeBroadcastChannel();
  const all = await dbAll();
  for (const r of all) ingest({ ...r, _origin: 'local' });
}

export interface MintInput {
  prefab: Prefab;
  actorId: string;
}

/** Mint a new prefab into the world. Local-origin, persisted, gossiped. */
export async function mintPrefab({ prefab, actorId }: MintInput): Promise<MintedRecord> {
  const id = prefab.id;
  const rec: MintedRecord = {
    id,
    prefab,
    actorId,
    createdAt: Date.now(),
    _origin: 'local',
  };
  ingest(rec);
  await dbPut(rec);
  const ch = safeBroadcastChannel();
  try { ch?.postMessage(rec); } catch { /* noop */ }
  try { gossipBridge?.(rec); } catch (err) { console.warn('[mintedPrefabs] gossip bridge error', err); }
  return rec;
}

export function listMintedPrefabs(): MintedRecord[] {
  return [...records.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function subscribeMintedPrefabs(fn: Listener): () => void {
  listeners.add(fn);
  try { fn(listMintedPrefabs()); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}

/**
 * Allow the P2P layer to attach a gossip bridge (e.g. Gun.js relay).
 * Returns a detach fn. The bridge receives every locally-minted record
 * and is responsible for pushing it to the mesh; inbound peer records
 * should be funneled back through `acceptPeerMint`.
 */
export function attachMintedGossip(bridge: (rec: MintedRecord) => void): () => void {
  gossipBridge = bridge;
  return () => { if (gossipBridge === bridge) gossipBridge = null; };
}

/** P2P inbound entry — peer-origin record received from the mesh. */
export function acceptPeerMint(rec: Omit<MintedRecord, '_origin'>): void {
  ingest({ ...rec, _origin: 'peer' });
}

/** Test seam. */
export function _resetMintedPrefabsForTest(): void {
  records.clear();
  listeners.clear();
  hydrated = false;
  if (channel) { try { channel.close(); } catch { /* noop */ } channel = null; }
  gossipBridge = null;
}