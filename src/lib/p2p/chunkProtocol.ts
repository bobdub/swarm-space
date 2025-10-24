/**
 * Chunk Distribution Protocol
 * Handles requesting, sending, and validating chunks over P2P connections
 */

import { getChunk } from '../store';
import { sha256 } from '../crypto';

export type ChunkMessageType = 
  | 'request_chunk'
  | 'chunk_data'
  | 'chunk_not_found'
  | 'request_manifest'
  | 'manifest_data';

export interface ChunkMessage {
  type: ChunkMessageType;
  requestId: string;
  hash?: string;
  data?: string; // base64 encoded
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

export class ChunkProtocol {
  private pendingRequests: Map<string, ChunkRequest> = new Map();
  private requestCallbacks: Map<string, (data: Uint8Array | null) => void> = new Map();
  private activeRequests: Set<string> = new Set();
  private maxConcurrentRequests = 10;
  private requestTimeout = 10000; // 10 seconds
  private maxRetries = 3;

  constructor(
    private sendMessage: (peerId: string, message: ChunkMessage) => boolean
  ) {}

  /**
   * Request a chunk from a peer
   */
  async requestChunk(peerId: string, chunkHash: string, priority: number = 5): Promise<Uint8Array | null> {
    const requestId = this.generateRequestId();
    
    console.log(`[ChunkProtocol] Requesting chunk ${chunkHash} from ${peerId}`);

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
          this.handleTimeout(requestId);
        }
      }, this.requestTimeout);
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
        await this.handleChunkData(message);
        break;
      case 'chunk_not_found':
        this.handleChunkNotFound(message);
        break;
      case 'request_manifest':
        await this.handleManifestRequest(peerId, message);
        break;
      case 'manifest_data':
        await this.handleManifestData(message);
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
      const chunkData = await getChunk(message.hash);

      if (chunkData) {
        // Verify hash matches
        const hash = await sha256(chunkData);
        if (hash === message.hash) {
          // Send chunk data
          const base64Data = this.arrayBufferToBase64(chunkData);
          this.sendMessage(peerId, {
            type: 'chunk_data',
            requestId: message.requestId,
            hash: message.hash,
            data: base64Data
          });
          console.log(`[ChunkProtocol] Sent chunk ${message.hash} to ${peerId}`);
        } else {
          console.error(`[ChunkProtocol] Hash mismatch for chunk ${message.hash}`);
          this.sendMessage(peerId, {
            type: 'chunk_not_found',
            requestId: message.requestId,
            hash: message.hash,
            error: 'Hash verification failed'
          });
        }
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

  private async handleChunkData(message: ChunkMessage): Promise<void> {
    if (!message.requestId || !message.data || !message.hash) {
      console.warn('[ChunkProtocol] Invalid chunk data message');
      return;
    }

    console.log(`[ChunkProtocol] Received chunk data for request ${message.requestId}`);

    const callback = this.requestCallbacks.get(message.requestId);
    if (!callback) {
      console.warn(`[ChunkProtocol] No callback for request ${message.requestId}`);
      return;
    }

    try {
      // Decode base64 data
      const chunkData = this.base64ToArrayBuffer(message.data);

      // Verify hash
      const hash = await sha256(chunkData);
      if (hash !== message.hash) {
        console.error(`[ChunkProtocol] Hash verification failed for chunk ${message.hash}`);
        callback(null);
      } else {
        console.log(`[ChunkProtocol] Chunk ${message.hash} verified successfully`);
        callback(chunkData);
      }
    } catch (error) {
      console.error('[ChunkProtocol] Error processing chunk data:', error);
      callback(null);
    }

    // Cleanup
    this.activeRequests.delete(message.requestId);
    this.pendingRequests.delete(message.requestId);
    this.requestCallbacks.delete(message.requestId);
  }

  private handleChunkNotFound(message: ChunkMessage): void {
    if (!message.requestId) return;

    console.log(`[ChunkProtocol] Chunk not found for request ${message.requestId}`);

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
    // TODO: Implement manifest request handling
    console.log(`[ChunkProtocol] Manifest request not yet implemented`);
  }

  private async handleManifestData(message: ChunkMessage): Promise<void> {
    // TODO: Implement manifest data handling
    console.log(`[ChunkProtocol] Manifest data handling not yet implemented`);
  }

  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
