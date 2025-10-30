/**
 * PeerJS Adapter for P2P Networking
 * 
 * Uses PeerJS's cloud-hosted signaling server for cross-device discovery
 * while maintaining direct P2P data channels for actual content transfer.
 * 
 * PeerJS provides:
 * - Zero-configuration signaling (no .env files needed)
 * - Cross-device WebRTC discovery
 * - Automatic NAT traversal (STUN/TURN)
 * - Reliable connection management
 * 
 * Note: Initial peer discovery uses PeerJS cloud infrastructure.
 * Once connected, all data flows directly peer-to-peer.
 */

import Peer, { DataConnection } from 'peerjs';

import { recordP2PDiagnostic } from './diagnostics';

const PEER_ID_STORAGE_KEY_PREFIX = 'p2p-peer-id:';
const CONNECTION_TIMEOUT_MS = 20000; // 20s for peer connections
const INIT_TIMEOUT_MS = 10000; // 10s per attempt - fail faster to try alternatives

type PeerWithPeerListing = Peer & {
  listAllPeers?: (callback: (peers: string[]) => void) => void;
};

export interface PeerJSMessage {
  type: string;
  payload: unknown;
  from: string;
  timestamp: number;
}

export interface PeerInfo {
  id: string;
  userId: string;
  connection: DataConnection;
}

export class PeerJSAdapter {
  private peer: Peer | null = null;
  private connections = new Map<string, DataConnection>();
  private messageHandlers = new Map<string, (msg: PeerJSMessage) => void>();
  private connectionHandlers: ((peerId: string) => void)[] = [];
  private disconnectionHandlers: ((peerId: string) => void)[] = [];
  private readyHandlers: (() => void)[] = [];
  private signalingDisconnectedHandlers: (() => void)[] = [];
  private localUserId: string;
  private peerId: string | null = null;
  private isSignalingConnected = false;
  private storedPeerId: string | null = null;
  private pendingConnections = new Set<string>();
  private connectionMetadata = new Map<string, unknown>();
  private initAbortController: AbortController | null = null;

  constructor(localUserId: string) {
    this.localUserId = localUserId;
    console.log('[PeerJS] Initializing adapter for user:', localUserId);
    this.storedPeerId = this.loadPersistedPeerId();
  }

