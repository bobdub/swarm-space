/**
 * Archive Fallback
 * For browsers without File System Access API:
 * Export/import manifests + chunks as a single downloadable JSON bundle.
 * Not a live provider — manual export/import only.
 */

import { getAll } from '../../store';
import type { Manifest, Chunk } from '../../store';
import { getProviderForStore } from './index';

export interface ArchiveBundle {
  version: 1;
  exportedAt: string;
  manifests: Manifest[];
  chunks: Chunk[];
}

/**
 * Export all bulk data (manifests + chunks) to a downloadable JSON blob.
 */
export async function exportArchive(): Promise<Blob> {
  const manifests = await getAll<Manifest>('manifests');
  const chunks = await getAll<Chunk>('chunks');

  const bundle: ArchiveBundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    manifests,
    chunks,
  };

  const json = JSON.stringify(bundle);

  // Compress if CompressionStream is available
  if (typeof CompressionStream !== 'undefined') {
    const blob = new Blob([json], { type: 'application/json' });
    const cs = new CompressionStream('gzip');
    const stream = blob.stream().pipeThrough(cs);
    return new Response(stream).blob();
  }

  return new Blob([json], { type: 'application/json' });
}

/**
 * Import an archive bundle, storing data via the active provider for each tier.
 */
export async function importArchive(file: File): Promise<{ manifests: number; chunks: number }> {
  let text: string;

  // Try decompress if gzipped
  if (typeof DecompressionStream !== 'undefined' && file.type !== 'application/json') {
    try {
      const ds = new DecompressionStream('gzip');
      const stream = file.stream().pipeThrough(ds);
      text = await new Response(stream).text();
    } catch {
      text = await file.text();
    }
  } else {
    text = await file.text();
  }

  const bundle = JSON.parse(text) as ArchiveBundle;
  if (bundle.version !== 1) {
    throw new Error(`Unsupported archive version: ${bundle.version}`);
  }

  const manifestProvider = getProviderForStore('manifests');
  const chunkProvider = getProviderForStore('chunks');

  for (const manifest of bundle.manifests) {
    await manifestProvider.put('manifests', manifest.fileId, manifest);
  }

  for (const chunk of bundle.chunks) {
    await chunkProvider.put('chunks', chunk.ref, chunk);
  }

  return { manifests: bundle.manifests.length, chunks: bundle.chunks.length };
}

/**
 * Trigger a browser download of the archive.
 */
export async function downloadArchive(): Promise<void> {
  const blob = await exportArchive();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `flux-data-archive-${Date.now()}.json.gz`;
  a.click();
  URL.revokeObjectURL(url);
}
