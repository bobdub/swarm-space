/**
 * MediaCoin Packager
 *
 * Packages encrypted media chunks + manifest metadata into a SwarmCoin,
 * turning the coin into a self-contained, verifiable media container.
 */

import type { SwarmCoin, MediaPiece } from './types';
import { sha256 } from '../crypto';
import { get, type Chunk, type Manifest } from '../store';

export interface PackageMediaOptions {
  coinId: string;
  ownerId: string;
  manifest: Manifest;
}

/**
 * Build MediaPiece entries from a manifest's chunk list by reading local chunks.
 */
async function buildMediaPieces(manifest: Manifest): Promise<MediaPiece[]> {
  const pieces: MediaPiece[] = [];
  const chunkRefs = Array.isArray(manifest.chunks) ? manifest.chunks : [];

  for (let seq = 0; seq < chunkRefs.length; seq++) {
    const ref = chunkRefs[seq];
    const chunk = await get<Chunk>('chunks', ref);

    pieces.push({
      hash: ref,
      seq,
      iv: chunk?.iv ?? '',
      size: chunk ? (chunk.cipher?.length ?? 0) : 0,
    });
  }

  return pieces;
}

/**
 * Package a manifest's media into a SwarmCoin.
 *
 * The coin gains `mediaPieces` (chunk references) and `manifestSnapshot`
 * (embedded manifest metadata) so it becomes a complete media container.
 *
 * Returns null if validation fails (e.g. no chunks).
 */
export async function packageMediaCoin(
  coin: SwarmCoin,
  options: PackageMediaOptions
): Promise<SwarmCoin | null> {
  const { manifest } = options;

  if (!manifest || !Array.isArray(manifest.chunks) || manifest.chunks.length === 0) {
    console.warn('[MediaCoinPackager] Cannot package coin — manifest has no chunks');
    return null;
  }

  const pieces = await buildMediaPieces(manifest);

  // Validate all pieces have hashes
  const allValid = pieces.every((p) => p.hash.length > 0);
  if (!allValid) {
    console.warn('[MediaCoinPackager] Some pieces missing hashes — packaging incomplete');
    return null;
  }

  const packaged: SwarmCoin = {
    ...coin,
    mediaPieces: pieces,
    manifestSnapshot: {
      mime: manifest.mime ?? 'application/octet-stream',
      fileKey: (manifest as any).fileKeyRaw ?? manifest.fileKey ?? '',
      originalName: manifest.originalName ?? 'unknown',
      totalSize: typeof manifest.size === 'number' ? manifest.size : 0,
      chunkCount: pieces.length,
      manifestId: manifest.fileId,
    },
  };

  console.log(
    `[MediaCoinPackager] Packaged coin ${coin.coinId} with ${pieces.length} media pieces (${manifest.mime})`
  );

  return packaged;
}

/**
 * Validate that a media coin has all pieces present locally.
 */
export async function validateMediaCoinCompleteness(coin: SwarmCoin): Promise<{
  complete: boolean;
  totalPieces: number;
  localPieces: number;
  missingHashes: string[];
}> {
  const pieces = coin.mediaPieces ?? [];
  const missingHashes: string[] = [];

  for (const piece of pieces) {
    const chunk = await get<Chunk>('chunks', piece.hash);
    if (!chunk) {
      missingHashes.push(piece.hash);
    }
  }

  return {
    complete: missingHashes.length === 0,
    totalPieces: pieces.length,
    localPieces: pieces.length - missingHashes.length,
    missingHashes,
  };
}
