/**
 * UI-facing helper: make sure every chunk referenced by a manifest is present
 * in local IndexedDB, requesting missing pieces from peers over the mesh.
 *
 * Fixes the download-of-shared-files bug where the decryptor threw the
 * moment a chunk was absent locally, with no retry / no fetch attempt.
 */
import { get } from '@/lib/store';
import { tryGetP2PManager } from './manager';
import type { Manifest } from '@/lib/fileEncryption';

export interface EnsureChunksResult {
  /** true when every chunk in the manifest is now present locally */
  ok: boolean;
  /** chunk refs still missing after the sweep */
  missing: string[];
  /** true when no P2P manager was available to fetch from */
  offline: boolean;
}

async function listMissing(manifest: Manifest): Promise<string[]> {
  const missing: string[] = [];
  for (const ref of manifest.chunks) {
    const chunk = await get('chunks', ref);
    if (!chunk) missing.push(ref);
  }
  return missing;
}

/**
 * Ensure every chunk for `manifest` is in local storage. Non-throwing:
 * returns a report the UI can act on.
 */
export async function ensureManifestChunks(manifest: Manifest): Promise<EnsureChunksResult> {
  const initialMissing = await listMissing(manifest);
  if (initialMissing.length === 0) {
    return { ok: true, missing: [], offline: false };
  }

  const manager = tryGetP2PManager();
  if (!manager) {
    return { ok: false, missing: initialMissing, offline: true };
  }

  try {
    // ensureChunksForManifest walks candidate peers and populates IndexedDB
    // for anything not already local. Wrap in a soft overall timeout so a
    // dead peer can't hang the UI indefinitely.
    const OVERALL_TIMEOUT_MS = Math.max(15_000, initialMissing.length * 8_000);
    await Promise.race([
      manager.ensureChunksForManifest(manifest as never),
      new Promise<void>((resolve) => setTimeout(resolve, OVERALL_TIMEOUT_MS)),
    ]);
  } catch (err) {
    console.warn('[chunkFetch] ensureChunksForManifest error', err);
  }

  const stillMissing = await listMissing(manifest);
  return {
    ok: stillMissing.length === 0,
    missing: stillMissing,
    offline: false,
  };
}