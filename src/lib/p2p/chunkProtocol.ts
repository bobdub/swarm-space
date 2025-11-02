/**
 * Chunk Distribution Protocol
 * Handles requesting, sending, and validating chunks over P2P connections
 */

import { get, put, type Chunk, type Manifest } from '../store';
import { sha256 } from '../crypto';

import { recordP2PDiagnostic } from './diagnostics';
import { signManifest, verifyManifestSignature } from './replication';

export type ChunkMessageType =
  | 'request_chunk'
  | 'chunk_data'
  | 'chunk_not_found'
  | 'request_manifest'
  | 'manifest_data'
  | 'manifest_not_found';

export interface ChunkMessage {
  type: ChunkMessageType;
  requestId: string;
  hash?: string;
  data?: string; // base64 encoded (legacy support)
  chunk?: Chunk;
  manifest?: Manifest;
  error?: string;
}

export interface ChunkRequest {
  hash: string;
  priority: number;
  timeout: number;
  retries: number;
  timestamp: number;
  peerId: string;
}

export interface ChunkTransferUpdate {
  direction: 'upload' | 'download';
  kind: 'chunk' | 'manifest';
  bytes: number;
  peerId: string;
  requestId?: string;
}

export class ChunkProtocol {
  private pendingRequests: Map<string, ChunkRequest> = new Map();
  private requestCallbacks: Map<string, (data: Uint8Array | null) => void> = new Map();
  private activeRequests: Set<string> = new Set();
  private maxConcurrentRequests = 10;
  private requestTimeout = 30000; // 30 seconds for P2P chunk transfers
  private maxRetries = 3;
  private manifestRequests: Map<string, { hash: string; timestamp: number; peerId: string }> = new Map();
  private manifestCallbacks: Map<string, (manifest: Manifest | null) => void> = new Map();
  private manifestRequestTimeout = 30000; // 30 seconds for P2P manifest requests

  constructor(
    private sendMessage: (peerId: string, message: ChunkMessage) => boolean,
    private onTransfer?: (update: ChunkTransferUpdate) => void
  ) {}

  /**
   * Request a chunk from a peer
   */
  async requestChunk(peerId: string, chunkHash: string, priority: number = 5): Promise<Uint8Array | null> {
    const requestId = this.generateRequestId();

    console.log(`[ChunkProtocol] Requesting chunk ${chunkHash} from ${peerId}`);
    recordP2PDiagnostic({
      level: 'info',
      source: 'chunk-protocol',
      code: 'chunk-request',
      message: 'Requested chunk from peer',
      context: { peerId, chunkHash, priority }
    });

    return new Promise((resolve) => {
      const request: ChunkRequest = {
        hash: chunkHash,
        priority,
        timeout: this.requestTimeout,
        retries: 0,
        timestamp: Date.now(),
        peerId
      };

      this.pendingRequests.set(requestId, request);
      this.requestCallbacks.set(requestId, resolve);

      // Send request
      const sent = this.sendMessage(peerId, {
        type: 'request_chunk',
        requestId,
        hash: chunkHash
      });

      if (!sent) {
        console.warn(`[ChunkProtocol] Failed to send chunk request to ${peerId}`);
        recordP2PDiagnostic({
          level: 'warn',
          source: 'chunk-protocol',
          code: 'chunk-request-send-failed',
          message: 'Failed to send chunk request',
          context: { peerId, chunkHash }
        });
        this.pendingRequests.delete(requestId);
        this.requestCallbacks.delete(requestId);
        resolve(null);
        return;
      }

      this.activeRequests.add(requestId);

      // Set timeout
      setTimeout(() => {
        if (this.activeRequests.has(requestId)) {
          console.warn(`[ChunkProtocol] Request ${requestId} timed out`);
          recordP2PDiagnostic({
            level: 'warn',
            source: 'chunk-protocol',
            code: 'chunk-request-timeout',
            message: 'Chunk request timed out',
            context: { peerId, chunkHash, requestId }
          });
          this.handleTimeout(requestId);
        }
      }, this.requestTimeout);
    });
  }

