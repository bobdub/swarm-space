/**
 * brainPersistence — IndexedDB store for the Brain physics field snapshot.
 * Mirrors uqrc/fieldPersistence.ts; uses a separate tiny DB so it cannot
 * collide with the app's main upgrade lifecycle.
 */

import type { Field3DSnapshot } from '../uqrc/field3D';

const DB_NAME = 'brain-field';
const DB_VERSION = 1;
const STORE = 'snapshot';
const DEFAULT_KEY = 'current';

/**
 * Brain physics protocol version. Bumped whenever the on-shell collision
 * model, surface clamp, or coordinate frame changes in a way that would
 * make older peers report positions our integrator cannot trust.
 *
 * Embedded in presence broadcasts as `pv`. Remote avatars whose `pv` is
 * older than ours are pinned to the structural shell so they cannot
 * appear to fall through Earth (see RemoteAvatarBody.tsx).
 */
export const BRAIN_PHYSICS_VERSION = 3;

/** Compose the IndexedDB key for a given universe namespace. */
function fieldKey(ns?: string): string {
  if (!ns || ns === 'global') return DEFAULT_KEY;
  return `current:${ns}`;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { try { db.close(); } catch { /* ignore */ } };
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

export async function saveBrainField(snap: Field3DSnapshot, ns?: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(snap, fieldKey(ns));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
  try { db.close(); } catch { /* ignore */ }
}

export async function loadBrainField(ns?: string): Promise<Field3DSnapshot | null> {
  const db = await openDb();
  if (!db) return null;
  const result = await new Promise<Field3DSnapshot | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(fieldKey(ns));
      req.onsuccess = () => resolve((req.result as Field3DSnapshot) ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  try { db.close(); } catch { /* ignore */ }
  return result;
}

// ── Brain build pieces & portals ───────────────────────────────────

const BUILD_KEY = 'brain-build-pieces-v1';
const PORTAL_KEY = 'brain-portals-v1';

export interface BrainPiece {
  id: string;
  kind: 'wall' | 'pillar' | 'beacon';
  pos: [number, number, number];
  placedBy: string;
  placedAt: number;
}

export interface BrainPortal {
  id: string;
  ownerId: string;
  projectId: string;
  projectName: string;
  /** World-space position at drop time (legacy / fallback). */
  pos: [number, number, number];
  /** Position in Earth-local (co-rotating) coords. New portals always set
   *  this so they travel with the spinning planet like the player does. */
  localPos?: [number, number, number];
  placedAt: number;
}

function piecesKey(ns?: string): string {
  return !ns || ns === 'global' ? BUILD_KEY : `${BUILD_KEY}:${ns}`;
}
function portalsKey(ns?: string): string {
  return !ns || ns === 'global' ? PORTAL_KEY : `${PORTAL_KEY}:${ns}`;
}

export function loadPieces(ns?: string): BrainPiece[] {
  try {
    const raw = localStorage.getItem(piecesKey(ns));
    return raw ? (JSON.parse(raw) as BrainPiece[]) : [];
  } catch { return []; }
}

export function savePieces(pieces: BrainPiece[], ns?: string): void {
  try { localStorage.setItem(piecesKey(ns), JSON.stringify(pieces)); } catch { /* ignore */ }
}

export function loadPortals(ns?: string): BrainPortal[] {
  try {
    const raw = localStorage.getItem(portalsKey(ns));
    return raw ? (JSON.parse(raw) as BrainPortal[]) : [];
  } catch { return []; }
}

export function savePortals(portals: BrainPortal[], ns?: string): void {
  try { localStorage.setItem(portalsKey(ns), JSON.stringify(portals)); } catch { /* ignore */ }
}