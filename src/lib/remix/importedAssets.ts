/**
 * importedAssets — per-user flag of which minted asset prefab IDs the
 * user has "imported" into their Builder Bar from the Assets tab.
 *
 * Stored in localStorage (small key set); subscribers can react to
 * import/un-import events. The Builder Bar itself does not yet read
 * this filter — Phase 1 only powers the Assets tab gate visual state.
 */

const KEY = 'swarm-imported-assets';

type Listener = (snap: Set<string>) => void;
const listeners = new Set<Listener>();

function read(): Set<string> {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

function write(set: Set<string>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch { /* noop */ }
}

function notify(): void {
  const snap = listImportedAssets();
  for (const fn of listeners) {
    try { fn(snap); } catch { /* noop */ }
  }
}

export function listImportedAssets(): Set<string> {
  return read();
}

export function isAssetImported(id: string): boolean {
  return read().has(id);
}

export function importAsset(id: string): void {
  const set = read();
  if (set.has(id)) return;
  set.add(id);
  write(set);
  notify();
}

export function unimportAsset(id: string): void {
  const set = read();
  if (!set.delete(id)) return;
  write(set);
  notify();
}

export function subscribeImportedAssets(fn: Listener): () => void {
  listeners.add(fn);
  try { fn(read()); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}