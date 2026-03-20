/**
 * Mesh Backup Distribution & Retrieval
 *
 * Handles broadcasting backup chunks to connected mesh peers
 * and querying peers for backup chunks during recovery.
 *
 * Protocol messages:
 *  - BACKUP_STORE: peer receives a tagged chunk to hold
 *  - BACKUP_QUERY: peer is asked "do you have chunk with tag X?"
 *  - BACKUP_RESPONSE: peer replies with the chunk data (or null)
 */

import type { BackupChunk, BackupManifest } from "./passphraseBackup";

// ── Message Types ──────────────────────────────────────────────────────
export const BACKUP_MSG = {
  STORE_CHUNK: "backup:store-chunk",
  STORE_MANIFEST: "backup:store-manifest",
  QUERY_MANIFEST: "backup:query-manifest",
  QUERY_CHUNK: "backup:query-chunk",
  RESPONSE_MANIFEST: "backup:response-manifest",
  RESPONSE_CHUNK: "backup:response-chunk",
} as const;

export interface BackupStoreChunkMsg {
  type: typeof BACKUP_MSG.STORE_CHUNK;
  chunk: BackupChunk;
}

export interface BackupStoreManifestMsg {
  type: typeof BACKUP_MSG.STORE_MANIFEST;
  manifestTag: string;
  manifest: BackupManifest;
}

export interface BackupQueryManifestMsg {
  type: typeof BACKUP_MSG.QUERY_MANIFEST;
  manifestTag: string;
  requestId: string;
}

export interface BackupQueryChunkMsg {
  type: typeof BACKUP_MSG.QUERY_CHUNK;
  tag: string;
  requestId: string;
}

export interface BackupResponseManifestMsg {
  type: typeof BACKUP_MSG.RESPONSE_MANIFEST;
  requestId: string;
  manifest: BackupManifest | null;
}

export interface BackupResponseChunkMsg {
  type: typeof BACKUP_MSG.RESPONSE_CHUNK;
  requestId: string;
  chunk: BackupChunk | null;
}

export type BackupMessage =
  | BackupStoreChunkMsg
  | BackupStoreManifestMsg
  | BackupQueryManifestMsg
  | BackupQueryChunkMsg
  | BackupResponseManifestMsg
  | BackupResponseChunkMsg;

// ── Local Chunk Store (in-memory for peer holding) ─────────────────────
const heldChunks = new Map<string, BackupChunk>();
const heldManifests = new Map<string, BackupManifest>();

export function storeChunkLocally(chunk: BackupChunk): void {
  heldChunks.set(chunk.tag, chunk);
}

export function storeManifestLocally(tag: string, manifest: BackupManifest): void {
  heldManifests.set(tag, manifest);
}

export function getHeldChunk(tag: string): BackupChunk | null {
  return heldChunks.get(tag) ?? null;
}

export function getHeldManifest(tag: string): BackupManifest | null {
  return heldManifests.get(tag) ?? null;
}

/**
 * Handle an incoming backup protocol message from a peer.
 * Returns a response message to send back, or null if none needed.
 */
export function handleBackupMessage(msg: BackupMessage): BackupMessage | null {
  switch (msg.type) {
    case BACKUP_MSG.STORE_CHUNK:
      storeChunkLocally(msg.chunk);
      return null;

    case BACKUP_MSG.STORE_MANIFEST:
      storeManifestLocally(msg.manifestTag, msg.manifest);
      return null;

    case BACKUP_MSG.QUERY_MANIFEST:
      return {
        type: BACKUP_MSG.RESPONSE_MANIFEST,
        requestId: msg.requestId,
        manifest: getHeldManifest(msg.manifestTag),
      };

    case BACKUP_MSG.QUERY_CHUNK:
      return {
        type: BACKUP_MSG.RESPONSE_CHUNK,
        requestId: msg.requestId,
        chunk: getHeldChunk(msg.tag),
      };

    default:
      return null;
  }
}

// ── Broadcast helpers (called by UI / backup flow) ─────────────────────

export type SendToPeerFn = (peerId: string, message: BackupMessage) => void;

/**
 * Distribute backup chunks to all connected peers.
 */
export function broadcastBackup(
  chunks: BackupChunk[],
  manifest: BackupManifest,
  manifestTag: string,
  connectedPeerIds: string[],
  sendToPeer: SendToPeerFn
): void {
  if (connectedPeerIds.length === 0) {
    console.warn("[backup] No peers connected — backup stored locally only");
  }

  for (const peerId of connectedPeerIds) {
    // Send manifest
    sendToPeer(peerId, {
      type: BACKUP_MSG.STORE_MANIFEST,
      manifestTag,
      manifest,
    });

    // Send each chunk
    for (const chunk of chunks) {
      sendToPeer(peerId, {
        type: BACKUP_MSG.STORE_CHUNK,
        chunk,
      });
    }
  }

  // Also hold locally
  storeManifestLocally(manifestTag, manifest);
  for (const chunk of chunks) {
    storeChunkLocally(chunk);
  }

  console.log(
    `[backup] Distributed ${chunks.length} chunks to ${connectedPeerIds.length} peers`
  );
}