  /**
   * Initialize PeerJS with default cloud signaling (with retry)
   */
  async initialize(retryCount = 0, maxRetries = 3): Promise<string> {
    // Create new abort controller for this initialization
    this.initAbortController = new AbortController();
    const abortSignal = this.initAbortController.signal;
    
    return new Promise((resolve, reject) => {
      // Check if already aborted
      if (abortSignal.aborted) {
        reject(new Error('Connection aborted by user'));
        return;
      }

      const attempt = retryCount + 1;
      console.log(`[PeerJS] 🔌 Connection attempt ${attempt}/${maxRetries + 1}`);
      console.log('[PeerJS] 📡 Target: 0.peerjs.com:443 (PeerJS Cloud)');
      recordP2PDiagnostic({
        level: 'info',
        source: 'peerjs',
        code: 'init-attempt',
        message: 'Attempting PeerJS signaling connection',
        context: { attempt, maxRetries }
      });

      const targetPeerId = this.ensurePeerId();
      console.log('[PeerJS] 🆔 Peer identity:', targetPeerId);

      const connectionStartTime = Date.now();

      let resolved = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      // Listen for abort signal
      const onAbort = () => {
        console.log('[PeerJS] Connection aborted by user');
        cleanup();
        if (!resolved) {
          resolved = true;
          this.peer?.destroy();
          this.peer = null;
          reject(new Error('Connection aborted by user'));
        }
      };
      abortSignal.addEventListener('abort', onAbort);

      // Create peer with default PeerJS cloud server and retry settings
      this.peer = new Peer(targetPeerId, {
        debug: 2, // Increase debug level for better diagnostics
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        path: '/',
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });

      console.log('[PeerJS] ⏱️ WebSocket connection initiated...');

      const cleanup = () => {
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        abortSignal.removeEventListener('abort', onAbort);
      };

      this.peer.on('open', (id) => {
        cleanup();
        const connectionTime = Date.now() - connectionStartTime;
        this.peerId = id;
        this.isSignalingConnected = true;
        this.persistPeerId(id);
        console.log(`[PeerJS] ✅ Connected in ${connectionTime}ms`);
        console.log('[PeerJS] 🆔 Assigned Peer ID:', id);
        console.log('[PeerJS] 🌐 Signaling server: 0.peerjs.com');
        recordP2PDiagnostic({
          level: 'info',
          source: 'peerjs',
          code: 'init-success',
          message: 'PeerJS signaling connection established',
          context: { peerId: id, connectionTime }
        });
        this.readyHandlers.forEach(h => h());
        if (!resolved) {
          resolved = true;
          resolve(id);
        }
      });

      this.peer.on('error', (error) => {
        const connectionTime = Date.now() - connectionStartTime;
        console.error(`[PeerJS] ❌ Error after ${connectionTime}ms:`, error);
        console.error('[PeerJS] Error type:', error.type);
        console.error('[PeerJS] Error message:', error.message);
        recordP2PDiagnostic({
          level: 'error',
          source: 'peerjs',
          code: 'peer-error',
          message: error?.message ?? 'PeerJS reported an unknown error',
          context: { connectionTime, type: error?.type }
        });
        
        if (this.isUnavailableIdError(error)) {
          console.warn('[PeerJS] Peer ID conflict detected, generating new ID...');
          this.handleUnavailablePeerId();
        }
        
        if (!resolved && !this.peerId) {
          cleanup();
          resolved = true;

          // Retry on connection errors with shorter delays
          if (retryCount < maxRetries && !abortSignal.aborted) {
            const delay = Math.min(1500 * Math.pow(1.3, retryCount), 5000); // Shorter backoff
            console.log(`[PeerJS] 🔄 Retry in ${delay}ms (attempt ${retryCount + 2}/${maxRetries + 1})...`);
            this.peer?.destroy();
            this.peer = null;
            
            setTimeout(() => {
              if (!abortSignal.aborted) {
                this.initialize(retryCount + 1, maxRetries)
                  .then(resolve)
                  .catch(reject);
              }
            }, delay);
          } else {
            console.error('[PeerJS] ❌ All retry attempts exhausted');
            console.error('[PeerJS] Possible causes:');
            console.error('  • PeerJS signaling server (0.peerjs.com) is down');
            console.error('  • Network firewall blocking WebSocket connections');
            console.error('  • Browser security settings blocking WebRTC');
            console.error('  • Proxy or VPN interference');
            this.peer?.destroy();
            this.peer = null;
            reject(new Error('PeerJS connection failed: ' + (error.message || 'Network error')));
          }
        }
      });

      this.peer.on('connection', (conn) => {
        console.log('[PeerJS] Incoming connection from:', conn.peer);
        this.handleIncomingConnection(conn);
      });

      this.peer.on('disconnected', () => {
        const connectionTime = Date.now() - connectionStartTime;
        console.log(`[PeerJS] ⚠️ Disconnected from signaling server after ${connectionTime}ms`);
        console.log('[PeerJS] Previous state: connected =', this.isSignalingConnected);
        recordP2PDiagnostic({
          level: 'warn',
          source: 'peerjs',
          code: 'signaling-disconnected',
          message: 'Lost connection to PeerJS signaling server',
          context: { connectionTime }
        });
        this.isSignalingConnected = false;
        this.signalingDisconnectedHandlers.forEach(h => h());
        
        // Try to reconnect after a delay if we were previously connected
        if (this.peer && this.peerId) {
          console.log('[PeerJS] 🔄 Auto-reconnect in 3s...');
          setTimeout(() => {
            if (this.peer && !this.peer.destroyed) {
              console.log('[PeerJS] Calling peer.reconnect()...');
              this.peer.reconnect();
            }
          }, 3000);
        } else {
          console.log('[PeerJS] ⚠️ No reconnect attempt (never connected or no peer ID)');
        }
      });
      
      // 10 second timeout per attempt - fail faster
      timeoutHandle = setTimeout(() => {
        if (!resolved && !abortSignal.aborted) {
          cleanup();
          resolved = true;
          
          const elapsedTime = Date.now() - connectionStartTime;
          console.warn(`[PeerJS] ⏱️ Timeout after ${elapsedTime}ms (no response from signaling server)`);
          recordP2PDiagnostic({
            level: 'warn',
            source: 'peerjs',
            code: 'init-timeout-warning',
            message: 'PeerJS signaling attempt timed out',
            context: { elapsedTime, attempt }
          });

          // Retry on timeout with shorter delays
          if (retryCount < maxRetries && !abortSignal.aborted) {
            const delay = Math.min(1500 * Math.pow(1.3, retryCount), 5000); // Shorter backoff
            console.log(`[PeerJS] 🔄 Retry scheduled in ${delay}ms (attempt ${retryCount + 2}/${maxRetries + 1})...`);
            this.peer?.destroy();
            this.peer = null;
            
            setTimeout(() => {
              if (!abortSignal.aborted) {
                this.initialize(retryCount + 1, maxRetries)
                  .then(resolve)
                  .catch(reject);
              }
            }, delay);
          } else {
            console.error('[PeerJS] ❌ All connection attempts timed out');
            console.error('[PeerJS] Total time spent:', Date.now() - connectionStartTime, 'ms');
            console.error('[PeerJS] Diagnostic information:');
            console.error('  • Signaling server: wss://0.peerjs.com:443');
            console.error('  • No WebSocket connection established');
            console.error('  • This typically indicates:');
            console.error('    - The PeerJS cloud server is down or overloaded');
            console.error('    - Your network/firewall is blocking WebSocket (port 443)');
            console.error('    - DNS resolution failed for 0.peerjs.com');
            console.error('    - ISP or corporate proxy is blocking the connection');
            console.error('[PeerJS] 💡 Troubleshooting steps:');
            console.error('  1. Check if https://0.peerjs.com is accessible');
            console.error('  2. Try a different network (mobile hotspot)');
            console.error('  3. Disable VPN/proxy if active');
            console.error('  4. Check browser console for CORS/WebSocket errors');
            
            this.peer?.destroy();
            this.peer = null;
            recordP2PDiagnostic({
              level: 'error',
              source: 'peerjs',
              code: 'init-timeout',
              message: 'PeerJS signaling connection timed out',
              context: { elapsedTime }
            });
            reject(new Error('PeerJS connection timeout - signaling server may be unavailable or blocked by network'));
          }
        }
      }, INIT_TIMEOUT_MS); // 30 second timeout per attempt
    });
  }

