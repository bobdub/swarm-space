/**
 * brainSubmissionsStore — public "Submit a Brain" registry.
 *
 * Mirrors labProjectBridge patterns:
 *   • IndexedDB `swarm-brain-submissions` v1, store `submissions`.
 *   • BroadcastChannel `swarm:brain:submissions` cross-tab gossip.
 *   • Local-protect: peer never overwrites a local-origin record.
 *   • Non-destructive `onversionchange` upgrade lifecycle.
 *
 * A submission represents a project Brain that its creator has chosen to
 * publish on the Remix → Brains gallery for others to remix / join / like.
 */

const DB_NAME = 'swarm-brain-submissions';
const STORE = 'submissions';
const DB_VERSION = 1;
const CHANNEL_NAME = 'swarm:brain:submissions';

export interface BrainSubmission {
  id: string;            // `brain:<projectId>:<actorId>`
  projectId: string;
  projectName: string;
  projectDescription?: string;
  actorId: string;
  actorHandle?: string;
  createdAt: number;
  likes: number;
  likedByMe?: boolean;
  _origin: 'local' | 'peer';
}

type Listener = (records: BrainSubmission[]) => void;
const listeners = new Set<Listener>();
const records = new Map<string, BrainSubmission>();
let hydrated = false;
let channel: BroadcastChannel | null = null;
let gossipBridge: ((rec: BrainSubmission) => void) | null = null;

function chan(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try { channel = new BroadcastChannel(CHANNEL_NAME); } catch { channel = null; }
  if (channel) {
    channel.onmessage = (ev) => {
      const rec = ev?.data as BrainSubmission | undefined;
      if (!rec || !rec.id) return;
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

async function dbPut(rec: BrainSubmission): Promise<void> {
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

async function dbDelete(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  try { db.close(); } catch { /* noop */ }
}

async function dbAll(): Promise<BrainSubmission[]> {
  const db = await openDb();
  if (!db) return [];
  const out = await new Promise<BrainSubmission[]>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as BrainSubmission[]) ?? []);
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
    const snap = listBrainSubmissions();
    for (const fn of listeners) {
      try { fn(snap); } catch (err) { console.warn('[brainSubmissions] listener error', err); }
    }
  }, 200) as unknown as number;
}

function ingest(rec: BrainSubmission): void {
  const existing = records.get(rec.id);
  if (existing && existing._origin === 'local' && rec._origin === 'peer') return;
  records.set(rec.id, rec);
  scheduleNotify();
}

export interface SubmitBrainInput {
  projectId: string;
  projectName: string;
  projectDescription?: string;
  actorId: string;
  actorHandle?: string;
}

export async function submitBrain(input: SubmitBrainInput): Promise<BrainSubmission> {
  const id = `brain:${input.projectId}:${input.actorId}`;
  const existing = records.get(id);
  const rec: BrainSubmission = {
    id,
    projectId: input.projectId,
    projectName: input.projectName,
    projectDescription: input.projectDescription,
    actorId: input.actorId,
    actorHandle: input.actorHandle,
    createdAt: existing?.createdAt ?? Date.now(),
    likes: existing?.likes ?? 0,
    likedByMe: existing?.likedByMe,
    _origin: 'local',
  };
  records.set(id, rec);
  await dbPut(rec);
  try { chan()?.postMessage(rec); } catch { /* noop */ }
  try { gossipBridge?.(rec); } catch { /* noop */ }
  scheduleNotify();
  return rec;
}

export async function removeBrainSubmission(id: string, actorId: string): Promise<boolean> {
  const existing = records.get(id);
  if (!existing) return false;
  if (existing.actorId !== actorId) return false; // creator-only
  records.delete(id);
  await dbDelete(id);
  scheduleNotify();
  return true;
}

export async function likeBrainSubmission(id: string): Promise<void> {
  const existing = records.get(id);
  if (!existing) return;
  const next: BrainSubmission = {
    ...existing,
    likes: (existing.likes ?? 0) + (existing.likedByMe ? -1 : 1),
    likedByMe: !existing.likedByMe,
    _origin: existing._origin,
  };
  records.set(id, next);
  await dbPut(next);
  try { chan()?.postMessage(next); } catch { /* noop */ }
  scheduleNotify();
}

export function listBrainSubmissions(): BrainSubmission[] {
  return [...records.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function subscribeBrainSubmissions(fn: Listener): () => void {
  listeners.add(fn);
  try { fn(listBrainSubmissions()); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}

export async function hydrateBrainSubmissions(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  chan();
  const all = await dbAll();
  for (const r of all) ingest({ ...r, _origin: 'local' });
}

export function attachBrainSubmissionGossip(
  bridge: (rec: BrainSubmission) => void,
): () => void {
  gossipBridge = bridge;
  return () => { if (gossipBridge === bridge) gossipBridge = null; };
}

export function acceptPeerBrainSubmission(rec: Omit<BrainSubmission, '_origin'>): void {
  ingest({ ...rec, _origin: 'peer' });
}

export function _resetBrainSubmissionsForTest(): void {
  records.clear();
  listeners.clear();
  hydrated = false;
  if (channel) { try { channel.close(); } catch { /* noop */ } channel = null; }
  gossipBridge = null;
}