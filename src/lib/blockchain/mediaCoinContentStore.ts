/**
 * mediaCoinContentStore — Media Coin content at rest, once per merkleRoot.
 *
 * Content identity is the merkleRoot, never the coinId: the original coin
 * and every Support Coin carrying the same content share one record
 * (`media-coin-content:<merkleRoot>`) and one set of chunks. The record
 * also lists the coins seen carrying it, its supporters and the most hops
 * it was seen to travel.
 *
 * Storage: its own IndexedDB database (`swarm-media-coin-content`), apart
 * from the torrent chunk store, so courier content never re-hydrates a
 * torrent. Without IndexedDB (tests, private modes) it falls back to
 * memory for the session.
 */
import { useSyncExternalStore } from "react";
import {
  readMediaCoinPlaintext,
  type MediaCoinChunkStore,
  type MediaCoinManifest,
} from "./mediaCoin.standalone";

export interface MediaCoinSupporter {
  coinId: string;
  supporterId: string;
  name?: string;
  at: number;
}

export interface MediaCoinContentRecord {
  /** `media-coin-content:<merkleRoot>` */
  id: string;
  merkleRoot: string;
  manifest: MediaCoinManifest;
  complete: boolean;
  name: string;
  mime: string;
  size: number;
  postId?: string;
  creatorId: string;
  /** Every coin seen carrying this content (original first). */
  coinIds: string[];
  supporters: MediaCoinSupporter[];
  /** Most hops any coin carrying this content was seen to make. */
  hops: number;
  /** True when this device minted it. */
  createdBySelf?: boolean;
  /**
   * Encrypted at attach time for a post not yet published. Drafts are
   * never listed, launched or offered; publishing clears the flag.
   */
  draft?: boolean;
  firstSeenAt: number;
  updatedAt: number;
}

/** A record as the dashboard lists it (no manifest key material). */
export interface MediaCoinContentSummary extends Omit<MediaCoinContentRecord, "manifest"> {
  storedBytes: number;
  chunksHeld: number;
  totalChunks: number;
}

const DB_NAME = "swarm-media-coin-content";
const DB_VERSION = 1;
const CONTENT = "content";
const CHUNKS = "chunks";
const MAX_SUPPORTERS = 256;
const MAX_COIN_IDS = 256;

export function mediaCoinContentKey(merkleRoot: string): string {
  return `media-coin-content:${merkleRoot}`;
}

const chunkKey = (root: string, index: number) => `${root}:${index}`;

// ── IndexedDB (with an in-memory fallback) ────────────────────────────

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memContent = new Map<string, MediaCoinContentRecord>();
const memChunks = new Map<string, string>();

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CONTENT)) db.createObjectStore(CONTENT, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: "key" });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { try { db.close(); } catch { /* noop */ } dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function reqP<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, op: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  if (!db) throw new Error("no indexeddb");
  const t = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  const out = await op(t);
  await done;
  return out;
}

async function readRecord(root: string): Promise<MediaCoinContentRecord | null> {
  const db = await openDb();
  if (!db) return memContent.get(mediaCoinContentKey(root)) ?? null;
  return (await tx([CONTENT], "readonly", (t) => reqP(t.objectStore(CONTENT).get(mediaCoinContentKey(root))))) ?? null;
}

async function writeRecord(rec: MediaCoinContentRecord): Promise<void> {
  const db = await openDb();
  if (!db) { memContent.set(rec.id, rec); return; }
  await tx([CONTENT], "readwrite", (t) => { t.objectStore(CONTENT).put(rec); });
}

async function allRecords(): Promise<MediaCoinContentRecord[]> {
  const db = await openDb();
  if (!db) return Array.from(memContent.values());
  return (await tx([CONTENT], "readonly", (t) => reqP(t.objectStore(CONTENT).getAll()))) as MediaCoinContentRecord[];
}

async function chunkKeysFor(root: string): Promise<string[]> {
  const db = await openDb();
  if (!db) return Array.from(memChunks.keys()).filter((k) => k.startsWith(`${root}:`));
  const range = IDBKeyRange.bound(`${root}:`, `${root}:￿`);
  return (await tx([CHUNKS], "readonly", (t) => reqP(t.objectStore(CHUNKS).getAllKeys(range)))) as string[];
}

// Serialize record read-modify-writes so concurrent arrivals never lose a field.
let recordQueue: Promise<unknown> = Promise.resolve();
function updateRecord(root: string, fn: (rec: MediaCoinContentRecord | null) => MediaCoinContentRecord | null): Promise<MediaCoinContentRecord | null> {
  const run = recordQueue.then(async () => {
    const next = fn(await readRecord(root));
    if (next) await writeRecord(next);
    return next;
  });
  recordQueue = run.catch(() => {});
  return run;
}

// ── Listeners & snapshot ──────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot: MediaCoinContentSummary[] = [];
let refreshing: Promise<void> | null = null;
let refreshAgain = false;

