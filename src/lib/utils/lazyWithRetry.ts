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

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /dynamically imported module|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg);
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      if (!isChunkLoadError(err)) throw err;
      try {
        return await factory();
      } catch (err2) {
        if (!isChunkLoadError(err2)) throw err2;
        try {
          if (typeof sessionStorage !== 'undefined') {
            if (sessionStorage.getItem(RELOAD_FLAG)) throw err2;
            sessionStorage.setItem(RELOAD_FLAG, '1');
          }
          if (typeof window !== 'undefined') window.location.reload();
        } catch {
          /* fall through to rethrow */
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