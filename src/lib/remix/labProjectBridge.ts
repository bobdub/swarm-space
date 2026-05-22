/**
 * labProjectBridge — Phase 6 Remix Lab → Project submission.
 *
 * Mirrors `mintedPrefabsStore` patterns:
 *  • IndexedDB `swarm-lab-project-mints` v1 (project-scoped molecules).
 *  • `BroadcastChannel('swarm:lab:project-mints')` cross-tab gossip.
 *  • Local-protect: peer records cannot overwrite local-origin records.
 *  • Non-destructive `onversionchange` upgrade lifecycle.
 *  • Emits `lab.recipe` with `formula: submit:<projectId>:<molFormula>`
 *    so the shared field still feels the recipe (no business-logic
 *    rewrites elsewhere — coin/labour/forge stay as today).
 */
import type { Molecule } from './moleculeCatalog';
import { emitLabRecipe, mintMolecule } from './lab.bus';
import type { SizePreset } from './labMint';

const DB_NAME = 'swarm-lab-project-mints';
const STORE = 'submissions';
const DB_VERSION = 1;
const CHANNEL_NAME = 'swarm:lab:project-mints';
const ACTIVE_KEY = 'swarm-lab-active-project';

export interface ProjectMintRecord {
  id: string;            // `${projectId}:${molecule.id}:${createdAt}`
  projectId: string;
  moleculeId: string;
  moleculeName: string;
  formula: string;
  actorId: string;
  createdAt: number;
  _origin: 'local' | 'peer';
}

type Listener = (records: ProjectMintRecord[]) => void;
const listeners = new Set<Listener>();
const records = new Map<string, ProjectMintRecord>();
let hydrated = false;
let channel: BroadcastChannel | null = null;
let gossipBridge: ((rec: ProjectMintRecord) => void) | null = null;

function chan(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try { channel = new BroadcastChannel(CHANNEL_NAME); } catch { channel = null; }
  if (channel) {
    channel.onmessage = (ev) => {
      const rec = ev?.data as ProjectMintRecord | undefined;
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
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('projectId', 'projectId', { unique: false });
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

async function dbPut(rec: ProjectMintRecord): Promise<void> {
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

async function dbAll(): Promise<ProjectMintRecord[]> {
  const db = await openDb();
  if (!db) return [];
  const out = await new Promise<ProjectMintRecord[]>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as ProjectMintRecord[]) ?? []);
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
    const snap = listSubmissions();
    for (const fn of listeners) {
      try { fn(snap); } catch (err) { console.warn('[labProjectBridge] listener error', err); }
    }
  }, 250) as unknown as number;
}

function ingest(rec: ProjectMintRecord): void {
  const existing = records.get(rec.id);
  // Local-protect: peer never overwrites local-origin record.
  if (existing && existing._origin === 'local' && rec._origin === 'peer') return;
  records.set(rec.id, rec);
  scheduleNotify();
}

export async function hydrateProjectMints(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  chan();
  const all = await dbAll();
  for (const r of all) ingest({ ...r, _origin: 'local' });
}

export interface SubmitMoleculeInput {
  projectId: string;
  molecule: Molecule;
  actorId: string;
  sizePreset?: SizePreset;
}

export async function submitMoleculeToProject(
  input: SubmitMoleculeInput,
): Promise<ProjectMintRecord> {
  const createdAt = Date.now();
  const rec: ProjectMintRecord = {
    id: `${input.projectId}:${input.molecule.id}:${createdAt}`,
    projectId: input.projectId,
    moleculeId: input.molecule.id,
    moleculeName: input.molecule.name,
    formula: input.molecule.formula,
    actorId: input.actorId,
    createdAt,
    _origin: 'local',
  };
  records.set(rec.id, rec);
  await dbPut(rec);
  try { chan()?.postMessage(rec); } catch { /* noop */ }
  try { gossipBridge?.(rec); } catch (err) { console.warn('[labProjectBridge] gossip error', err); }
  // Submit also mints to the local Builder Bar (wallet), tagged with the
  // project so the Builder Bar Lab popover can filter by project.
  try {
    await mintMolecule({
      molecule: input.molecule,
      actorId: input.actorId,
      projectId: input.projectId,
      sizePreset: input.sizePreset,
    });
  } catch (err) {
    console.warn('[labProjectBridge] auto-mint failed', err);
  }
  // Field still feels the recipe via shared scaffold bus.
  emitLabRecipe({
    recipeId: rec.id,
    formula: `submit:${input.projectId}:${input.molecule.formula}`,
    ok: true,
  });
  scheduleNotify();
  return rec;
}

export function listSubmissions(): ProjectMintRecord[] {
  return [...records.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function listSubmissionsForProject(projectId: string): ProjectMintRecord[] {
  return listSubmissions().filter((r) => r.projectId === projectId);
}

export function subscribeProjectMints(fn: Listener): () => void {
  listeners.add(fn);
  try { fn(listSubmissions()); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}

export function attachProjectMintGossip(
  bridge: (rec: ProjectMintRecord) => void,
): () => void {
  gossipBridge = bridge;
  return () => { if (gossipBridge === bridge) gossipBridge = null; };
}

export function acceptPeerProjectMint(rec: Omit<ProjectMintRecord, '_origin'>): void {
  ingest({ ...rec, _origin: 'peer' });
}

// ─────────────────────────────────────────────────────────────────────────
//  Active-project selection (persisted in localStorage)
// ─────────────────────────────────────────────────────────────────────────

export function getActiveProjectId(): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_KEY) : null; }
  catch { return null; }
}

export function setActiveProjectId(id: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch { /* noop */ }
}

export function _resetProjectMintsForTest(): void {
  records.clear();
  listeners.clear();
  hydrated = false;
  if (channel) { try { channel.close(); } catch { /* noop */ } channel = null; }
  gossipBridge = null;
}