async function summarize(rec: MediaCoinContentRecord): Promise<MediaCoinContentSummary> {
  const { manifest, ...rest } = rec;
  const chunksHeld = rec.complete ? manifest.totalChunks : (await chunkKeysFor(rec.merkleRoot)).length;
  const storedBytes = rec.complete ? manifest.totalSize : Math.min(manifest.totalSize, chunksHeld * manifest.chunkSize);
  return { ...rest, storedBytes, chunksHeld, totalChunks: manifest.totalChunks };
}

/** Re-read every record into the dashboard snapshot. */
export function refreshMediaCoinContents(): Promise<void> {
  if (refreshing) { refreshAgain = true; return refreshing; }
  refreshing = (async () => {
    try {
      const recs = await allRecords();
      const out: MediaCoinContentSummary[] = [];
      for (const r of recs) if (!r.draft) out.push(await summarize(r));
      snapshot = out.sort((a, b) => b.updatedAt - a.updatedAt);
      for (const fn of listeners) { try { fn(); } catch { /* listener errors stay local */ } }
    } catch { /* storage unavailable */ }
  })().finally(() => {
    refreshing = null;
    if (refreshAgain) { refreshAgain = false; void refreshMediaCoinContents(); }
  });
  return refreshing;
}

function changed(root: string): void {
  void refreshMediaCoinContents();
  if (typeof window !== "undefined") {
    try { window.dispatchEvent(new CustomEvent("media-coin-content-changed", { detail: { merkleRoot: root } })); } catch { /* noop */ }
  }
}