  /**
   * Abort ongoing initialization attempt
   */
  abortInitialization(): void {
    if (this.initAbortController) {
      console.log('[PeerJS] Aborting initialization...');
      this.initAbortController.abort();
      this.initAbortController = null;
      recordP2PDiagnostic({
        level: 'warn',
        source: 'peerjs',
        code: 'init-abort',
        message: 'PeerJS initialization aborted by caller'
      });
    }
  }

  /**
   * Connect to a remote peer by their peer ID
   */
  connectToPeer(remotePeerId: string): void {
    if (!this.peer) {
      console.error('[PeerJS] Cannot connect: not initialized');
      return;
    }

    if (this.connections.has(remotePeerId)) {
      console.log('[PeerJS] Already connected to', remotePeerId);
      return;
    }

    if (this.pendingConnections.has(remotePeerId)) {
      console.log('[PeerJS] Connection to', remotePeerId, 'is already pending');
      return;
    }

    console.log('[PeerJS] Initiating connection to:', remotePeerId);
    recordP2PDiagnostic({
      level: 'info',
      source: 'peerjs',
      code: 'connect-request',
      message: 'Attempting to open peer connection',
      context: { peerId: remotePeerId }
    });
    const conn = this.peer.connect(remotePeerId, {
      reliable: true,
      metadata: { userId: this.localUserId }
    });

    this.pendingConnections.add(remotePeerId);
    this.handleIncomingConnection(conn);
  }