  /**
   * Request a manifest from a peer
   */
  async requestManifest(peerId: string, manifestId: string): Promise<Manifest | null> {
    const requestId = this.generateRequestId();

    console.log(`[ChunkProtocol] Requesting manifest ${manifestId} from ${peerId}`);
    recordP2PDiagnostic({
      level: 'info',
      source: 'chunk-protocol',
      code: 'manifest-request',
      message: 'Requested manifest from peer',
      context: { peerId, manifestId }
    });

    return new Promise((resolve) => {
      this.manifestRequests.set(requestId, {
        hash: manifestId,
        timestamp: Date.now(),
        peerId
      });
      this.manifestCallbacks.set(requestId, resolve);

      const sent = this.sendMessage(peerId, {
        type: 'request_manifest',
        requestId,
        hash: manifestId
      });

      if (!sent) {
        console.warn(`[ChunkProtocol] Failed to send manifest request ${manifestId} to ${peerId}`);
        recordP2PDiagnostic({
          level: 'warn',
          source: 'chunk-protocol',
          code: 'manifest-request-send-failed',
          message: 'Failed to send manifest request',
          context: { peerId, manifestId }
        });
        this.manifestRequests.delete(requestId);
        this.manifestCallbacks.delete(requestId);
        resolve(null);
        return;
      }

      setTimeout(() => {
        if (this.manifestRequests.has(requestId)) {
          console.warn(`[ChunkProtocol] Manifest request ${requestId} timed out`);
          recordP2PDiagnostic({
            level: 'warn',
            source: 'chunk-protocol',
            code: 'manifest-request-timeout',
            message: 'Manifest request timed out',
            context: { peerId, manifestId, requestId }
          });
          this.handleManifestTimeout(requestId);
        }
      }, this.manifestRequestTimeout);
    });
  }

  /**
   * Handle incoming chunk protocol message
   */
  async handleMessage(peerId: string, message: ChunkMessage): Promise<void> {
    switch (message.type) {
      case 'request_chunk':
        await this.handleChunkRequest(peerId, message);
        break;
      case 'chunk_data':
        await this.handleChunkData(peerId, message);
        break;
      case 'chunk_not_found':
        this.handleChunkNotFound(message);
        break;
      case 'request_manifest':
        await this.handleManifestRequest(peerId, message);
        break;
      case 'manifest_data':
        await this.handleManifestData(peerId, message);
        break;
      case 'manifest_not_found':
        this.handleManifestNotFound(message);
        break;
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      pendingRequests: this.pendingRequests.size,
      activeRequests: this.activeRequests.size,
      maxConcurrent: this.maxConcurrentRequests
    };
  }

