/**
 * lazyWithRetry — wraps React.lazy() with one retry then a hard reload.
 *
 * Production deploys publish a new index.html plus new hashed chunk
 * filenames (e.g. `prefabHouseCatalog-C2Fkdxug.js`). A tab opened before
 * the deploy still holds the old index.html and tries to fetch chunks
 * that no longer exist, surfacing as:
 *
 *   TypeError: error loading dynamically imported module: .../assets/<name>-<hash>.js
 *
 * This helper retries the import once (handles transient CDN misses),
 * then triggers a single page reload using a sessionStorage flag so we
 * never reload-loop. After reload the browser fetches the new
 * index.html and the new chunk hashes.
 */
import { lazy, type ComponentType } from 'react';

const RELOAD_FLAG = 'lovable:chunk-reload';
const RELOAD_COOLDOWN_MS = 10_000;

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /dynamically imported module|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg);
}

function shouldReload(): boolean {
  try {
    if (typeof sessionStorage === 'undefined') return true;
    const prev = sessionStorage.getItem(RELOAD_FLAG);
    const now = Date.now();
    if (prev) {
      const ts = Number(prev);
      if (Number.isFinite(ts) && now - ts < RELOAD_COOLDOWN_MS) return false;
    }
    sessionStorage.setItem(RELOAD_FLAG, String(now));
    return true;
  } catch { return true; }
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      if (!isChunkLoadError(err)) throw err;
      await new Promise((r) => setTimeout(r, 350));
      try {
        return await factory();
      } catch (err2) {
        if (!isChunkLoadError(err2)) throw err2;
        if (shouldReload() && typeof window !== 'undefined') {
          try {
            // Cache-bust index.html so the browser fetches the new chunk map.
            const url = new URL(window.location.href);
            url.searchParams.set('_r', String(Date.now()));
            window.location.replace(url.toString());
            return await new Promise<never>(() => { /* never resolves */ });
          } catch {
            try { window.location.reload(); } catch { /* noop */ }
          }
        }
        throw err2;
      }
    }
  });
}

/** Call once on successful boot to clear the reload guard. */
export function clearChunkReloadFlag(): void {
  try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* noop */ }
}