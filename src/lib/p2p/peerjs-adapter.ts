/**
 * PeerJS Adapter for P2P Networking
 * 
 * Uses PeerJS's cloud-hosted signaling server for cross-device discovery
 * while maintaining direct P2P data channels for actual content transfer.
 * 
 * ID Strategy:
 * - Primary: deterministic `peer-{nodeId}` for direct addressability
 * - Fallback: `peer-{nodeId}-{random}` when deterministic ID is still held by server
 * - nodeId is always included in connection metadata for identity resolution
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
const STABLE_NODE_ID_KEY = 'p2p-stable-node-id';
const ACTIVE_PEER_ID_KEY = 'p2p-active-peer-id';
const CONNECTION_TIMEOUT_MS = 20000;
const INIT_TIMEOUT_MS = 20000;

/**
 * Get or create a stable Node ID that persists across sessions.
 */
export function getStableNodeId(): string {
  try {
    const stored = localStorage.getItem(STABLE_NODE_ID_KEY);
    if (stored && stored.length >= 8) {
      return stored;
    }
  } catch (error) {
    console.warn('[PeerJS] Unable to read stable node ID:', error);
  }

  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  const nodeId = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  try {
    localStorage.setItem(STABLE_NODE_ID_KEY, nodeId);
    console.log('[PeerJS] Generated new stable node ID:', nodeId);
  } catch (error) {
    console.warn('[PeerJS] Unable to persist stable node ID:', error);
  }

  return nodeId;
}

/**
 * Get the current stable Node ID without creating a new one.
 */
export function getCurrentNodeId(): string | null {
  try {
    return localStorage.getItem(STABLE_NODE_ID_KEY);
  } catch {
    return null;
  }
}

/**
 * Get the currently active PeerJS ID for this node (may include session suffix).
 * Other same-origin tabs can use this to connect directly.
 */
export function getActivePeerId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PEER_ID_KEY);
  } catch {
    return null;
  }
}

type PeerWithPeerListing = Peer & {
  listAllPeers?: (callback: (peers: string[]) => void) => void;
};

export interface PeerJSMessage {
  type: string;
  payload: unknown;
  from: string;
  timestamp: number;
  nodeId?: string; // Stable node identity
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
  private pendingConnections = new Set<string>();
  private connectionMetadata = new Map<string, unknown>();
  private initAbortController: AbortController | null = null;
  private usedFallbackId = false;
  private hasLoggedPeerListingUnsupported = false;

  // Rate-limit protection: track last signaling attempt to avoid 429 cascades
  private lastSignalingAttemptAt = 0;
  private consecutiveSignalingFailures = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Node ID → PeerJS ID mapping for cross-device resolution
  private nodeIdToPeerId = new Map<string, string>();

  private iceServers: RTCIceServer[];
  private attemptsPerEndpoint: number;
  private resolvedEndpoints: PeerJSEndpoint[];
  private preferredEndpointId: string | null;
  private activeEndpoint: PeerJSEndpoint | null = null;
  private endpointListeners = new Set<(endpoint: PeerJSEndpoint | null) => void>();