export function subscribeMediaCoinContents(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function listMediaCoinContents(): MediaCoinContentSummary[] {
  return snapshot;
}

export function useMediaCoinContents(): MediaCoinContentSummary[] {
  return useSyncExternalStore(subscribeMediaCoinContents, listMediaCoinContents, listMediaCoinContents);
}

// ── Records ───────────────────────────────────────────────────────────

/** The base manifest is stripped of coin-specific fields at rest. */
function baseRecord(manifest: MediaCoinManifest, now: number): MediaCoinContentRecord {
  const { supporter: _s, ...base } = manifest;
  return {
    id: mediaCoinContentKey(manifest.merkleRoot),
    merkleRoot: manifest.merkleRoot,
    manifest: base,
    complete: false,
    name: manifest.name,
    mime: manifest.mimeType,
    size: manifest.totalSize,
    postId: manifest.postId,
    creatorId: manifest.creatorId,
    coinIds: [manifest.coinId],
    supporters: [],
    hops: 0,
    firstSeenAt: now,
    updatedAt: now,
  };
}

export async function getMediaCoinContent(merkleRoot: string): Promise<MediaCoinContentRecord | null> {
  try { return await readRecord(merkleRoot); } catch { return null; }
}

/** Note a coin seen carrying this content, its hops, and (for Support Coins) its supporter. */
export async function recordMediaCoinSighting(
  manifest: MediaCoinManifest,
  sighting: { hops: number; supporter?: { id: string; name?: string } },
): Promise<void> {
  const now = Date.now();
  await updateRecord(manifest.merkleRoot, (rec) => {
    if (!rec) return null; // nothing held: nothing to annotate
    const coinIds = rec.coinIds.includes(manifest.coinId) ? rec.coinIds : [...rec.coinIds, manifest.coinId].slice(-MAX_COIN_IDS);
    let supporters = rec.supporters;
    const sup = sighting.supporter;
    if (sup?.id && !supporters.some((s) => s.coinId === manifest.coinId)) {
      supporters = [...supporters, { coinId: manifest.coinId, supporterId: sup.id, name: sup.name, at: now }].slice(-MAX_SUPPORTERS);
    }
    return {
      ...rec,
      coinIds,
      supporters,
      hops: Math.max(rec.hops, Math.max(0, sighting.hops)),
      postId: rec.postId ?? manifest.postId,
      updatedAt: now,
    };
  });
  changed(manifest.merkleRoot);
}

export async function markMediaCoinContentSelf(merkleRoot: string): Promise<void> {
  await updateRecord(merkleRoot, (rec) => (rec ? { ...rec, createdBySelf: true, updatedAt: Date.now() } : null));
  changed(merkleRoot);
}

/** Flag freshly minted content as a draft (attached, not yet posted). */
export async function markMediaCoinContentDraft(merkleRoot: string): Promise<void> {
  await updateRecord(merkleRoot, (rec) => (rec ? { ...rec, draft: true, updatedAt: Date.now() } : null));
}

/**
 * Publish a draft: bind it to its coin and post. The coin becomes the
 * original carrier, so `coinIds` starts with it.
 */
export async function publishMediaCoinDraft(merkleRoot: string, bind: { coinId: string; postId: string }): Promise<void> {
  await updateRecord(merkleRoot, (rec) => {
    if (!rec) return null;
    const { draft: _d, ...rest } = rec;
    return {
      ...rest,
      manifest: { ...rec.manifest, coinId: bind.coinId, postId: bind.postId },
      postId: bind.postId,
      coinIds: [bind.coinId],
      createdBySelf: true,
      updatedAt: Date.now(),
    };
  });
  changed(merkleRoot);
}

/** Drop drafts older than `maxAgeMs` (a composer that was closed without posting). */
export async function sweepMediaCoinDrafts(maxAgeMs: number, now = Date.now()): Promise<number> {
  let dropped = 0;
  for (const rec of await allRecords().catch(() => [] as MediaCoinContentRecord[])) {
    if (rec.draft && now - rec.updatedAt > maxAgeMs) {
      await deleteMediaCoinContent(rec.merkleRoot);
      dropped++;
    }
  }
  return dropped;
}

/** Remove the local copy (manifest and every chunk). */
export async function deleteMediaCoinContent(merkleRoot: string): Promise<void> {
  revokeObjectUrl(merkleRoot);
  const keys = await chunkKeysFor(merkleRoot).catch(() => [] as string[]);
  const db = await openDb();
  if (!db) {
    memContent.delete(mediaCoinContentKey(merkleRoot));
    for (const k of keys) memChunks.delete(k);
  } else {
    await recordQueue.catch(() => {});
    await tx([CONTENT, CHUNKS], "readwrite", (t) => {
      t.objectStore(CONTENT).delete(mediaCoinContentKey(merkleRoot));
      const chunks = t.objectStore(CHUNKS);
      for (const k of keys) chunks.delete(k);
    });
  }
  changed(merkleRoot);
}

// ── Display ───────────────────────────────────────────────────────────

const objectUrls = new Map<string, string>();

function revokeObjectUrl(root: string): void {
  const url = objectUrls.get(root);
  if (url) {
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
    objectUrls.delete(root);
  }
}

/** The content as a Blob, decrypted one chunk at a time. Null until held whole. */
export async function readMediaCoinContentBlob(merkleRoot: string): Promise<Blob | null> {
  const rec = await getMediaCoinContent(merkleRoot);
  if (!rec?.complete) return null;
  const parts: BlobPart[] = [];
  for await (const p of readMediaCoinPlaintext(rec.manifest, mediaCoinContentStore)) parts.push(p as BlobPart);
  return new Blob(parts, { type: rec.mime });
}

/** A cached object URL for the content (one per root). */
export async function getMediaCoinContentUrl(merkleRoot: string): Promise<string | null> {
  const cached = objectUrls.get(merkleRoot);
  if (cached) return cached;
  const blob = await readMediaCoinContentBlob(merkleRoot);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrls.set(merkleRoot, url);
  return url;
}

// ── The engine's chunk store ──────────────────────────────────────────

export const mediaCoinContentStore: MediaCoinChunkStore = {
  async getManifest(root) {
    return (await readRecord(root))?.manifest ?? null;
  },
  async putManifest(manifest, complete) {
    const now = Date.now();
    const rec = await updateRecord(manifest.merkleRoot, (prev) => {
      const base = prev ?? baseRecord(manifest, now);
      return { ...base, complete: base.complete || complete, postId: base.postId ?? manifest.postId, updatedAt: now };
    });
    if (rec) changed(manifest.merkleRoot);
  },
  async isComplete(root) {
    // A draft is held whole but not posted yet: it is never offered or served.
    const rec = await readRecord(root);
    return Boolean(rec?.complete && !rec.draft);
  },
  async putChunk(root, index, data) {
    const db = await openDb();
    if (!db) { memChunks.set(chunkKey(root, index), data); return; }
    await tx([CHUNKS], "readwrite", (t) => { t.objectStore(CHUNKS).put({ key: chunkKey(root, index), root, index, data }); });
  },
  async getChunk(root, index) {
    const db = await openDb();
    if (!db) return memChunks.get(chunkKey(root, index)) ?? null;
    const row = await tx([CHUNKS], "readonly", (t) => reqP(t.objectStore(CHUNKS).get(chunkKey(root, index)))) as { data?: string } | undefined;
    return typeof row?.data === "string" ? row.data : null;
  },
  async heldIndices(root) {
    const keys = await chunkKeysFor(root);
    return keys
      .map((k) => Number(k.slice(root.length + 1)))
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b);
  },
  async deleteContent(root) {
    await deleteMediaCoinContent(root);
  },
};

/** Tests only. */
export async function _resetMediaCoinContentStoreForTest(): Promise<void> {
  memContent.clear();
  memChunks.clear();
  for (const root of Array.from(objectUrls.keys())) revokeObjectUrl(root);
  const db = await openDb();
  if (db) {
    await tx([CONTENT, CHUNKS], "readwrite", (t) => { t.objectStore(CONTENT).clear(); t.objectStore(CHUNKS).clear(); });
  }
  snapshot = [];
}
