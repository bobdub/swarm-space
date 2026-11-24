/**
 * unsupportedPostsStore — posts this node has sovereignly stopped supporting.
 *
 * "Stop Support" is a device-level choice (not tied to the signed-in
 * account): this node stops holding, seeding and relaying one post. It is
 * stronger than Hide (which only filters a feed) and gentler than Block (it
 * targets one post, not a person). Resume Support undoes it at any time.
 *
 * While a post is unsupported on this device:
 *   - feeds and PostCard drop it immediately,
 *   - any Brain wall pinning it is not rendered at all (no mesh, collider or
 *     billboard), so the space opens up,
 *   - the mesh drops incoming copies, will not serve the post, its manifests
 *     or their chunks to peers, and deregisters this node as a seeder.
 *
 * The local copy of the post and its chunks is kept, so Resume Support can
 * put it back without a refetch.
 *
 * Storage: a dedicated IndexedDB database (`swarm-unsupported-posts`) is the
 * durable record; a localStorage mirror lets render paths and the mesh read
 * the set synchronously from the first frame.
 */
import { useSyncExternalStore } from 'react';

export interface UnsupportedPostEntry {
  /** Post id — or `placement:<placementId>` for a Brain wall/item entry. */
  postId: string;
  /** 'post' (default) or 'placement' — a Brain item with no pinned post. */
  kind?: 'post' | 'placement';
  /** Set for placement entries. */
  placementId?: string;
  /** Author id, when known — shown on the dashboard. */
  author?: string;
  authorName?: string;
  /** Short text preview for the dashboard list. */
  preview?: string;
  /** File manifests the post references (its media). */
  manifestIds: string[];
  /** Chunk refs of those manifests, captured when support stopped. */
  chunkRefs: string[];
  /** Where the user stopped support; 'block' when blocking its node did. */
  source: 'feed' | 'brain' | 'block';
  /** Set for 'block' entries: the blocked node whose content this is. */
  blockedNode?: string;
  unsupportedAt: number;
}

const DB_NAME = 'swarm-unsupported-posts';
const STORE = 'posts';
const DB_VERSION = 1;
const MIRROR_KEY = 'swarm:unsupported-posts:v1';
const CHANNEL = 'swarm:unsupported-posts';
/** Cap list sizes so a malformed entry can't balloon storage. */
const MAX_REFS = 5000;

type Listener = () => void;

let entries = new Map<string, UnsupportedPostEntry>();
let manifestIndex = new Set<string>();
let chunkIndex = new Set<string>();
let placementIndex = new Set<string>();
const PLACEMENT_PREFIX = 'placement:';
let snapshot: UnsupportedPostEntry[] = [];
const listeners = new Set<Listener>();
let hydrated: Promise<void> | null = null;
let channel: BroadcastChannel | null = null;

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, MAX_REFS);
}

function normalize(raw: unknown): UnsupportedPostEntry | null {
  const r = raw as Partial<UnsupportedPostEntry> | null;
  if (!r || typeof r !== 'object' || typeof r.postId !== 'string' || !r.postId) return null;
  const placementId = typeof r.placementId === 'string' && r.placementId ? r.placementId : undefined;
  return {
    postId: r.postId,
    kind: r.kind === 'placement' && placementId ? 'placement' : 'post',
    placementId,
    author: typeof r.author === 'string' ? r.author : undefined,
    authorName: typeof r.authorName === 'string' ? r.authorName : undefined,
    preview: typeof r.preview === 'string' ? r.preview.slice(0, 280) : undefined,
    manifestIds: strList(r.manifestIds),
    chunkRefs: strList(r.chunkRefs),
    source: r.source === 'brain' ? 'brain' : r.source === 'block' ? 'block' : 'feed',
    blockedNode: r.source === 'block' && typeof r.blockedNode === 'string' ? r.blockedNode : undefined,
    unsupportedAt: typeof r.unsupportedAt === 'number' ? r.unsupportedAt : Date.now(),
  };
}

