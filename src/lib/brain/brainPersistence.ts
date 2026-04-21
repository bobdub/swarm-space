/**
 * brainPersistence — IndexedDB store for the Brain physics field snapshot.
 * Mirrors uqrc/fieldPersistence.ts; uses a separate tiny DB so it cannot
 * collide with the app's main upgrade lifecycle.
 */

import type { Field3DSnapshot } from '../uqrc/field3D';

const DB_NAME = 'brain-field';
const DB_VERSION = 1;
const STORE = 'snapshot';
const KEY = 'current';

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

export async function saveBrainField(snap: Field3DSnapshot): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(snap, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
  try { db.close(); } catch { /* ignore */ }
}

export async function loadBrainField(): Promise<Field3DSnapshot | null> {
  const db = await openDb();
  if (!db) return null;
  const result = await new Promise<Field3DSnapshot | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
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
  pos: [number, number, number];
  placedAt: number;
}

export function loadPieces(): BrainPiece[] {
  try {
    const raw = localStorage.getItem(BUILD_KEY);
    return raw ? (JSON.parse(raw) as BrainPiece[]) : [];
  } catch { return []; }
}

export function savePieces(pieces: BrainPiece[]): void {
  try { localStorage.setItem(BUILD_KEY, JSON.stringify(pieces)); } catch { /* ignore */ }
}

export function loadPortals(): BrainPortal[] {
  try {
    const raw = localStorage.getItem(PORTAL_KEY);
    return raw ? (JSON.parse(raw) as BrainPortal[]) : [];
  } catch { return []; }
}

export function savePortals(portals: BrainPortal[]): void {
  try { localStorage.setItem(PORTAL_KEY, JSON.stringify(portals)); } catch { /* ignore */ }
}