  /**
   * Cleanup old requests
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 60000; // 1 minute

    for (const [requestId, request] of this.pendingRequests.entries()) {
      if (now - request.timestamp > maxAge) {
        console.log(`[ChunkProtocol] Cleaning up old request ${requestId}`);
        this.activeRequests.delete(requestId);
        this.pendingRequests.delete(requestId);
        const callback = this.requestCallbacks.get(requestId);
        if (callback) {
          callback(null);
          this.requestCallbacks.delete(requestId);
        }
      }
    }

    for (const [requestId, request] of this.manifestRequests.entries()) {
      if (now - request.timestamp > maxAge) {
        console.log(`[ChunkProtocol] Cleaning up old manifest request ${requestId}`);
        const callback = this.manifestCallbacks.get(requestId);
        if (callback) {
          callback(null);
          this.manifestCallbacks.delete(requestId);
        }
        this.manifestRequests.delete(requestId);
      }
    }
  }

  // Private methods

  private async handleChunkRequest(peerId: string, message: ChunkMessage): Promise<void> {
    if (!message.hash || !message.requestId) {
      console.warn('[ChunkProtocol] Invalid chunk request');
      return;
    }

    console.log(`[ChunkProtocol] Handling chunk request for ${message.hash}`);

    try {
      // Get chunk from local storage
      const chunk = await get<Chunk>('chunks', message.hash);

      if (chunk) {
        this.sendMessage(peerId, {
          type: 'chunk_data',
          requestId: message.requestId,
          hash: chunk.ref,
          chunk
        });
        this.recordTransfer({
          direction: 'upload',
          kind: 'chunk',
          bytes: this.getChunkSize(chunk),
          peerId,
          requestId: message.requestId
        });
        console.log(`[ChunkProtocol] Sent chunk ${message.hash} to ${peerId}`);
      } else {
        // Chunk not found
        console.log(`[ChunkProtocol] Chunk ${message.hash} not found locally`);
        this.sendMessage(peerId, {
          type: 'chunk_not_found',
          requestId: message.requestId,
          hash: message.hash,
          error: 'Chunk not found'
        });
      }
    } catch (error) {
      console.error('[ChunkProtocol] Error handling chunk request:', error);
      this.sendMessage(peerId, {
        type: 'chunk_not_found',
        requestId: message.requestId,
        hash: message.hash,
        error: 'Internal error'
      });
    }
  }

  private async handleChunkData(peerId: string, message: ChunkMessage): Promise<void> {
    if (!message.requestId || !message.hash) {
      console.warn('[ChunkProtocol] Invalid chunk data message');
      return;
    }

    console.log(`[ChunkProtocol] Received chunk data for request ${message.requestId}`);
    recordP2PDiagnostic({
      level: 'info',
      source: 'chunk-protocol',
      code: 'chunk-data-received',
      message: 'Received chunk data from peer',
      context: { peerId, requestId: message.requestId, chunkHash: message.hash }
    });

    const callback = this.requestCallbacks.get(message.requestId);
    if (!callback) {
      console.warn(`[ChunkProtocol] No callback for request ${message.requestId}`);
      recordP2PDiagnostic({
        level: 'warn',
        source: 'chunk-protocol',
        code: 'chunk-callback-missing',
        message: 'No callback registered for chunk response',
        context: { requestId: message.requestId }
      });
      return;
    }

    try {
      let chunkData: Uint8Array | null = null;
      let chunkBytes = 0;

      if (message.chunk) {
        if (message.chunk.ref !== message.hash) {
          console.error(`[ChunkProtocol] Chunk ref mismatch for ${message.hash}`);
          chunkData = null;
        } else {
          await put('chunks', message.chunk);
          chunkData = this.base64ToArrayBuffer(message.chunk.cipher);
          chunkBytes = this.getChunkSize(message.chunk);
        }
      } else if (message.data) {
        // Legacy support for data payload
        const decoded = this.base64ToArrayBuffer(message.data);
        const hash = await sha256(decoded);
        if (hash !== message.hash) {
          console.error(`[ChunkProtocol] Hash verification failed for chunk ${message.hash}`);
          chunkData = null;
        } else {
          chunkData = decoded;
          chunkBytes = decoded.byteLength;
        }
      }

      if (chunkData) {
        console.log(`[ChunkProtocol] Chunk ${message.hash} processed successfully`);
        callback(chunkData);
        recordP2PDiagnostic({
          level: 'info',
          source: 'chunk-protocol',
          code: 'chunk-complete',
          message: 'Chunk transfer completed successfully',
          context: { peerId, requestId: message.requestId, chunkHash: message.hash, bytes: chunkBytes }
        });
        this.recordTransfer({
          direction: 'download',
          kind: 'chunk',
          bytes: chunkBytes,
          peerId,
          requestId: message.requestId
        });
      } else {
        callback(null);
        recordP2PDiagnostic({
          level: 'warn',
          source: 'chunk-protocol',
          code: 'chunk-verify-failed',
          message: 'Chunk verification failed',
          context: { peerId, requestId: message.requestId, chunkHash: message.hash }
        });
      }
    } catch (error) {
      console.error('[ChunkProtocol] Error processing chunk data:', error);
      callback(null);
      recordP2PDiagnostic({
        level: 'error',
        source: 'chunk-protocol',
        code: 'chunk-processing-error',
        message: error instanceof Error ? error.message : 'Unknown chunk processing error',
        context: { peerId, requestId: message.requestId }
      });
    }

    // Cleanup
    this.activeRequests.delete(message.requestId);
    this.pendingRequests.delete(message.requestId);
    this.requestCallbacks.delete(message.requestId);
  }

  private handleChunkNotFound(message: ChunkMessage): void {
    if (!message.requestId) return;

    console.log(`[ChunkProtocol] Chunk not found for request ${message.requestId}`);
    recordP2PDiagnostic({
      level: 'warn',
      source: 'chunk-protocol',
      code: 'chunk-not-found',
      message: 'Remote peer reported chunk not found',
      context: { requestId: message.requestId, chunkHash: message.hash }
    });

    const callback = this.requestCallbacks.get(message.requestId);
    if (callback) {
      callback(null);
    }

    // Cleanup
    this.activeRequests.delete(message.requestId);
    this.pendingRequests.delete(message.requestId);
    this.requestCallbacks.delete(message.requestId);
  }

  private handleTimeout(requestId: string): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) return;

    console.log(`[ChunkProtocol] Request ${requestId} timed out after ${request.retries} retries`);
    recordP2PDiagnostic({
      level: 'warn',
      source: 'chunk-protocol',
      code: 'chunk-timeout-final',
      message: 'Chunk request exceeded timeout window',
      context: { peerId: request.peerId, chunkHash: request.hash, retries: request.retries }
    });

    const callback = this.requestCallbacks.get(requestId);
    if (callback) {
      callback(null);
    }

    // Cleanup
    this.activeRequests.delete(requestId);
    this.pendingRequests.delete(requestId);
    this.requestCallbacks.delete(requestId);
  }

  private async handleManifestRequest(peerId: string, message: ChunkMessage): Promise<void> {
    if (!message.hash || !message.requestId) {
      console.warn('[ChunkProtocol] Invalid manifest request');
      return;
    }

    console.log(`[ChunkProtocol] Handling manifest request for ${message.hash}`);

    try {
      const manifest = await get<Manifest>('manifests', message.hash);

      if (manifest) {
        let outgoingManifest = manifest;
        const valid = await verifyManifestSignature(manifest);

        if (!valid) {
          outgoingManifest = await signManifest(manifest);
          await put('manifests', outgoingManifest);
          recordP2PDiagnostic({
            level: 'warn',
            source: 'chunk-protocol',
            code: 'manifest-signature-refresh',
            message: 'Local manifest lacked a valid signature; refreshed before sharing',
            context: { manifestId: manifest.fileId }
          });
        }

        this.sendMessage(peerId, {
          type: 'manifest_data',
          requestId: message.requestId,
          hash: outgoingManifest.fileId,
          manifest: outgoingManifest
        });
        this.recordTransfer({
          direction: 'upload',
          kind: 'manifest',
          bytes: this.getManifestSize(outgoingManifest),
          peerId,
          requestId: message.requestId
        });
      } else {
        console.warn(`[ChunkProtocol] Manifest ${message.hash} not found locally`);
        this.sendMessage(peerId, {
          type: 'manifest_not_found',
          requestId: message.requestId,
          hash: message.hash,
          error: 'Manifest not found'
        });
      }
    } catch (error) {
      console.error('[ChunkProtocol] Error handling manifest request:', error);
      this.sendMessage(peerId, {
        type: 'manifest_not_found',
        requestId: message.requestId,
        hash: message.hash,
        error: 'Internal error'
      });
    }
  }

  private async handleManifestData(peerId: string, message: ChunkMessage): Promise<void> {
    if (!message.requestId || !message.manifest) {
      console.warn('[ChunkProtocol] Invalid manifest data message');
      recordP2PDiagnostic({
        level: 'warn',
        source: 'chunk-protocol',
        code: 'manifest-data-invalid',
        message: 'Received malformed manifest response',
        context: { peerId, requestId: message.requestId }
      });
      return;
    }

    console.log(`[ChunkProtocol] Received manifest ${message.manifest.fileId}`);
    recordP2PDiagnostic({
      level: 'info',
      source: 'chunk-protocol',
      code: 'manifest-data-received',
      message: 'Received manifest from peer',
      context: { peerId, requestId: message.requestId, manifestId: message.manifest.fileId }
    });

    const callback = this.manifestCallbacks.get(message.requestId);
    if (!callback) {
      console.warn(`[ChunkProtocol] No manifest callback for request ${message.requestId}`);
      recordP2PDiagnostic({
        level: 'warn',
        source: 'chunk-protocol',
        code: 'manifest-callback-missing',
        message: 'No callback registered for manifest response',
        context: { requestId: message.requestId }
      });
      return;
    }

    try {
      const valid = await verifyManifestSignature(message.manifest);

      if (!valid) {
        recordP2PDiagnostic({
          level: 'warn',
          source: 'chunk-protocol',
          code: 'manifest-signature-invalid',
          message: 'Rejected manifest with invalid signature',
          context: { peerId, requestId: message.requestId, manifestId: message.manifest.fileId }
        });
        callback(null);
        return;
      }

      await put('manifests', message.manifest);
      callback(message.manifest);
      this.recordTransfer({
        direction: 'download',
        kind: 'manifest',
        bytes: this.getManifestSize(message.manifest),
        peerId,
        requestId: message.requestId
      });
      recordP2PDiagnostic({
        level: 'info',
        source: 'chunk-protocol',
        code: 'manifest-complete',
        message: 'Manifest transfer completed successfully',
        context: { peerId, requestId: message.requestId, manifestId: message.manifest.fileId }
      });
    } catch (error) {
      console.error('[ChunkProtocol] Failed to store manifest:', error);
      callback(null);
      recordP2PDiagnostic({
        level: 'error',
        source: 'chunk-protocol',
        code: 'manifest-store-error',
        message: error instanceof Error ? error.message : 'Unknown manifest storage error',
        context: { peerId, requestId: message.requestId }
      });
    }

    this.manifestRequests.delete(message.requestId);
    this.manifestCallbacks.delete(message.requestId);
  }

  private handleManifestNotFound(message: ChunkMessage): void {
    if (!message.requestId) {
      return;
    }

    console.warn(`[ChunkProtocol] Manifest not found for request ${message.requestId}`);
    recordP2PDiagnostic({
      level: 'warn',
      source: 'chunk-protocol',
      code: 'manifest-not-found',
      message: 'Remote peer reported manifest not found',
      context: { requestId: message.requestId, manifestId: message.hash }
    });

    const callback = this.manifestCallbacks.get(message.requestId);
    if (callback) {
      callback(null);
    }

    this.manifestRequests.delete(message.requestId);
    this.manifestCallbacks.delete(message.requestId);
  }

  private handleManifestTimeout(requestId: string): void {
    const callback = this.manifestCallbacks.get(requestId);
    if (callback) {
      callback(null);
    }
    recordP2PDiagnostic({
      level: 'warn',
      source: 'chunk-protocol',
      code: 'manifest-timeout-final',
      message: 'Manifest request exceeded timeout window',
      context: { requestId }
    });
    this.manifestCallbacks.delete(requestId);
    this.manifestRequests.delete(requestId);
  }

  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private base64ToArrayBuffer(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  private getChunkSize(chunk: Chunk): number {
    if (typeof chunk.size === 'number') {
      return chunk.size;
    }
    return Math.ceil((chunk.cipher.length * 3) / 4);
  }

  private getManifestSize(manifest: Manifest): number {
    const encoded = JSON.stringify(manifest);
    return new TextEncoder().encode(encoded).byteLength;
  }

  private recordTransfer(update: ChunkTransferUpdate): void {
    if (!this.onTransfer) return;
    try {
      this.onTransfer(update);
    } catch (error) {
      console.warn('[ChunkProtocol] Transfer callback failed', error);
    }
  }
}