function rebuildIndexes(): void {
  manifestIndex = new Set();
  chunkIndex = new Set();
  placementIndex = new Set();
  for (const e of entries.values()) {
    if (e.kind === 'placement' && e.placementId) placementIndex.add(e.placementId);
    e.manifestIds.forEach((id) => manifestIndex.add(id));
    e.chunkRefs.forEach((ref) => chunkIndex.add(ref));
  }
  snapshot = [...entries.values()].sort((a, b) => b.unsupportedAt - a.unsupportedAt);
}

function readMirror(): UnsupportedPostEntry[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const parsed = JSON.parse(localStorage.getItem(MIRROR_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(normalize).filter((e): e is UnsupportedPostEntry => !!e) : [];
  } catch {
    return [];
  }
}

function writeMirror(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (entries.size === 0) localStorage.removeItem(MIRROR_KEY);
    else localStorage.setItem(MIRROR_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota — IndexedDB still holds the record */
  }
}

function emit(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* listener errors must not break the store */ }
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('unsupported-posts-changed'));
      // Feeds already reload on this event.
      window.dispatchEvent(new CustomEvent('p2p-posts-updated'));
    } catch { /* noop */ }
  }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'postId' });
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

async function dbWrite(op: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
  try { db.close(); } catch { /* noop */ }
}

async function dbAll(): Promise<UnsupportedPostEntry[]> {
  const db = await openDb();
  if (!db) return [];
  const out = await new Promise<unknown[]>((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as unknown[]) ?? []);
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
  try { db.close(); } catch { /* noop */ }
  return out.map(normalize).filter((e): e is UnsupportedPostEntry => !!e);
}

function chan(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => {
      // Another tab changed the set — reload from the mirror.
      entries = new Map(readMirror().map((e) => [e.postId, e]));
      rebuildIndexes();
      emit();
    };
  } catch {
    channel = null;
  }
  return channel;
}

// Synchronous boot from the mirror so the first render already filters.
for (const e of readMirror()) entries.set(e.postId, e);
rebuildIndexes();

/** Merge the durable IndexedDB record into memory (idempotent). */
export function hydrateUnsupportedPosts(): Promise<void> {
  if (!hydrated) {
    chan();
    hydrated = dbAll().then((rows) => {
      let changed = false;
      for (const row of rows) {
        if (!entries.has(row.postId)) { entries.set(row.postId, row); changed = true; }
      }
      // Mirror-only rows (e.g. IDB write lost) are written back.
      for (const e of entries.values()) {
        if (!rows.some((r) => r.postId === e.postId)) void dbWrite((s) => s.put(e));
      }
      if (changed) { rebuildIndexes(); writeMirror(); emit(); }
    }).catch(() => { /* mirror is enough */ });
  }
  return hydrated;
}

export function isPostUnsupported(postId: string | null | undefined): boolean {
  return Boolean(postId) && entries.has(postId as string);
}

/** A Brain placement (wall or item) this node stopped supporting directly. */
export function isPlacementUnsupported(placementId: string | null | undefined): boolean {
  return Boolean(placementId) && placementIndex.has(placementId as string);
}

export function isManifestUnsupported(manifestId: string | null | undefined): boolean {
  return Boolean(manifestId) && manifestIndex.has(manifestId as string);
}

export function isChunkUnsupported(chunkRef: string | null | undefined): boolean {
  return Boolean(chunkRef) && chunkIndex.has(chunkRef as string);
}

export function listUnsupportedPosts(): UnsupportedPostEntry[] {
  return snapshot;
}

export function getUnsupportedPost(postId: string): UnsupportedPostEntry | undefined {
  return entries.get(postId);
}

export interface StopSupportInput {
  postId: string;
  source: 'feed' | 'brain' | 'block';
  blockedNode?: string;
  author?: string;
  authorName?: string;
  content?: string;
  manifestIds?: string[];
}

/** Collect chunk refs for the given manifests from local storage. */
async function chunkRefsFor(manifestIds: string[]): Promise<string[]> {
  if (manifestIds.length === 0) return [];
  try {
    const { get } = await import('@/lib/store');
    const refs: string[] = [];
    for (const id of manifestIds) {
      const manifest = await get<{ chunks?: unknown }>('manifests', id).catch(() => undefined);
      refs.push(...strList(manifest?.chunks));
    }
    return refs.slice(0, MAX_REFS);
  } catch {
    return [];
  }
}

