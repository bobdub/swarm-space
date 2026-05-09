/**
 * toolMintStore — IndexedDB persistence + cross-tab/P2P gossip for
 * forged Tools (Phase 4 of the Lab → World scaffold).
 *
 * Mirrors `mintedPrefabsStore.ts`:
 *   • Local-first IndexedDB (`swarm-tool-mints` / `tools`).
 *   • Cross-tab via BroadcastChannel `swarm:tool:mints`.
 *   • Optional P2P gossip bridge via `attachToolGossip`.
 *   • Local-protection: peer records cannot overwrite local-origin records.
 *   • Non-destructive cross-tab DB upgrade (`onversionchange` only closes).
 */
import { registerCustomTool, type Tool } from './toolCatalog';

const DB_NAME = 'swarm-tool-mints';
const STORE = 'tools';
const CHANNEL_NAME = 'swarm:tool:mints';
const DB_VERSION = 1;

export interface ForgedToolRecord {
  id: string;
  tool: Tool;
  actorId: string;
  createdAt: number;
  _origin: 'local' | 'peer';
}

type Listener = (records: ForgedToolRecord[]) => void;
const listeners = new Set<Listener>();
const records = new Map<string, ForgedToolRecord>();
let hydrated = false;
let channel: BroadcastChannel | null = null;
let gossipBridge: ((rec: ForgedToolRecord) => void) | null = null;

function safeChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try { channel = new BroadcastChannel(CHANNEL_NAME); } catch { channel = null; }
  if (channel) {
    channel.onmessage = (ev) => {
      const rec = ev?.data as ForgedToolRecord | undefined;
      if (!rec || !rec.id || !rec.tool) return;
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
      db.onversionchange = () => { try { db.close(); } catch { /* noop */ } };
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function dbPut(rec: ForgedToolRecord): Promise<void> {
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

async function dbAll(): Promise<ForgedToolRecord[]> {
  const db = await openDb();
  if (!db) return [];
  const out = await new Promise<ForgedToolRecord[]>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as ForgedToolRecord[]) ?? []);
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
    const snap = listForgedTools();
    for (const fn of listeners) {
      try { fn(snap); } catch (err) { console.warn('[toolMintStore] listener error', err); }
    }
  }, 250) as unknown as number;
}

function ingest(rec: ForgedToolRecord): void {
  const existing = records.get(rec.id);
  if (existing && existing._origin === 'local' && rec._origin === 'peer') return;
  records.set(rec.id, rec);
  try { registerCustomTool(rec.tool); } catch (err) {
    console.warn('[toolMintStore] register failed', err);
  }
  scheduleNotify();
}

export async function hydrateForgedTools(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  safeChannel();
  const all = await dbAll();
  for (const r of all) ingest({ ...r, _origin: 'local' });
}

export interface ForgeInput { tool: Tool; actorId: string; }

export async function forgeTool({ tool, actorId }: ForgeInput): Promise<ForgedToolRecord> {
  const rec: ForgedToolRecord = {
    id: tool.id,
    tool,
    actorId,
    createdAt: Date.now(),
    _origin: 'local',
  };
  ingest(rec);
  await dbPut(rec);
  const ch = safeChannel();
  try { ch?.postMessage(rec); } catch { /* noop */ }
  try { gossipBridge?.(rec); } catch (err) { console.warn('[toolMintStore] gossip bridge error', err); }
  return rec;
}

export function listForgedTools(): ForgedToolRecord[] {
  return [...records.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function subscribeForgedTools(fn: Listener): () => void {
  listeners.add(fn);
  try { fn(listForgedTools()); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}

export function attachToolGossip(bridge: (rec: ForgedToolRecord) => void): () => void {
  gossipBridge = bridge;
  return () => { if (gossipBridge === bridge) gossipBridge = null; };
}

export function acceptPeerForgedTool(rec: Omit<ForgedToolRecord, '_origin'>): void {
  ingest({ ...rec, _origin: 'peer' });
}

export function _resetForgedToolsForTest(): void {
  records.clear();
  listeners.clear();
  hydrated = false;
  if (channel) { try { channel.close(); } catch { /* noop */ } channel = null; }
  gossipBridge = null;
}