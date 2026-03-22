/**
 * Adaptive Streaming Chunker
 * For files >100MB, processes encryption in stress-aware batches
 * that yield to the event loop to prevent UI freezing.
 */

import { put } from '@/lib/store';
import { signManifest } from '@/lib/p2p/replication';
import { getStressMonitor } from './stressMonitor';
import type { Chunk, Manifest } from '@/lib/fileEncryption';

const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024; // 100MB
const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB
const LARGE_FILE_CHUNK_SIZE = 256 * 1024; // 256KB for large files (fewer chunks)

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const len = bytes.length;
  let binary = '';
  for (let i = 0; i < len; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, len)));
  }
  return btoa(binary);
}

function arrayBufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}

/** Yield to the main thread */
function yieldToMain(ms: number = 0): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface AdaptiveChunkProgress {
  /** Bytes processed so far */
  bytesProcessed: number;
  /** Total file bytes */
  totalBytes: number;
  /** Percentage 0-100 */
  percent: number;
  /** Current stress level */
  stressLevel: string;
  /** Current batch concurrency */
  concurrency: number;
  /** Chunks completed */
  chunksCompleted: number;
  /** Total chunks */
  totalChunks: number;
}

export interface AdaptiveChunkerOptions {
  chunkSize?: number;
  onProgress?: (p: AdaptiveChunkProgress) => void;
}

/**
 * Determines if a file should use adaptive chunking.
 */
export function shouldUseAdaptiveChunking(fileSize: number): boolean {
  return fileSize >= LARGE_FILE_THRESHOLD;
}

/**
 * Encrypt a large file using stress-aware adaptive batching.
 * Reads the file in slices using File.slice() to avoid loading
 * the entire file into memory at once.
 */
export async function adaptiveChunkAndEncrypt(
  file: File,
  fileKey: CryptoKey,
  options: AdaptiveChunkerOptions = {}
): Promise<Manifest> {
  const monitor = getStressMonitor();
  const chunkSize = options.chunkSize ?? LARGE_FILE_CHUNK_SIZE;
  const totalSize = file.size;
  const totalChunks = Math.ceil(totalSize / chunkSize);
  const chunkRefs: string[] = [];

  let bytesProcessed = 0;
  let seq = 0;

  // Process in adaptive batches
  while (bytesProcessed < totalSize) {
    const concurrency = monitor.getRecommendedConcurrency();
    const delay = monitor.getRecommendedDelay();

    // Build a batch of chunk promises
    const batchPromises: Promise<string>[] = [];
    const batchCount = Math.min(concurrency, totalChunks - seq);

    for (let b = 0; b < batchCount && bytesProcessed < totalSize; b++) {
      const start = bytesProcessed;
      const end = Math.min(start + chunkSize, totalSize);
      const currentSeq = seq;

      // Use File.slice() — does NOT load entire file into memory
      const sliceBlob = file.slice(start, end);

      const p = (async () => {
        const sliceBuffer = await sliceBlob.arrayBuffer();

        // Encrypt
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          fileKey,
          sliceBuffer
        );

        const cipherB64 = arrayBufferToBase64(cipher);

        // Hash
        const refHash = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(cipherB64 + currentSeq)
        );
        const ref = `chunk-${arrayBufferToHex(refHash)}`;

        const chunkObj: Chunk = {
          ref,
          seq: currentSeq,
          total: totalChunks,
          size: end - start,
          iv: arrayBufferToBase64(iv.buffer),
          cipher: cipherB64,
          meta: {
            mime: file.type,
            originalName: file.name,
          },
        };

        await put('chunks', chunkObj);
        return ref;
      })();

      batchPromises.push(p);
      bytesProcessed = end;
      seq++;
    }

    // Await the batch
    const refs = await Promise.all(batchPromises);
    chunkRefs.push(...refs);

    // Report progress
    options.onProgress?.({
      bytesProcessed,
      totalBytes: totalSize,
      percent: Math.round((bytesProcessed / totalSize) * 100),
      stressLevel: monitor.getSnapshot().level,
      concurrency: monitor.getRecommendedConcurrency(),
      chunksCompleted: chunkRefs.length,
      totalChunks,
    });

    // Yield to main thread between batches
    if (delay > 0) {
      await yieldToMain(delay);
    } else {
      // Even at low stress, yield briefly every batch to keep UI responsive
      await yieldToMain(0);
    }
  }

  // Export key
  const rawKey = await crypto.subtle.exportKey('raw', fileKey);
  const exportedKey = arrayBufferToBase64(rawKey);

  // Build manifest
  const manifest = {
    fileId: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chunks: chunkRefs,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    originalName: file.name,
    fileKey: exportedKey,
    createdAt: new Date().toISOString(),
  };

  const signed = await signManifest(manifest as import('@/lib/store').Manifest);
  await put('manifests', signed);

  console.log(
    `[AdaptiveChunker] Encrypted ${file.name} (${(totalSize / 1024 / 1024).toFixed(1)}MB) → ${chunkRefs.length} chunks`
  );

  return signed as Manifest;
}