  constructor(localUserId: string, config: PeerJSSignalingConfiguration = createDefaultPeerJSSignalingConfig()) {
    this.localUserId = localUserId;
    console.log('[PeerJS] Initializing adapter for user:', localUserId);
    
    // Start pending connection monitor
    getPendingConnectionMonitor().start((peerId, duration) => {
      console.warn(`[PeerJS] Pending connection to ${peerId} timed out after ${duration}ms`);
      this.pendingConnections.delete(peerId);
      recordConnectionFailure(peerId);
      
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

  private notifyConnectionFailure(
    peerId: string,
    reason: 'timeout' | 'error',
    context?: Record<string, unknown>
  ): void {
    for (const handler of this.connectionFailureHandlers) {
      try {
        handler(peerId, reason, context);
      } catch (error) {
        console.warn('[PeerJS] Connection failure handler threw', error);
      }
    }
  }

  private formatEndpointUrl(endpoint: PeerJSEndpoint): string {
    const protocol = endpoint.secure ? 'wss' : 'ws';
    return `${protocol}://${endpoint.host}:${endpoint.port}${endpoint.path}`;
  }

  /**
   * Compute the next reconnect delay based on consecutive failures.
   * Returns a jittered exponential backoff between 10s and 60s.
   */
  private getSignalingBackoffMs(): number {
    const base = 10_000;
    const max = 60_000;
    const exp = Math.min(base * Math.pow(2, this.consecutiveSignalingFailures), max);
    const jitter = exp * (0.5 + Math.random() * 0.5);
    return Math.round(jitter);
  }

  /**
   * Schedule a single reconnect attempt, cancelling any previously queued one.
   */
  private scheduleReconnect(reason: string): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const delay = this.getSignalingBackoffMs();
    console.log(`[PeerJS] 🔄 Scheduling reconnect in ${Math.round(delay / 1000)}s (${reason}, failures: ${this.consecutiveSignalingFailures})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.peer && !this.peer.destroyed && !this.isSignalingConnected) {
        console.log('[PeerJS] 🔌 Executing scheduled reconnect...');
        this.consecutiveSignalingFailures++;
        this.lastSignalingAttemptAt = Date.now();
        try {
          this.peer.reconnect();
        } catch (err) {
          console.warn('[PeerJS] Scheduled reconnect failed:', err);
        }
      }
    }, delay);
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

  /**
   * Generate the primary (deterministic) peer ID
   */
  private generatePrimaryPeerId(): string {
    const nodeId = getStableNodeId();
    return `peer-${nodeId}`;
  }

  /**
   * Generate a fallback peer ID with random session suffix.
   * Used when the deterministic ID is still held by the signaling server.
   */
  private generateFallbackPeerId(): string {
    const nodeId = getStableNodeId();
    const suffix = Math.random().toString(36).slice(2, 6);
    return `peer-${nodeId}-${suffix}`;
  }

  /**
   * Attempt to connect with a specific peer ID on an endpoint.
   */
  private connectWithPeerId(
    targetPeerId: string,
    endpoint: PeerJSEndpoint,
    abortSignal: AbortSignal
  ): Promise<string> {
    const endpointContext = this.buildEndpointContext(endpoint);

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
        if (resolved) return;
        resolved = true;
        this.isSignalingConnected = false;
        if (this.peer && !this.peer.destroyed) {
          try {
            this.peer.destroy();
          } catch {
            // Ignore teardown errors during failed initialization
          }
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

      // Always create a fresh Peer instance to avoid stale state
      if (this.peer && !this.peer.destroyed) {
        try { this.peer.destroy(); } catch {}
      }

      console.log(`[PeerJS] 🔌 Registering as ${targetPeerId} via ${endpoint.label}`);
      recordP2PDiagnostic({
        level: 'info',
        source: 'peerjs',
        code: 'init-attempt',
        message: 'Attempting PeerJS signaling connection',
        context: { ...endpointContext, peerId: targetPeerId },
      });

      this.peer = new Peer(targetPeerId, {
        debug: 1,
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
        if (resolved) return;
        resolved = true;

        const connectionTime = Date.now() - connectionStartTime;
        this.peerId = id;
        this.isSignalingConnected = true;
        this.consecutiveSignalingFailures = 0; // Reset on success

        // Persist active peer ID so other same-origin processes can find us
        try {
          localStorage.setItem(ACTIVE_PEER_ID_KEY, id);
        } catch {}

        console.log(`[PeerJS] ✅ Connected as ${id} via ${endpoint.label} in ${connectionTime}ms`);
        recordP2PDiagnostic({
          level: 'info',
          source: 'peerjs',
          code: 'init-success',
          message: 'PeerJS signaling connection established',
          context: { ...endpointContext, peerId: id, connectionTime },
        });

        this.readyHandlers.forEach((handler) => handler());
        resolve(id);
      };

      this.peer.on('open', handleSuccess);

      this.peer.on('error', (error) => {
        const connectionTime = Date.now() - connectionStartTime;
        console.error(`[PeerJS] ❌ Error with ${targetPeerId} on ${endpoint.label} after ${connectionTime}ms:`, error);
        recordP2PDiagnostic({
          level: 'error',
          source: 'peerjs',
          code: 'peer-error',
          message: error?.message ?? 'PeerJS reported an unknown error',
          context: { ...endpointContext, connectionTime, type: error?.type },
        });

        if (resolved) {
          // Post-open runtime errors should not tear down a healthy adapter instance.
          if (this.isSignalingRuntimeError(error)) {
            this.isSignalingConnected = false;
            this.signalingDisconnectedHandlers.forEach((handler) => handler());
            this.scheduleReconnect('runtime-signaling-error');
          }
          return;
        }

        if (this.isSignalingRuntimeError(error)) {
          console.warn(
            `[PeerJS] ⚠️ Transient signaling error during initialization for ${targetPeerId}; scheduling reconnect`
          );
          recordP2PDiagnostic({
            level: 'warn',
            source: 'peerjs',
            code: 'init-transient-error',
            message: 'Transient signaling error during PeerJS initialization',
            context: { ...endpointContext, connectionTime, type: error?.type },
          });
          this.scheduleReconnect('init-transient-error');
          return;
        }

        // Clean up the failed peer instance
        if (this.peer && !this.peer.destroyed) {
          try { this.peer.destroy(); } catch {}
        }

        fail(new Error('PeerJS connection failed: ' + (error?.message || 'Network error')));
      });

      this.peer.on('connection', (conn) => {
        if (!conn || typeof conn.peer !== 'string') {
          console.warn('[PeerJS] Ignoring malformed incoming connection');
          return;
        }
        console.log('[PeerJS] Incoming connection from:', conn.peer);
        this.handleIncomingConnection(conn);
      });

      this.peer.on('disconnected', () => {
        const connectionTime = Date.now() - connectionStartTime;
        console.log(`[PeerJS] ⚠️ Disconnected from ${endpoint.label} after ${connectionTime}ms`);
        recordP2PDiagnostic({
          level: 'warn',
          source: 'peerjs',
          code: 'signaling-disconnected',
          message: 'Lost connection to PeerJS signaling server',
          context: { ...endpointContext, connectionTime },
        });
        this.isSignalingConnected = false;
        this.signalingDisconnectedHandlers.forEach((handler) => handler());

        // Auto-reconnect using rate-limited backoff (prevents 429 cascades)
        if (this.peer && !this.peer.destroyed && this.peerId) {
          this.scheduleReconnect('signaling-disconnected');
        }
      });

      timeoutHandle = setTimeout(() => {
        if (resolved || abortSignal.aborted) return;
        const elapsedTime = Date.now() - connectionStartTime;
        console.warn(`[PeerJS] ⏱️ Timeout for ${targetPeerId} after ${elapsedTime}ms`);
        fail(new Error('PeerJS connection timeout'));
      }, INIT_TIMEOUT_MS);
    });
  }

  /**
   * Initialize PeerJS with automatic ID conflict resolution.
   * 
   * Strategy:
   * 1. Try deterministic `peer-{nodeId}` first (enables direct addressing)
   * 2. If "ID is taken" (stale session from refresh), immediately try `peer-{nodeId}-{random}`
   * 3. No long waits — fallback is instantaneous
   */
  async initialize(): Promise<string> {
    // If an initialization is already in-flight, don't abort it — just wait
    // for it to finish. Aborting causes "Connection aborted by user" errors
    // when disconnect handlers fire during the initial handshake.
    if (this.initAbortController && !this.initAbortController.signal.aborted) {
      throw new Error('PeerJS initialization already in progress');
    }

    this.initAbortController = new AbortController();
    const abortSignal = this.initAbortController.signal;
    this.usedFallbackId = false;

    const endpoints = this.getPrioritizedEndpoints();
    if (endpoints.length === 0) {
      throw new Error('No PeerJS signaling endpoints configured');
    }

    let lastError: Error | null = null;

    for (const endpoint of endpoints) {
      const endpointContext = this.buildEndpointContext(endpoint);
      for (let attempt = 1; attempt <= this.attemptsPerEndpoint; attempt += 1) {
        console.log(
          `[PeerJS] 📡 Attempting signaling via ${endpoint.label} (${endpointContext.url}) [${attempt}/${this.attemptsPerEndpoint}]`
        );

        if (abortSignal.aborted) {
          throw new Error('Connection aborted by user');
        }

        // ── Step 1: Try deterministic ID ──
        const primaryId = this.generatePrimaryPeerId();
        try {
          const peerId = await this.connectWithPeerId(primaryId, endpoint, abortSignal);
          this.activeEndpoint = endpoint;
          this.preferredEndpointId = endpoint.id;
          this.notifyEndpointListeners(endpoint);
          this.initAbortController = null;
          console.log('[PeerJS] ✅ Connected with deterministic ID:', peerId);
          return peerId;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          if (abortSignal.aborted) throw lastError;

          const isIdTaken = this.isUnavailableIdError(lastError);

          if (isIdTaken) {
            // ── Step 2: Immediate fallback to random suffix ──
            console.log('[PeerJS] 🔄 Deterministic ID held by server — using session-unique fallback');
            const fallbackId = this.generateFallbackPeerId();

            try {
              const peerId = await this.connectWithPeerId(fallbackId, endpoint, abortSignal);
              this.activeEndpoint = endpoint;
              this.preferredEndpointId = endpoint.id;
              this.usedFallbackId = true;
              this.notifyEndpointListeners(endpoint);
              this.initAbortController = null;
              console.log('[PeerJS] ✅ Connected with fallback ID:', peerId);
              recordP2PDiagnostic({
                level: 'info',
                source: 'peerjs',
                code: 'fallback-id-success',
                message: 'Connected using session-unique fallback ID after deterministic conflict',
                context: { primaryId, fallbackId: peerId },
              });
              return peerId;
            } catch (fallbackError) {
              lastError = fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError));
              if (abortSignal.aborted) throw lastError;
            }
          }

          const hasMoreAttempts = attempt < this.attemptsPerEndpoint;
          if (!hasMoreAttempts) {
            break;
          }

          const delay = Math.min(8000 * Math.pow(2, attempt - 1), 30000);
          console.log(`[PeerJS] 🔄 Retrying ${endpoint.label} in ${Math.round(delay)}ms...`);
          try {
            await this.waitFor(delay, abortSignal);
          } catch (abortError) {
            throw abortError instanceof Error ? abortError : new Error(String(abortError));
          }
        }
      }
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
    }
  }

  /**
   * Whether we're using a fallback (non-deterministic) peer ID this session
   */
  isUsingFallbackId(): boolean {
    return this.usedFallbackId;
  }

  /**
   * Whether an initialization attempt is currently in progress.
   */
  isInitializing(): boolean {
    return this.initAbortController !== null && !this.initAbortController.signal.aborted;
  }

  /**
   * Register a node ID → peer ID mapping (learned from incoming connections)
   */
  registerNodeMapping(nodeId: string, peerId: string): void {
    if (nodeId && peerId) {
      this.nodeIdToPeerId.set(nodeId, peerId);
    }
  }

  /**
   * Look up the current peer ID for a given node ID
   */
  resolveNodeId(nodeId: string): string | null {
    return this.nodeIdToPeerId.get(nodeId) ?? null;
  }

  /**
   * Get all known node-to-peer mappings
   */
  getNodeMappings(): Map<string, string> {
    return new Map(this.nodeIdToPeerId);
  }

  /**
   * Connect to a remote peer by their peer ID
   */
  connectToPeer(remotePeerId: string): boolean {
    if (!this.peer || this.peer.destroyed || !this.isSignalingActive()) {
      console.error('[PeerJS] Cannot connect: not initialized');
      return false;
    }

    if (this.connections.has(remotePeerId)) {
      console.log('[PeerJS] Already connected to', remotePeerId);
      return false;
    }

    const pendingMonitor = getPendingConnectionMonitor();
    if (pendingMonitor.isPending(remotePeerId)) {
      console.log(`[PeerJS] Connection to ${remotePeerId} is already pending`);
      return false;
    }

    if (!canAttemptConnection(remotePeerId)) {
      const backoffState = getBackoffState(remotePeerId);
      if (backoffState?.circuitOpen) {
        console.warn(`[PeerJS] Circuit breaker open for ${remotePeerId}`);
      } else {
        console.log(`[PeerJS] ${remotePeerId} in backoff period`);
      }
      return false;
    }

    console.log('[PeerJS] Initiating connection to:', remotePeerId);
    recordP2PDiagnostic({
      level: 'info',
      source: 'peerjs',
      code: 'connect-request',
      message: 'Attempting to open peer connection',
      context: { peerId: remotePeerId }
    });

    // Include nodeId in metadata so remote peer can map us
    const nodeId = getStableNodeId();
    let conn: DataConnection | undefined;
    try {
      conn = this.peer.connect(remotePeerId, {
        reliable: true,
        metadata: { userId: this.localUserId, nodeId }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[PeerJS] Failed to start connection:', message);
      recordConnectionFailure(remotePeerId);
      this.notifyConnectionFailure(remotePeerId, 'error', {
        message,
        reason: 'connect-throw',
      });
      return false;
    }

    if (!conn) {
      console.warn(`[PeerJS] connect() returned no connection object for ${remotePeerId}`);
      recordConnectionFailure(remotePeerId);
      this.notifyConnectionFailure(remotePeerId, 'error', {
        message: 'Connection object was undefined',
        reason: 'connect-null',
      });
      return false;
    }

    this.pendingConnections.add(remotePeerId);
    pendingMonitor.add(remotePeerId, 'manual');
    this.handleIncomingConnection(conn);
    return true;
  }

  /**
   * Handle incoming connection setup
   */
  private handleIncomingConnection(conn: DataConnection): void {
    if (!conn || typeof conn.peer !== 'string') {
      console.warn('[PeerJS] Ignoring invalid connection handle');
      recordP2PDiagnostic({
        level: 'warn',
        source: 'peerjs',
        code: 'invalid-connection-handle',
        message: 'Received an invalid DataConnection handle',
      });
      return;
    }

    const connectionStartedAt = Date.now();
    let handshakeTimeout: ReturnType<typeof setTimeout> | null = null;

    const clearHandshakeTimeout = () => {
      if (handshakeTimeout) {
        clearTimeout(handshakeTimeout);
        handshakeTimeout = null;
      }
    };

    const emitFailure = (reason: 'timeout' | 'error', context?: Record<string, unknown>) => {
      this.notifyConnectionFailure(conn.peer, reason, context);
    };

    if (!conn.open) {
      handshakeTimeout = setTimeout(() => {
      if (!conn.open) {
        console.warn(`[PeerJS] ⏳ Connection to ${conn.peer} timed out after ${CONNECTION_TIMEOUT_MS}ms`);
        this.pendingConnections.delete(conn.peer);
        getPendingConnectionMonitor().remove(conn.peer);
        recordConnectionFailure(conn.peer);
        try { conn.close(); } catch {}
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

      // Extract nodeId from metadata and register mapping
      const metadata = conn.metadata as { nodeId?: string; userId?: string } | undefined;
      if (metadata?.nodeId) {
        this.registerNodeMapping(metadata.nodeId, conn.peer);
        console.log(`[PeerJS] 📋 Mapped node ${metadata.nodeId} → ${conn.peer}`);
      }

      this.connectionHandlers.forEach(h => h(conn.peer));
    });

    conn.on('data', (data) => {
      try {
        const message = data as PeerJSMessage;
        console.log(`[PeerJS] Received ${message.type} from ${conn.peer}`);
        
        // Track node mappings from message metadata
        if (message.nodeId) {
          this.registerNodeMapping(message.nodeId, conn.peer);
        }

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
    });

    conn.on('error', (error) => {
      clearHandshakeTimeout();
      console.error('[PeerJS] Connection error with', conn.peer, ':', error);
      this.connections.delete(conn.peer);
      this.pendingConnections.delete(conn.peer);
      getPendingConnectionMonitor().remove(conn.peer);
      recordConnectionFailure(conn.peer);
      this.disconnectionHandlers.forEach(h => h(conn.peer));
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
      return false;
    }

    const nodeId = getStableNodeId();
    const message: PeerJSMessage = {
      type,
      payload,
      from: this.peerId || 'unknown',
      timestamp: Date.now(),
      nodeId,
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
    const nodeId = getStableNodeId();
    const message: PeerJSMessage = {
      type,
      payload,
      from: this.peerId || 'unknown',
      timestamp: Date.now(),
      nodeId,
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

  onMessage(type: string, handler: (msg: PeerJSMessage) => void): void {
    this.messageHandlers.set(type, handler);
  }

  onConnection(handler: (peerId: string) => void): void {
    this.connectionHandlers.push(handler);
  }

  onDisconnection(handler: (peerId: string) => void): void {
    this.disconnectionHandlers.push(handler);
  }

  onReady(handler: () => void): void {
    this.readyHandlers.push(handler);
    if (this.peerId) {
      handler();
    }
  }

  onSignalingDisconnected(handler: () => void): void {
    this.signalingDisconnectedHandlers.push(handler);
  }

  isSignalingActive(): boolean {
    return this.isSignalingConnected && this.peer !== null && !this.peer.destroyed;
  }

  getPeerId(): string | null {
    return this.peerId;
  }

  getConnectedPeers(): string[] {
    return Array.from(this.connections.keys());
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  async listAllPeers(): Promise<string[]> {
    if (!this.peer || this.peer.destroyed || !this.isSignalingConnected) {
      return [];
    }

    if (
      this.activeEndpoint?.id === 'peerjs-cloud' ||
      this.activeEndpoint?.host === '0.peerjs.com'
    ) {
      if (!this.hasLoggedPeerListingUnsupported) {
        console.log('[PeerJS] ℹ️ Peer listing disabled on PeerJS Cloud endpoint; skipping inventory fetch');
        this.hasLoggedPeerListingUnsupported = true;
      }
      return [];
    }

    const peerWithPeerListing = this.peer as PeerWithPeerListing;
    if (typeof peerWithPeerListing.listAllPeers !== 'function') {
      console.log('[PeerJS] ℹ️ listAllPeers unavailable on current signaling endpoint');
      return [];
    }

    return await new Promise((resolve) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        console.warn('[PeerJS] listAllPeers timed out; proceeding without inventory');
        resolve([]);
      }, 2500);

      const complete = (peers: string[]) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        resolve(
          peers.filter((id) => typeof id === 'string' && id.length > 0 && id !== this.peerId)
        );
      };

      try {
        peerWithPeerListing.listAllPeers((peers) => {
          complete(Array.isArray(peers) ? peers : []);
        });
      } catch (error) {
        window.clearTimeout(timeout);
        settled = true;
        console.warn('[PeerJS] listAllPeers failed:', error);
        resolve([]);
      }
    });
  }

  isConnectedTo(peerId: string): boolean {
    return this.connections.has(peerId);
  }

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
   * Get the stable node ID for this peer
   */
  getNodeId(): string {
    return getStableNodeId();
  }

  destroy(): void {
    console.log('[PeerJS] Shutting down...');
    getPendingConnectionMonitor().stop();
    this.abortInitialization();

    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();
    this.pendingConnections.clear();

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    // Clear active peer ID
    try {
      localStorage.removeItem(ACTIVE_PEER_ID_KEY);
    } catch {}

    this.peerId = null;
    this.isSignalingConnected = false;
    console.log('[PeerJS] Shutdown complete');
  }

  private isUnavailableIdError(error: unknown): boolean {
    if (!error) return false;
    const maybePeerError = error as { type?: string; message?: string };
    if (maybePeerError.type === 'unavailable-id') return true;
    const message = maybePeerError.message ?? (typeof error === 'string' ? error : '');
    // Match "ID is taken", "ID \"peer-xxx\" is taken", "unavailable-id", etc.
    return typeof message === 'string' && /unavailable|is taken/i.test(message);
  }

  private isSignalingRuntimeError(error: unknown): boolean {
    const maybePeerError = error as { type?: string; message?: string } | null;
    const type = maybePeerError?.type ?? '';
    const message = maybePeerError?.message ?? (typeof error === 'string' ? error : '');
    const normalizedMessage = typeof message === 'string' ? message.toLowerCase() : '';

    return (
      type === 'socket-error' ||
      type === 'socket-closed' ||
      type === 'network' ||
      type === 'server-error' ||
      normalizedMessage.includes('socket') ||
      normalizedMessage.includes('network') ||
      normalizedMessage.includes('signaling')
    );
  }
}
