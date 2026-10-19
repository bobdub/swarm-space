/**
 * Infinity Memory — passive piggyback store.
 *
 * Collects text that ALREADY reached this device (local posts, posts synced
 * from peers, comments, Brain chat). It never initiates mesh traffic.
 * Writes are queued and flushed in idle time so connection and render paths
 * are untouched. Own IndexedDB database; never touches user data stores.
 */

export type MemoryKind = 'post' | 'comment' | 'chat';

export interface MemoryPiece {
  id: string;
  kind: MemoryKind;
  text: string;
  ts: number;
  authorHash: string;
}

export const MEMORY_MAX_PIECES = 2000;
export const MEMORY_MAX_TEXT = 1000;
const DB_NAME = 'infinity-memory';
const STORE = 'pieces';
const FLUSH_DELAY_MS = 5000;

/** Short, non-reversible-at-a-glance author tag (FNV-1a). */
export function hashAuthor(author: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < author.length; i++) {
    h ^= author.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function toPiece(input: { id: string; kind: MemoryKind; text: string; author?: string; ts?: number }): MemoryPiece | null {
  const text = (input.text ?? '').trim();
  if (!input.id || text.length < 2) return null;
  return {
    id: input.id,
    kind: input.kind,
    text: text.slice(0, MEMORY_MAX_TEXT),
    ts: input.ts ?? Date.now(),
    authorHash: hashAuthor(input.author ?? 'anon'),
  };
}

/** Keep the newest `max` pieces; returns ids to evict. */
export function selectEvictions(pieces: Array<Pick<MemoryPiece, 'id' | 'ts'>>, max = MEMORY_MAX_PIECES): string[] {
  if (pieces.length <= max) return [];
  return [...pieces].sort((a, b) => a.ts - b.ts).slice(0, pieces.length - max).map((p) => p.id);
}

/** Private content (walled / paywalled / encrypted) never enters memory. */
export function isPrivatePost(post: Record<string, unknown>): boolean {
  return Boolean(
    post.walled || post.isWalled || post.paywall || post.paywalled || post.encrypted ||
    post.walledCoinId || post.unlockFee || post.visibility === 'private',
  );
}

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('ts', 'ts');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => { /* wait; never delete */ };
  });
  return dbPromise;
}

const queue = new Map<string, MemoryPiece>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const run = () => { void flushMemory(); };
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (ric) ric(run, { timeout: 10000 }); else run();
  }, FLUSH_DELAY_MS);
}

export function enqueueMemory(input: { id: string; kind: MemoryKind; text: string; author?: string; ts?: number }): void {
  try {
    if (typeof indexedDB === 'undefined') return;
    const piece = toPiece(input);
    if (!piece) return;
    queue.set(piece.id, piece);
    scheduleFlush();
  } catch { /* passive — never throw into callers */ }
}

export async function flushMemory(): Promise<void> {
  if (queue.size === 0) return;
  const batch = [...queue.values()];
  queue.clear();
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const p of batch) store.put(p);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const all = await readAllKeys(db);
    const evict = selectEvictions(all);
    if (evict.length) {
      const tx = db.transaction(STORE, 'readwrite');
      for (const id of evict) tx.objectStore(STORE).delete(id);
    }
  } catch { /* best effort */ }
}

function readAllKeys(db: IDBDatabase): Promise<Array<{ id: string; ts: number }>> {
  return new Promise((resolve) => {
    const out: Array<{ id: string; ts: number }> = [];
    const req = db.transaction(STORE).objectStore(STORE).index('ts').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      const v = c.value as MemoryPiece;
      out.push({ id: v.id, ts: v.ts });
      c.continue();
    };
    req.onerror = () => resolve(out);
  });
}

/** Read newest pieces (for Phase 2 learning). */
export async function readMemory(limit = 500): Promise<MemoryPiece[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const out: MemoryPiece[] = [];
      const req = db.transaction(STORE).objectStore(STORE).index('ts').openCursor(null, 'prev');
      req.onsuccess = () => {
        const c = req.result;
        if (!c || out.length >= limit) return resolve(out);
        out.push(c.value as MemoryPiece);
        c.continue();
      };
      req.onerror = () => resolve(out);
    });
  } catch {
    return [];
  }
}
