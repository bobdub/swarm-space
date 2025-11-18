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
import { 
  recordConnectionFailure, 
  recordConnectionSuccess, 
  canAttemptConnection,
  getBackoffState 
} from './connectionBackoff';
import { getPendingConnectionMonitor } from './pendingConnectionCleanup';

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];

export interface PeerJSEndpointOptions {
  id?: string;
  label?: string;
  host: string;
  port: number;
  secure: boolean;
  path?: string;
}

export interface PeerJSEndpoint {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  path: string;
}

export interface PeerJSSignalingConfiguration {
  endpoints: PeerJSEndpointOptions[];
  iceServers?: RTCIceServer[];
  attemptsPerEndpoint?: number;
  preferredEndpointId?: string | null;
}

export function createDefaultPeerJSSignalingConfig(): PeerJSSignalingConfiguration {
  return {
    endpoints: [
      {
        id: 'peerjs-cloud',
        label: 'PeerJS Cloud',
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        path: '/',
      },
    ],
    iceServers: DEFAULT_ICE_SERVERS,
    attemptsPerEndpoint: 3,
  };
}

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
  private connectionFailureHandlers: ((peerId: string, reason: 'timeout' | 'error', context?: Record<string, unknown>) => void)[] = [];
  private localUserId: string;
  private peerId: string | null = null;
  private isSignalingConnected = false;
  private storedPeerId: string | null = null;
  private pendingConnections = new Set<string>();
  private connectionMetadata = new Map<string, unknown>();
  private initAbortController: AbortController | null = null;

  private iceServers: RTCIceServer[];
  private attemptsPerEndpoint: number;
  private resolvedEndpoints: PeerJSEndpoint[];
  private preferredEndpointId: string | null;
  private activeEndpoint: PeerJSEndpoint | null = null;
  private endpointListeners = new Set<(endpoint: PeerJSEndpoint | null) => void>();

  constructor(localUserId: string, config: PeerJSSignalingConfiguration = createDefaultPeerJSSignalingConfig()) {
    this.localUserId = localUserId;
    console.log('[PeerJS] Initializing adapter for user:', localUserId);
    this.storedPeerId = this.loadPersistedPeerId();
    
    // Start pending connection monitor
    getPendingConnectionMonitor().start((peerId, duration) => {
      console.warn(`[PeerJS] Pending connection to ${peerId} timed out after ${duration}ms`);
      this.pendingConnections.delete(peerId);
      recordConnectionFailure(peerId);
      
      // Notify failure handlers
      for (const handler of this.connectionFailureHandlers) {
        handler(peerId, 'timeout', { duration, reason: 'pending-timeout' });
      }
    });

    const normalized = this.normalizeConfig(config);
    this.iceServers = normalized.iceServers;
    this.attemptsPerEndpoint = normalized.attemptsPerEndpoint;
    this.resolvedEndpoints = normalized.endpoints;
    this.preferredEndpointId = normalized.preferredEndpointId;
  }

  private normalizeConfig(config: PeerJSSignalingConfiguration) {
    const base = config ?? createDefaultPeerJSSignalingConfig();
    const endpoints = (base.endpoints?.length ? base.endpoints : createDefaultPeerJSSignalingConfig().endpoints)
      .map((endpoint, index) => this.normalizeEndpoint(endpoint, index));

    return {
      endpoints,
      iceServers: base.iceServers && base.iceServers.length > 0 ? base.iceServers : DEFAULT_ICE_SERVERS,
      attemptsPerEndpoint: Math.max(1, base.attemptsPerEndpoint ?? 3),
      preferredEndpointId: base.preferredEndpointId ?? null,
    };
  }

  private normalizeEndpoint(endpoint: PeerJSEndpointOptions, index: number): PeerJSEndpoint {
    const normalizedPath = endpoint.path
      ? endpoint.path.startsWith('/')
        ? endpoint.path
        : `/${endpoint.path}`
      : '/';
    const id = endpoint.id ?? `${endpoint.host}:${endpoint.port}${normalizedPath}`;
    const label = endpoint.label ?? endpoint.host ?? `endpoint-${index}`;

    return {
      id,
      label,
      host: endpoint.host,
      port: endpoint.port,
      secure: endpoint.secure,
      path: normalizedPath,
    };
  }

  private getPrioritizedEndpoints(): PeerJSEndpoint[] {
    const endpoints = [...this.resolvedEndpoints];
    if (!this.preferredEndpointId) {
      return endpoints;
    }

    const index = endpoints.findIndex((endpoint) => endpoint.id === this.preferredEndpointId);
    if (index > 0) {
      const [preferred] = endpoints.splice(index, 1);
      endpoints.unshift(preferred);
    }
    return endpoints;
  }

  private notifyEndpointListeners(endpoint: PeerJSEndpoint | null): void {
    for (const listener of this.endpointListeners) {
      try {
        listener(endpoint);
      } catch (error) {
        console.warn('[PeerJS] Endpoint listener threw an error', error);
      }
    }
  }

  setPreferredEndpoint(id: string | null): void {
    this.preferredEndpointId = id;
  }

  getActiveEndpoint(): PeerJSEndpoint | null {
    return this.activeEndpoint;
  }

  subscribeToEndpointChanges(listener: (endpoint: PeerJSEndpoint | null) => void): () => void {
    this.endpointListeners.add(listener);
    if (this.activeEndpoint) {
      try {
        listener(this.activeEndpoint);
      } catch (error) {
        console.warn('[PeerJS] Endpoint listener threw during sync', error);
      }
    }

    return () => {
      this.endpointListeners.delete(listener);
    };
  }

  onConnectionFailure(
    handler: (peerId: string, reason: 'timeout' | 'error', context?: Record<string, unknown>) => void
  ): void {
    this.connectionFailureHandlers.push(handler);
  }

  private formatEndpointUrl(endpoint: PeerJSEndpoint): string {
    const protocol = endpoint.secure ? 'wss' : 'ws';
    return `${protocol}://${endpoint.host}:${endpoint.port}${endpoint.path}`;
  }

  private buildEndpointContext(endpoint: PeerJSEndpoint) {
    return {
      id: endpoint.id,
      label: endpoint.label,
      host: endpoint.host,
      port: endpoint.port,
      secure: endpoint.secure,
      path: endpoint.path,
      url: this.formatEndpointUrl(endpoint),
    };
  }

  private waitFor(duration: number, abortSignal: AbortSignal): Promise<void> {
    if (duration <= 0) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      if (abortSignal.aborted) {
        reject(new Error('Connection aborted by user'));
        return;
      }

      const timeout = setTimeout(() => {
        abortSignal.removeEventListener('abort', onAbort);
        resolve();
      }, duration);

      const onAbort = () => {
        clearTimeout(timeout);
        abortSignal.removeEventListener('abort', onAbort);
        reject(new Error('Connection aborted by user'));
      };

      abortSignal.addEventListener('abort', onAbort);
    });
  }

  private connectWithEndpoint(
    endpoint: PeerJSEndpoint,
    attempt: number,
    abortSignal: AbortSignal
  ): Promise<string> {
    const endpointContext = this.buildEndpointContext(endpoint);
    const targetPeerId = this.ensurePeerId();

    return new Promise((resolve, reject) => {
      if (abortSignal.aborted) {
        reject(new Error('Connection aborted by user'));
        return;
      }

      let resolved = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const connectionStartTime = Date.now();

      const cleanup = () => {
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        abortSignal.removeEventListener('abort', onAbort);
      };

      const fail = (error: Error) => {
        cleanup();
        if (resolved) {
          return;
        }
        resolved = true;
        this.isSignalingConnected = false;
        try {
          this.peer?.destroy();
        } catch (destroyError) {
          console.warn('[PeerJS] Error during peer destruction', destroyError);
        }
        this.peer = null;
        this.activeEndpoint = null;
        this.notifyEndpointListeners(null);
        reject(error);
      };

      const onAbort = () => {
        fail(new Error('Connection aborted by user'));
      };

      abortSignal.addEventListener('abort', onAbort);

      if (this.peer && !this.peer.destroyed) {
        try {
          this.peer.destroy();
        } catch (error) {
          console.warn('[PeerJS] Error destroying previous Peer instance', error);
        }
      }

      console.log(
        `[PeerJS] 🔌 Connection attempt ${attempt}/${this.attemptsPerEndpoint} via ${endpoint.label} (${endpointContext.url})`
      );
      recordP2PDiagnostic({
        level: 'info',
        source: 'peerjs',
        code: 'init-attempt',
        message: 'Attempting PeerJS signaling connection',
        context: {
          ...endpointContext,
          attempt,
          attemptsPerEndpoint: this.attemptsPerEndpoint,
        },
      });

      this.peer = new Peer(targetPeerId, {
        debug: 2,
        host: endpoint.host,
        port: endpoint.port,
        secure: endpoint.secure,
        path: endpoint.path,
        config: {
          iceServers: this.iceServers,
        },
      });

      const handleSuccess = (id: string) => {
        cleanup();
        if (resolved) {
          return;
        }
        resolved = true;

        const connectionTime = Date.now() - connectionStartTime;
        this.peerId = id;
        this.isSignalingConnected = true;
        this.persistPeerId(id);

        console.log(`[PeerJS] ✅ Connected to ${endpoint.label} in ${connectionTime}ms`);
        recordP2PDiagnostic({
          level: 'info',
          source: 'peerjs',
          code: 'init-success',
          message: 'PeerJS signaling connection established',
          context: {
            ...endpointContext,
            peerId: id,
            connectionTime,
          },
        });

        this.readyHandlers.forEach((handler) => handler());
        resolve(id);
      };

      this.peer.on('open', handleSuccess);

      this.peer.on('error', (error) => {
        const connectionTime = Date.now() - connectionStartTime;
        console.error(`[PeerJS] ❌ Error connecting to ${endpoint.label} after ${connectionTime}ms:`, error);
        recordP2PDiagnostic({
          level: 'error',
          source: 'peerjs',
          code: 'peer-error',
          message: error?.message ?? 'PeerJS reported an unknown error',
          context: {
            ...endpointContext,
            connectionTime,
            type: error?.type,
          },
        });

        if (this.isUnavailableIdError(error)) {
          console.warn('[PeerJS] Peer ID conflict detected, generating new ID...');
          this.handleUnavailablePeerId();
        }

        fail(new Error('PeerJS connection failed: ' + (error?.message || 'Network error')));
      });

      this.peer.on('connection', (conn) => {
        console.log('[PeerJS] Incoming connection from:', conn.peer);
        this.handleIncomingConnection(conn);
      });

      this.peer.on('disconnected', () => {
        const connectionTime = Date.now() - connectionStartTime;
        console.log(
          `[PeerJS] ⚠️ Disconnected from signaling server ${endpoint.label} after ${connectionTime}ms`
        );
        recordP2PDiagnostic({
          level: 'warn',
          source: 'peerjs',
          code: 'signaling-disconnected',
          message: 'Lost connection to PeerJS signaling server',
          context: {
            ...endpointContext,
            connectionTime,
          },
        });
        this.isSignalingConnected = false;
        this.signalingDisconnectedHandlers.forEach((handler) => handler());

        if (this.peer && this.peerId) {
          console.log('[PeerJS] 🔄 Auto-reconnect in 3s...');
          setTimeout(() => {
            if (this.peer && !this.peer.destroyed) {
              console.log('[PeerJS] Calling peer.reconnect()...');
              this.peer.reconnect();
            }
          }, 3000);
        }
      });

      timeoutHandle = setTimeout(() => {
        if (resolved || abortSignal.aborted) {
          return;
        }

        const elapsedTime = Date.now() - connectionStartTime;
        console.warn(
          `[PeerJS] ⏱️ Timeout after ${elapsedTime}ms (no response from signaling server ${endpoint.label})`
        );
        recordP2PDiagnostic({
          level: 'warn',
          source: 'peerjs',
          code: 'init-timeout-warning',
          message: 'PeerJS signaling attempt timed out',
          context: {
            ...endpointContext,
            elapsedTime,
            attempt,
          },
        });

        fail(
          new Error(
            'PeerJS connection timeout - signaling server may be unavailable or blocked by network'
          )
        );
      }, INIT_TIMEOUT_MS);
    });
  }

  /**
   * Initialize PeerJS with configured signaling endpoints and retry strategy
   */
  async initialize(): Promise<string> {
    if (this.initAbortController) {
      this.initAbortController.abort();
    }

    this.initAbortController = new AbortController();
    const abortSignal = this.initAbortController.signal;

    const endpoints = this.getPrioritizedEndpoints();
    if (endpoints.length === 0) {
      throw new Error('No PeerJS signaling endpoints configured');
    }

    let lastError: Error | null = null;

    for (let index = 0; index < endpoints.length; index++) {
      const endpoint = endpoints[index];
      const endpointContext = this.buildEndpointContext(endpoint);
      console.log(`[PeerJS] 📡 Attempting signaling via ${endpoint.label} (${endpointContext.url})`);

      for (let attempt = 1; attempt <= this.attemptsPerEndpoint; attempt++) {
        if (abortSignal.aborted) {
          throw new Error('Connection aborted by user');
        }

        try {
          const peerId = await this.connectWithEndpoint(endpoint, attempt, abortSignal);
          this.activeEndpoint = endpoint;
          this.preferredEndpointId = endpoint.id;
          this.notifyEndpointListeners(endpoint);
          this.initAbortController = null;
          return peerId;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          if (abortSignal.aborted) {
            throw lastError;
          }

          const context = {
            ...endpointContext,
            attempt,
            attemptsPerEndpoint: this.attemptsPerEndpoint,
            reason: lastError.message,
          };

          recordP2PDiagnostic({
            level: 'warn',
            source: 'peerjs',
            code: 'init-attempt-failed',
            message: 'PeerJS signaling attempt failed',
            context,
          });

          const remainingAttempts = this.attemptsPerEndpoint - attempt;
          if (remainingAttempts > 0) {
            const delay = Math.min(1500 * Math.pow(1.3, attempt - 1), 5000);
            console.log(
              `[PeerJS] 🔄 Retrying ${endpoint.label} in ${delay}ms (attempt ${attempt + 1}/${this.attemptsPerEndpoint})...`
            );
            try {
              await this.waitFor(delay, abortSignal);
            } catch (abortError) {
              throw abortError instanceof Error ? abortError : new Error(String(abortError));
            }
          }
        }
      }

      const exhaustedLevel = index < endpoints.length - 1 ? 'warn' : 'error';
      console.warn(`[PeerJS] ❌ Exhausted attempts for ${endpoint.label}; moving to next endpoint if available.`);
      recordP2PDiagnostic({
        level: exhaustedLevel,
        source: 'peerjs',
        code: 'endpoint-exhausted',
        message: 'All attempts failed for signaling endpoint',
        context: {
          ...endpointContext,
          attemptsPerEndpoint: this.attemptsPerEndpoint,
        },
      });
    }

    this.activeEndpoint = null;
    this.notifyEndpointListeners(null);

    throw lastError ?? new Error('PeerJS connection failed: no signaling endpoints succeeded');
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

    // Check pending connections via monitor
    const pendingMonitor = getPendingConnectionMonitor();
    if (pendingMonitor.isPending(remotePeerId)) {
      console.log(`[PeerJS] Connection to ${remotePeerId} is already pending`);
      return;
    }

    // Check backoff status
    if (!canAttemptConnection(remotePeerId)) {
      const backoffState = getBackoffState(remotePeerId);
      if (backoffState?.circuitOpen) {
        console.warn(`[PeerJS] Circuit breaker open for ${remotePeerId} (${backoffState.failureCount} failures)`);
      } else {
        console.log(`[PeerJS] ${remotePeerId} in backoff period`);
      }
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
    pendingMonitor.add(remotePeerId, 'manual');
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

    const emitFailure = (reason: 'timeout' | 'error', context?: Record<string, unknown>) => {
      for (const handler of this.connectionFailureHandlers) {
        try {
          handler(conn.peer, reason, context);
        } catch (error) {
          console.warn('[PeerJS] Connection failure handler threw', error);
        }
      }
    };

    if (!conn.open) {
      handshakeTimeout = setTimeout(() => {
      if (!conn.open) {
        console.warn(
          `[PeerJS] ⏳ Connection to ${conn.peer} did not open within ${CONNECTION_TIMEOUT_MS}ms; closing stalled channel`
        );
        this.pendingConnections.delete(conn.peer);
        getPendingConnectionMonitor().remove(conn.peer);
        recordConnectionFailure(conn.peer);
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
        emitFailure('timeout', { timeoutMs: CONNECTION_TIMEOUT_MS });
      }
      }, CONNECTION_TIMEOUT_MS);
    }

    conn.on('open', () => {
      clearHandshakeTimeout();
      const elapsed = Date.now() - connectionStartedAt;
      console.log('[PeerJS] ✅ Connection established with:', conn.peer, `(${elapsed}ms)`);
      this.pendingConnections.delete(conn.peer);
      getPendingConnectionMonitor().remove(conn.peer);
      recordConnectionSuccess(conn.peer);
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
      getPendingConnectionMonitor().remove(conn.peer);
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
      getPendingConnectionMonitor().remove(conn.peer);
      recordConnectionFailure(conn.peer);
      this.disconnectionHandlers.forEach(h => h(conn.peer));
      recordP2PDiagnostic({
        level: 'error',
        source: 'peerjs',
        code: 'connection-error',
        message: error instanceof Error ? error.message : 'Unknown PeerJS connection error',
        context: { peerId: conn.peer }
      });
      emitFailure('error', {
        message: error instanceof Error ? error.message : String(error),
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

    // Stop pending connection monitor
    getPendingConnectionMonitor().stop();

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