/**
 * Stop supporting a post on this node. Fills in author, preview and media
 * from the local copy when the caller doesn't have them (e.g. a Brain wall
 * that only knows the post id).
 */
export async function stopSupportingPost(input: StopSupportInput): Promise<UnsupportedPostEntry | null> {
  if (!input.postId) return null;
  let { author, authorName, content, manifestIds } = input;
  if (!author || content === undefined || !manifestIds) {
    try {
      const { get } = await import('@/lib/store');
      const post = await get<{ author?: string; authorName?: string; content?: string; manifestIds?: string[] }>('posts', input.postId);
      author ??= post?.author;
      authorName ??= post?.authorName;
      content ??= post?.content;
      manifestIds ??= post?.manifestIds;
    } catch { /* store unavailable — keep what we have */ }
  }
  const ids = strList(manifestIds);
  const entry: UnsupportedPostEntry = {
    postId: input.postId,
    author,
    authorName,
    preview: typeof content === 'string' ? content.replace(/\s+/g, ' ').trim().slice(0, 140) : undefined,
    manifestIds: ids,
    chunkRefs: [],
    source: input.source,
    blockedNode: input.source === 'block' ? input.blockedNode : undefined,
    unsupportedAt: Date.now(),
  };
  // Apply to memory first so the post vanishes this frame.
  entries.set(entry.postId, entry);
  rebuildIndexes();
  writeMirror();
  emit();
  entry.chunkRefs = await chunkRefsFor(ids);
  if (entries.get(entry.postId) === entry) {
    rebuildIndexes();
    writeMirror();
  }
  await dbWrite((s) => s.put(entry));
  try { chan()?.postMessage({ changed: entry.postId }); } catch { /* noop */ }
  return entry;
}

/**
 * Stop supporting a Brain placement that pins no post (a bare wall or
 * item): this node stops drawing it (no mesh, collider or billboard) and
 * stops passing it on in lobby backfill. Resume with `resumeSupportingPost`
 * on the returned entry's `postId`.
 */
export async function stopSupportingPlacement(input: {
  placementId: string;
  ownerId?: string;
  label?: string;
}): Promise<UnsupportedPostEntry | null> {
  if (!input.placementId) return null;
  const entry: UnsupportedPostEntry = {
    postId: `${PLACEMENT_PREFIX}${input.placementId}`,
    kind: 'placement',
    placementId: input.placementId,
    author: input.ownerId,
    preview: input.label ?? 'Brain wall',
    manifestIds: [],
    chunkRefs: [],
    source: 'brain',
    unsupportedAt: Date.now(),
  };
  entries.set(entry.postId, entry);
  rebuildIndexes();
  writeMirror();
  emit();
  await dbWrite((s) => s.put(entry));
  try { chan()?.postMessage({ changed: entry.postId }); } catch { /* noop */ }
  return entry;
}

/** Resume support: the post (or placement) shows, seeds and relays again. */
export async function resumeSupportingPost(postId: string): Promise<void> {
  if (!entries.delete(postId)) return;
  rebuildIndexes();
  writeMirror();
  emit();
  await dbWrite((s) => s.delete(postId));
  try { chan()?.postMessage({ changed: postId }); } catch { /* noop */ }
}

export function subscribeUnsupportedPosts(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** React hook — the current list, newest first. */
export function useUnsupportedPosts(): UnsupportedPostEntry[] {
  return useSyncExternalStore(subscribeUnsupportedPosts, listUnsupportedPosts, listUnsupportedPosts);
}

/** React hook — whether one post is unsupported here. */
export function useIsPostUnsupported(postId: string | null | undefined): boolean {
  const get = () => isPostUnsupported(postId);
  return useSyncExternalStore(subscribeUnsupportedPosts, get, get);
}

export function _resetUnsupportedPostsForTest(): void {
  entries = new Map();
  rebuildIndexes();
  listeners.clear();
  hydrated = null;
  try { localStorage.removeItem(MIRROR_KEY); } catch { /* noop */ }
}