  /**
   * Handle incoming connection setup
   */
  private handleIncomingConnection(conn: DataConnection): void {
    const connectionStartedAt = Date.now();
    let handshakeTimeout: ReturnType<typeof setTimeout> | null = null;

    const clearHandshakeTimeout = () => {
      if (handshakeTimeout) {
        clearTimeout(handshakeTimeout);
        handshakeTimeout = null;
      }
    };

    if (!conn.open) {
      handshakeTimeout = setTimeout(() => {
        if (!conn.open) {
          console.warn(
            `[PeerJS] ⏳ Connection to ${conn.peer} did not open within ${CONNECTION_TIMEOUT_MS}ms; closing stalled channel`
          );
          this.pendingConnections.delete(conn.peer);
          try {
            conn.close();
          } catch (error) {
            console.error('[PeerJS] Error closing stalled connection:', error);
          }
          recordP2PDiagnostic({
            level: 'warn',
            source: 'peerjs',
            code: 'handshake-timeout',
            message: 'Timed out waiting for data channel to open',
            context: { peerId: conn.peer, timeoutMs: CONNECTION_TIMEOUT_MS }
          });
        }
      }, CONNECTION_TIMEOUT_MS);
    }

    conn.on('open', () => {
      clearHandshakeTimeout();
      const elapsed = Date.now() - connectionStartedAt;
      console.log('[PeerJS] ✅ Connection established with:', conn.peer, `(${elapsed}ms)`);
      this.pendingConnections.delete(conn.peer);
      recordP2PDiagnostic({
        level: 'info',
        source: 'peerjs',
        code: 'handshake-success',
        message: 'Peer data channel opened successfully',
        context: { peerId: conn.peer, elapsed }
      });

      const existing = this.connections.get(conn.peer);
      if (existing && existing !== conn) {
        if (existing.open) {
          console.log('[PeerJS] Closing duplicate connection from', conn.peer);
          conn.close();
          return;
        }

        console.log('[PeerJS] Replacing stale connection for', conn.peer);
      }

      this.connections.set(conn.peer, conn);
      this.connectionMetadata.set(conn.peer, conn.metadata);
      this.connectionHandlers.forEach(h => h(conn.peer));
    });

    conn.on('data', (data) => {
      try {
        const message = data as PeerJSMessage;
        console.log(`[PeerJS] Received ${message.type} from ${conn.peer}`);
        
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
          handler(message);
        } else {
          console.warn('[PeerJS] No handler for message type:', message.type);
        }
      } catch (error) {
        console.error('[PeerJS] Error handling message:', error);
      }
    });

    conn.on('close', () => {
      clearHandshakeTimeout();
      console.log('[PeerJS] Connection closed:', conn.peer);
      this.connections.delete(conn.peer);
      this.pendingConnections.delete(conn.peer);
      this.connectionMetadata.delete(conn.peer);
      this.disconnectionHandlers.forEach(h => h(conn.peer));
      recordP2PDiagnostic({
        level: 'warn',
        source: 'peerjs',
        code: 'connection-closed',
        message: 'Peer connection closed',
        context: { peerId: conn.peer }
      });
    });

