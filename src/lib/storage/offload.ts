/**
 * Offload — download a portable copy of local content, then clear only the
 * bulky media records from the browser.
 *
 * Safety invariants:
 *  - Only stores classified as `bulk`/`replica` in STORE_TIER_MAP are ever
 *    cleared. Identity, keys, wallet, chain and posts are never touched.
 *  - Clearing is gated on a successful export in the same visit.
 */

import { getAll, remove, openDB } from '@/lib/store';
import type { Manifest, Chunk } from '@/lib/store';
import { STORE_TIER_MAP } from './providers/types';

/**
 * Identity keys are security state, not storage state: every account needs
 * them, so no cleanup or archive path may ever remove them.
 */
export const NEVER_CLEAR_STORES = ['users', 'meta', 'blockchain', 'tokenBalances', 'swarmCoins'] as const;

/** Stores the clear step is allowed to delete from. */
export const CLEARABLE_STORES = Object.entries(STORE_TIER_MAP)
  .filter(([, tier]) => tier === 'bulk' || tier === 'replica')
  .map(([name]) => name)
  .filter((name) => !(NEVER_CLEAR_STORES as readonly string[]).includes(name));

export interface UsageBreakdown {
  /** Media pieces + file records (clearable). */
  mediaBytes: number;
  mediaCount: number;
  /** Posts and comments (kept). */
  postBytes: number;
  postCount: number;
  /** Everything else — identity, keys, wallet, chain (kept). */
  accountBytes: number;
}

function roughSize(rows: unknown[]): number {
  let total = 0;
  for (const row of rows) {
    try { total += JSON.stringify(row).length; } catch { /* skip */ }
  }
  return total;
}

async function safeGetAll<T>(store: string, available: Set<string>): Promise<T[]> {
  if (!available.has(store)) return [];
  try { return await getAll<T>(store); } catch { return []; }
}

export async function estimateLocalUsage(): Promise<UsageBreakdown> {
  const db = await openDB();
  const available = new Set<string>(Array.from(db.objectStoreNames));

  let mediaBytes = 0;
  let mediaCount = 0;
  for (const store of CLEARABLE_STORES) {
    const rows = await safeGetAll<unknown>(store, available);
    mediaBytes += roughSize(rows);
    mediaCount += rows.length;
  }

  const posts = await safeGetAll<unknown>('posts', available);
  const comments = await safeGetAll<unknown>('comments', available);
  const postBytes = roughSize(posts) + roughSize(comments);

  let accountBytes = 0;
  for (const store of ['users', 'blockchain', 'tokenBalances', 'swarmCoins', 'meta']) {
    accountBytes += roughSize(await safeGetAll<unknown>(store, available));
  }

  return {
    mediaBytes,
    mediaCount,
    postBytes,
    postCount: posts.length,
    accountBytes,
  };
}

/** Stores removed for a scope: media always; posts/comments only on full export. */
export function clearableStoresFor(scope: ExportScope): string[] {
  const extra = scope === 'everything' ? ['posts', 'comments'] : [];
  return [...CLEARABLE_STORES, ...extra].filter((n) => !(NEVER_CLEAR_STORES as readonly string[]).includes(n));
}

export interface UserDataExport {
  version: 1;
  exportedAt: string;
  posts: unknown[];
  comments: unknown[];
  manifests: Manifest[];
  chunks: Chunk[];
}

export type ExportScope = 'media' | 'everything';

/** Build the download bundle. `media` = file records + pieces; `everything` adds posts and comments. */
export async function exportUserData(scope: ExportScope = 'everything'): Promise<Blob> {
  const db = await openDB();
  const available = new Set<string>(Array.from(db.objectStoreNames));
  const bundle: UserDataExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    posts: scope === 'everything' ? await safeGetAll<unknown>('posts', available) : [],
    comments: scope === 'everything' ? await safeGetAll<unknown>('comments', available) : [],
    manifests: await safeGetAll<Manifest>('manifests', available),
    chunks: await safeGetAll<Chunk>('chunks', available),
  };
  const json = JSON.stringify(bundle);
  if (typeof CompressionStream !== 'undefined') {
    const blob = new Blob([json], { type: 'application/json' });
    const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).blob();
  }
  return new Blob([json], { type: 'application/json' });
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface DownloadReceipt { filename: string; size: number; sha256: string }

/** Download the bundle and return a receipt used to verify the saved file later. */
export async function downloadUserData(scope: ExportScope = 'everything'): Promise<DownloadReceipt> {
  const blob = await exportUserData(scope);
  const sha256 = await sha256Hex(blob);
  const filename = `swarm-${scope}-${Date.now()}.json.gz`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { filename, size: blob.size, sha256 };
}

/** True only if the file the user picked is byte-identical to what was downloaded. */
export async function verifyDownloadedFile(file: Blob, receipt: DownloadReceipt): Promise<boolean> {
  if (file.size !== receipt.size) return false;
  return (await sha256Hex(file)) === receipt.sha256;
}

export interface ClearResult {
  removed: number;
  freedBytes: number;
}

/**
 * Delete media pieces / file records / replicas from the browser.
 * Never touches critical stores.
 */
export async function clearBulkLocal(
  onProgress?: (done: number, total: number) => void,
  scope: ExportScope = 'media',
): Promise<ClearResult> {
  const db = await openDB();
  const available = new Set<string>(Array.from(db.objectStoreNames));

  const targets: { store: string; key: string; bytes: number }[] = [];
  for (const store of clearableStoresFor(scope)) {
    const rows = await safeGetAll<Record<string, unknown>>(store, available);
    for (const row of rows) {
      const key =
        (row?.ref as string) ??
        (row?.fileId as string) ??
        (row?.id as string) ??
        (row?.hash as string);
      if (!key) continue;
      let bytes = 0;
      try { bytes = JSON.stringify(row).length; } catch { /* ignore */ }
      targets.push({ store, key, bytes });
    }
  }

  let removed = 0;
  let freedBytes = 0;
  for (const target of targets) {
    try {
      await remove(target.store, target.key);
      removed++;
      freedBytes += target.bytes;
    } catch { /* skip individual failures */ }
    if (removed % 25 === 0) onProgress?.(removed, targets.length);
  }
  onProgress?.(removed, targets.length);
  return { removed, freedBytes };
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
