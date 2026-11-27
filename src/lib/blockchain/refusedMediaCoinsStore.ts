/**
 * refusedMediaCoinsStore — content this device refuses to carry (Delete Sync).
 *
 * Keyed by merkleRoot (content identity), never coinId: once refused, any
 * future coin carrying the same content is answered "refused" at offer
 * time with 0 bytes moved, whether it comes from the creator or any
 * supporter. Device-local, like Stop Support.
 *
 * Storage: its own IndexedDB database (`swarm-refused-media-coins`) is the
 * durable record; a localStorage mirror lets the engine check offers
 * synchronously from the first message.
 */
import { useSyncExternalStore } from "react";

export interface RefusedMediaCoinEntry {
  merkleRoot: string;
  name?: string;
  refusedAt: number;
}

const DB_NAME = "swarm-refused-media-coins";
const STORE = "refused";
const DB_VERSION = 1;
const MIRROR_KEY = "swarm:refused-media-coins:v1";
const MAX_ENTRIES = 5000;

type Listener = () => void;
let entries = new Map<string, RefusedMediaCoinEntry>();
let snapshot: RefusedMediaCoinEntry[] = [];
const listeners = new Set<Listener>();
let hydrated: Promise<void> | null = null;

function normalize(raw: unknown): RefusedMediaCoinEntry | null {
  const r = raw as Partial<RefusedMediaCoinEntry> | null;
  if (!r || typeof r.merkleRoot !== "string" || !r.merkleRoot) return null;
  return {
    merkleRoot: r.merkleRoot,
    name: typeof r.name === "string" ? r.name.slice(0, 200) : undefined,
    refusedAt: typeof r.refusedAt === "number" ? r.refusedAt : Date.now(),
  };
}

function rebuild(): void {
  snapshot = [...entries.values()].sort((a, b) => b.refusedAt - a.refusedAt);
}

function readMirror(): RefusedMediaCoinEntry[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const parsed = JSON.parse(localStorage.getItem(MIRROR_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalize).filter((e): e is RefusedMediaCoinEntry => !!e) : [];
  } catch {
    return [];
  }
}

function writeMirror(): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (entries.size === 0) localStorage.removeItem(MIRROR_KEY);
    else localStorage.setItem(MIRROR_KEY, JSON.stringify(snapshot.slice(0, MAX_ENTRIES)));
  } catch { /* quota: IndexedDB still holds it */ }
}

function emit(): void {
  for (const fn of listeners) { try { fn(); } catch { /* noop */ } }
  if (typeof window !== "undefined") {
    try { window.dispatchEvent(new CustomEvent("refused-media-coins-changed")); } catch { /* noop */ }
  }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "merkleRoot" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function dbWrite(op: (s: IDBObjectStore) => void): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const t = db.transaction(STORE, "readwrite");
      op(t.objectStore(STORE));
      t.oncomplete = () => resolve();
      t.onerror = () => resolve();
      t.onabort = () => resolve();
    } catch { resolve(); }
  });
  try { db.close(); } catch { /* noop */ }
}

async function dbAll(): Promise<RefusedMediaCoinEntry[]> {
  const db = await openDb();
  if (!db) return [];
  const rows = await new Promise<unknown[]>((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as unknown[]) ?? []);
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
  try { db.close(); } catch { /* noop */ }
  return rows.map(normalize).filter((e): e is RefusedMediaCoinEntry => !!e);
}

// Synchronous boot from the mirror so the first offer is already checked.
for (const e of readMirror()) entries.set(e.merkleRoot, e);
rebuild();

export function hydrateRefusedMediaCoins(): Promise<void> {
  if (!hydrated) {
    hydrated = dbAll().then((rows) => {
      let grew = false;
      for (const r of rows) if (!entries.has(r.merkleRoot)) { entries.set(r.merkleRoot, r); grew = true; }
      for (const e of entries.values()) if (!rows.some((r) => r.merkleRoot === e.merkleRoot)) void dbWrite((s) => s.put(e));
      if (grew) { rebuild(); writeMirror(); emit(); }
    }).catch(() => {});
  }
  return hydrated;
}

export function isMediaCoinRefused(merkleRoot: string | null | undefined): boolean {
  return Boolean(merkleRoot) && entries.has(merkleRoot as string);
}

export async function refuseMediaCoin(merkleRoot: string, name?: string): Promise<RefusedMediaCoinEntry | null> {
  if (!merkleRoot) return null;
  const entry: RefusedMediaCoinEntry = { merkleRoot, name, refusedAt: Date.now() };
  entries.set(merkleRoot, entry);
  rebuild();
  writeMirror();
  emit();
  await dbWrite((s) => s.put(entry));
  return entry;
}

/** Accept the content again (future coins carrying it are welcome). */
export async function unrefuseMediaCoin(merkleRoot: string): Promise<void> {
  if (!entries.delete(merkleRoot)) return;
  rebuild();
  writeMirror();
  emit();
  await dbWrite((s) => s.delete(merkleRoot));
}

export function listRefusedMediaCoins(): RefusedMediaCoinEntry[] {
  return snapshot;
}

export function subscribeRefusedMediaCoins(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useRefusedMediaCoins(): RefusedMediaCoinEntry[] {
  return useSyncExternalStore(subscribeRefusedMediaCoins, listRefusedMediaCoins, listRefusedMediaCoins);
}

export function _resetRefusedMediaCoinsForTest(): void {
  entries = new Map();
  rebuild();
  listeners.clear();
  hydrated = null;
  try { localStorage.removeItem(MIRROR_KEY); } catch { /* noop */ }
}