    conn.on('error', (error) => {
      clearHandshakeTimeout();
      console.error('[PeerJS] Connection error with', conn.peer, ':', error);
      this.connections.delete(conn.peer);
      this.pendingConnections.delete(conn.peer);
      this.disconnectionHandlers.forEach(h => h(conn.peer));
      recordP2PDiagnostic({
        level: 'error',
        source: 'peerjs',
        code: 'connection-error',
        message: error instanceof Error ? error.message : 'Unknown PeerJS connection error',
        context: { peerId: conn.peer }
      });
    });
  }

  /**
   * Send message to specific peer
   */
  sendToPeer(peerId: string, type: string, payload: unknown): boolean {
    const conn = this.connections.get(peerId);
    if (!conn) {
      console.warn('[PeerJS] Cannot send to', peerId, '- not connected');
      recordP2PDiagnostic({
        level: 'warn',
        source: 'peerjs',
        code: 'send-missed',
        message: 'Attempted to send message to disconnected peer',
        context: { peerId, type }
      });
      return false;
    }

    const message: PeerJSMessage = {
      type,
      payload,
      from: this.peerId || 'unknown',
      timestamp: Date.now()
    };

    try {
      conn.send(message);
      console.log(`[PeerJS] Sent ${type} to ${peerId}`);
      return true;
    } catch (error) {
      console.error('[PeerJS] Error sending message:', error);
      return false;
    }
  }

  /**
   * Broadcast message to all connected peers
   */
  broadcast(type: string, payload: unknown): void {
    const message: PeerJSMessage = {
      type,
      payload,
      from: this.peerId || 'unknown',
      timestamp: Date.now()
    };

    let sent = 0;
    for (const [peerId, conn] of this.connections.entries()) {
      try {
        conn.send(message);
        sent++;
      } catch (error) {
        console.error(`[PeerJS] Error broadcasting to ${peerId}:`, error);
      }
    }
    
    console.log(`[PeerJS] Broadcast ${type} to ${sent} peer(s)`);
  }

  /**
   * Register message handler
   */
  onMessage(type: string, handler: (msg: PeerJSMessage) => void): void {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Register connection handler
   */
  onConnection(handler: (peerId: string) => void): void {
    this.connectionHandlers.push(handler);
  }

  /**
   * Register disconnection handler
   */
  onDisconnection(handler: (peerId: string) => void): void {
    this.disconnectionHandlers.push(handler);
  }

  /**
   * Register ready handler
   */
  onReady(handler: () => void): void {
    this.readyHandlers.push(handler);
    if (this.peerId) {
      handler(); // Already ready
    }
  }

  /**
   * Register signaling disconnected handler
   */
  onSignalingDisconnected(handler: () => void): void {
    this.signalingDisconnectedHandlers.push(handler);
  }

  /**
   * Check if signaling connection is active
   */
  isSignalingActive(): boolean {
    return this.isSignalingConnected && this.peer !== null && !this.peer.destroyed;
  }

  /**
   * Get current peer ID
   */
  getPeerId(): string | null {
    return this.peerId;
  }

  /**
   * Get connected peer IDs
   */
  getConnectedPeers(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * List all active peers on the PeerJS network
   * This enables automatic peer discovery without manual ID sharing
   */
  async listAllPeers(): Promise<string[]> {
    if (!this.peer) {
      console.error('[PeerJS] Cannot list peers: not initialized');
      return [];
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[PeerJS] ⏰ listAllPeers timeout after 10s - server may not support this feature');
        recordP2PDiagnostic({
          level: 'warn',
          source: 'peerjs',
          code: 'list-all-timeout',
          message: 'PeerJS listAllPeers call timed out'
        });
        resolve([]);
      }, 10000);

      try {
        console.log('[PeerJS] 📡 Calling listAllPeers on PeerJS server...');
        recordP2PDiagnostic({
          level: 'info',
          source: 'peerjs',
          code: 'list-all-request',
          message: 'Requesting PeerJS listAllPeers inventory'
        });
        const peerWithListing = this.peer as PeerWithPeerListing;
        peerWithListing.listAllPeers?.((peers: string[]) => {
          clearTimeout(timeout);
          console.log(`[PeerJS] ✅ listAllPeers returned ${peers.length} active peers`);
          recordP2PDiagnostic({
            level: 'info',
            source: 'peerjs',
            code: 'list-all-success',
            message: 'Received PeerJS listAllPeers response',
            context: { count: peers.length }
          });
          if (peers.length > 0) {
            console.log(`[PeerJS] 📋 Peer IDs:`, peers);
          }
          resolve(peers);
        });
        if (!peerWithListing.listAllPeers) {
          console.warn('[PeerJS] ℹ️ PeerJS server does not expose listAllPeers');
          clearTimeout(timeout);
          recordP2PDiagnostic({
            level: 'warn',
            source: 'peerjs',
            code: 'list-all-unsupported',
            message: 'PeerJS server does not expose listAllPeers API'
          });
          resolve([]);
        }
      } catch (error) {
        clearTimeout(timeout);
        console.error('[PeerJS] ❌ Error calling listAllPeers:', error);
        console.log('[PeerJS] 💡 This PeerJS server may not support peer listing');
        recordP2PDiagnostic({
          level: 'error',
          source: 'peerjs',
          code: 'list-all-error',
          message: error instanceof Error ? error.message : 'Unknown listAllPeers error'
        });
        resolve([]);
      }
    });
  }

  /**
   * Check if connected to peer
   */
  isConnectedTo(peerId: string): boolean {
    return this.connections.has(peerId);
  }

  /**
   * Disconnect from specific peer
   */
  disconnectFrom(peerId: string): void {
    const conn = this.connections.get(peerId);
    if (conn) {
      console.log('[PeerJS] Disconnecting from:', peerId);
      conn.close();
      this.connections.delete(peerId);
      this.pendingConnections.delete(peerId);
      this.connectionMetadata.delete(peerId);
    }
  }

  getConnectionMetadata(peerId: string): unknown {
    return this.connectionMetadata.get(peerId);
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    console.log('[PeerJS] Shutting down...');

    // Abort any ongoing initialization
    this.abortInitialization();

    // Close all connections
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();
    this.pendingConnections.clear();

    // Destroy peer
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    this.peerId = null;
    this.isSignalingConnected = false;
    console.log('[PeerJS] Shutdown complete');
  }

  private ensurePeerId(): string {
    if (this.storedPeerId) {
      return this.storedPeerId;
    }

    const generated = this.generatePeerId();
    this.persistPeerId(generated);
    return generated;
  }

  private generatePeerId(): string {
    const sanitizedUser = this.localUserId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 9);
    const prefix = sanitizedUser ? `${sanitizedUser}-` : '';
    return `peer-${prefix}${timestamp}-${random}`;
  }

  private getStorageKey(): string {
    return `${PEER_ID_STORAGE_KEY_PREFIX}${this.localUserId}`;
  }

  private loadPersistedPeerId(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }

    const key = this.getStorageKey();

    try {
      const stored = window.localStorage.getItem(key);
      if (stored) {
        return stored;
      }
    } catch (error) {
      console.warn('[PeerJS] Unable to read peer ID from localStorage:', error);
    }

    try {
      const stored = window.sessionStorage.getItem(key);
      if (stored) {
        return stored;
      }
    } catch (error) {
      console.warn('[PeerJS] Unable to read peer ID from sessionStorage:', error);
    }

    const legacyKey = 'p2p-peer-id';
    try {
      const legacy = window.sessionStorage.getItem(legacyKey) ?? window.localStorage.getItem(legacyKey);
      if (legacy) {
        this.persistPeerId(legacy);
        return legacy;
      }
    } catch (error) {
      console.warn('[PeerJS] Unable to read legacy peer ID:', error);
    }

    return null;
  }

  private persistPeerId(peerId: string): void {
    if (typeof window === 'undefined') {
      this.storedPeerId = peerId;
      return;
    }

    const key = this.getStorageKey();

    try {
      window.localStorage.setItem(key, peerId);
      this.storedPeerId = peerId;
      return;
    } catch (error) {
      console.warn('[PeerJS] Unable to persist peer ID to localStorage:', error);
    }

    try {
      window.sessionStorage.setItem(key, peerId);
      this.storedPeerId = peerId;
      return;
    } catch (error) {
      console.warn('[PeerJS] Unable to persist peer ID to sessionStorage:', error);
    }

    this.storedPeerId = peerId;
  }

  private clearPersistedPeerId(): void {
    if (typeof window !== 'undefined') {
      const key = this.getStorageKey();
      try {
        window.localStorage.removeItem(key);
      } catch (error) {
        console.warn('[PeerJS] Unable to remove peer ID from localStorage:', error);
      }

      try {
        window.sessionStorage.removeItem(key);
      } catch (error) {
        console.warn('[PeerJS] Unable to remove peer ID from sessionStorage:', error);
      }
    }

    this.storedPeerId = null;
  }

  private isUnavailableIdError(error: unknown): boolean {
    if (!error) {
      return false;
    }

    const maybePeerError = error as { type?: string; message?: string };
    const type = maybePeerError.type;
    if (type === 'unavailable-id') {
      return true;
    }

    const message = maybePeerError.message ?? (typeof error === 'string' ? error : '');
    return typeof message === 'string' && /unavailable|ID is taken/i.test(message);
  }

  private handleUnavailablePeerId(): void {
    if (this.storedPeerId) {
      console.warn('[PeerJS] Stored peer ID is unavailable, generating a new one');
    }
    this.clearPersistedPeerId();
  }
}
