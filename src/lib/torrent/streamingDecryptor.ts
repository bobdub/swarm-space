/**
 * Streaming Media Decryptor
 * Progressively decrypts chunks and feeds them to a MediaSource
 * so audio/video can begin playing before the entire file is decrypted.
 * Falls back to full-blob decryption for non-streamable types.
 */

import { get } from '@/lib/store';
import { importKeyRaw, type Chunk, type Manifest } from '@/lib/fileEncryption';
import { getStressMonitor } from './stressMonitor';

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

function yieldToMain(ms: number = 0): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** MIME types that MediaSource generally supports */
const STREAMABLE_MIMES: Record<string, string> = {
  'video/mp4': 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
  'video/webm': 'video/webm; codecs="vp8, vorbis"',
  'audio/mp4': 'audio/mp4; codecs="mp4a.40.2"',
  'audio/webm': 'audio/webm; codecs="vorbis"',
  'audio/mpeg': 'audio/mpeg',
};

function getMediaSourceType(mime: string): string | null {
  if (typeof MediaSource === 'undefined') return null;
  const codec = STREAMABLE_MIMES[mime];
  if (!codec) return null;
  try {
    return MediaSource.isTypeSupported(codec) ? codec : null;
  } catch {
    return null;
  }
}

export interface StreamDecryptProgress {
  chunksDecrypted: number;
  totalChunks: number;
  percent: number;
  stressLevel: string;
}

/**
 * Check if a manifest's media type supports streaming playback
 */
export function isStreamable(manifest: Manifest): boolean {
  return getMediaSourceType(manifest.mime) !== null;
}

/**
 * Create a streaming media source URL that progressively decrypts chunks.
 * Returns a MediaSource object URL that can be set as `src` on <audio>/<video>.
 * The `onProgress` callback fires as chunks decrypt.
 * 
 * The returned `cancel` function stops decryption.
 */
export function createStreamingSource(
  manifest: Manifest,
  onProgress?: (p: StreamDecryptProgress) => void,
  onError?: (err: Error) => void,
  onComplete?: () => void,
): { url: string; cancel: () => void } {
  const codecType = getMediaSourceType(manifest.mime);
  if (!codecType) {
    throw new Error(`Streaming not supported for ${manifest.mime}`);
  }

  const mediaSource = new MediaSource();
  const url = URL.createObjectURL(mediaSource);
  let cancelled = false;

  mediaSource.addEventListener('sourceopen', () => {
    void (async () => {
      let sourceBuffer: SourceBuffer;
      try {
        sourceBuffer = mediaSource.addSourceBuffer(codecType);
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      try {
        if (!manifest.fileKey) throw new Error('Missing file key');
        const fileKey = await importKeyRaw(manifest.fileKey);
        const monitor = getStressMonitor();

        for (let i = 0; i < manifest.chunks.length; i++) {
          if (cancelled) break;

          const ref = manifest.chunks[i];
          const chunk = await get('chunks', ref) as Chunk | undefined;
          if (!chunk) {
            // Chunk not yet synced — wait and retry up to 10 times
            let found = false;
            for (let retry = 0; retry < 10 && !cancelled; retry++) {
              await yieldToMain(1000);
              const retried = await get('chunks', ref) as Chunk | undefined;
              if (retried) {
                await appendDecryptedChunk(retried, fileKey, sourceBuffer);
                found = true;
                break;
              }
            }
            if (!found && !cancelled) {
              console.warn(`[StreamDecryptor] Chunk ${ref} unavailable, skipping`);
            }
          } else {
            await appendDecryptedChunk(chunk, fileKey, sourceBuffer);
          }

          onProgress?.({
            chunksDecrypted: i + 1,
            totalChunks: manifest.chunks.length,
            percent: Math.round(((i + 1) / manifest.chunks.length) * 100),
            stressLevel: monitor.getSnapshot().level,
          });

          // Adaptive delay
          const delay = monitor.getRecommendedDelay();
          if (delay > 0) await yieldToMain(delay);
        }

        // Wait for buffer to finish updating
        if (!cancelled && sourceBuffer.updating) {
          await new Promise<void>(resolve => {
            sourceBuffer.addEventListener('updateend', () => resolve(), { once: true });
          });
        }

        if (!cancelled && mediaSource.readyState === 'open') {
          try { mediaSource.endOfStream(); } catch {}
        }

        onComplete?.();
      } catch (err) {
        console.error('[StreamDecryptor] Error:', err);
        onError?.(err instanceof Error ? err : new Error(String(err)));
        try { mediaSource.endOfStream('decode'); } catch {}
      }
    })();
  });

  return {
    url,
    cancel: () => {
      cancelled = true;
      try { URL.revokeObjectURL(url); } catch {}
    },
  };
}

/** Decrypt a single chunk and append it to the SourceBuffer */
async function appendDecryptedChunk(
  chunk: Chunk,
  fileKey: CryptoKey,
  sourceBuffer: SourceBuffer,
): Promise<void> {
  const iv = new Uint8Array(base64ToArrayBuffer(chunk.iv));
  const cipherData = base64ToArrayBuffer(chunk.cipher);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    fileKey,
    cipherData,
  );

  // Wait for any pending update on the source buffer
  if (sourceBuffer.updating) {
    await new Promise<void>(resolve => {
      sourceBuffer.addEventListener('updateend', () => resolve(), { once: true });
    });
  }

  sourceBuffer.appendBuffer(decrypted);

  // Wait for append to complete
  if (sourceBuffer.updating) {
    await new Promise<void>(resolve => {
      sourceBuffer.addEventListener('updateend', () => resolve(), { once: true });
    });
  }
}

/**
 * Non-streaming progressive decryption with stress-aware batching.
 * For file types that don't support MediaSource (images, PDFs, WAV, OGG, GIF).
 * Returns a Blob URL.
 */
export async function progressiveDecryptToBlob(
  manifest: Manifest,
  onProgress?: (p: StreamDecryptProgress) => void,
): Promise<Blob> {
  if (!manifest.fileKey) throw new Error('Missing file key');
  const fileKey = await importKeyRaw(manifest.fileKey);
  const monitor = getStressMonitor();
  const decryptedParts: ArrayBuffer[] = [];

  for (let i = 0; i < manifest.chunks.length; i++) {
    const ref = manifest.chunks[i];
    const chunk = await get('chunks', ref) as Chunk | undefined;

    if (!chunk) {
      throw new Error(`Chunk ${ref} not found`);
    }

    const iv = new Uint8Array(base64ToArrayBuffer(chunk.iv));
    const cipherData = base64ToArrayBuffer(chunk.cipher);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      fileKey,
      cipherData,
    );

    decryptedParts.push(decrypted);

    onProgress?.({
      chunksDecrypted: i + 1,
      totalChunks: manifest.chunks.length,
      percent: Math.round(((i + 1) / manifest.chunks.length) * 100),
      stressLevel: monitor.getSnapshot().level,
    });

    // Yield adaptively based on stress
    const concurrency = monitor.getRecommendedConcurrency();
    if (i % concurrency === 0) {
      await yieldToMain(monitor.getRecommendedDelay());
    }
  }

  return new Blob(decryptedParts, { type: manifest.mime });
}
