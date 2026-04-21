/**
 * fieldPersistence — IndexedDB store for the UQRC field snapshot.
 * Uses its own tiny database so it cannot collide with the app's main
 * upgrade lifecycle. Non-destructive on VersionError.
 */

import type { FieldSnapshot } from './field';

const DB_NAME = 'uqrc-field';
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

export async function saveFieldSnapshot(snap: FieldSnapshot): Promise<void> {
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

export async function loadFieldSnapshot(): Promise<FieldSnapshot | null> {
  const db = await openDb();
  if (!db) return null;
  const result = await new Promise<FieldSnapshot | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as FieldSnapshot) ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  try { db.close(); } catch { /* ignore */ }
  return result;
}

export async function clearFieldSnapshot(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
  try { db.close(); } catch { /* ignore */ }
}