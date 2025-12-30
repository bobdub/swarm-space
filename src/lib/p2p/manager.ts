/**
 * P2P Manager - PeerJS Edition
 * 
 * Orchestrates peer-to-peer networking using PeerJS for signaling and discovery.
 * 
 * Architecture:
 * - PeerJS handles WebRTC signaling via cloud infrastructure (zero config)
 * - Direct P2P data channels for content transfer
 * - Local discovery tracking and content inventory
 * - Chunk protocol for file distribution
 * - Post synchronization across peers
 * 
 * External Dependency: PeerJS Cloud Signaling
 * This app uses PeerJS's free cloud-hosted signaling server for initial
 * peer discovery. Once peers connect, all data flows directly P2P.
 */

import {
  PeerJSAdapter,
  createDefaultPeerJSSignalingConfig,
  type PeerJSEndpoint,
  type PeerJSSignalingConfiguration,
} from './peerjs-adapter';
import { ChunkProtocol, type ChunkMessage, type ChunkTransferUpdate } from './chunkProtocol';
import { PeerDiscovery, type PeerHealthSnapshot, type PeerProfile } from './discovery';
import { PostSyncManager, type PostSyncMessage } from './postSync';
import { CommentSync, type CommentSyncMessage } from './commentSync';
import {
  getKnownPeerIds,
  isAutoConnectEnabled,
  updatePeerLastSeen,
  getLocalNodeId,
  isLocalNode
} from './knownPeers';
import {
  canAttemptConnection,
  getBackoffState,
  recordConnectionFailure as recordBackoffFailure,
  recordConnectionSuccess as recordBackoffSuccess,
  getBackoffStats
} from './connectionBackoff';
import {
  getConnectionQualityTracker,
  recordConnectionQualitySuccess,
  recordConnectionQualityFailure,
  getTopQualityPeers
} from './connectionQuality';
import {
  BootstrapRegistry,
  fetchBeaconPeers,
  fetchCapsulePeers,
  type BeaconEndpoint,
  type CapsuleSource,
  type RendezvousPeerRecord
} from './bootstrap';
import {
  ConnectionHealthMonitor,
  type ConnectionHealth,
  type ConnectionHealthSummary,
} from './connectionHealth';
import { PeerExchangeProtocol, type PEXMessage } from './peerExchange';
import { GossipProtocol, type GossipMessage } from './gossip';
import { RoomDiscovery } from './roomDiscovery';
import {
  createPresenceTicket,
  type PresenceTicketEnvelope,
  type PresenceTicketSigner
} from './presenceTicket';
import { getRendezvousSigner as loadRendezvousSigner, probeEd25519Support } from './rendezvousIdentity';
import { loadRendezvousConfig, type RendezvousMeshConfig } from './rendezvousConfig';
import type { Post } from '@/types';
import type { Comment } from '@/types';
import { createConnection, getConnectionByPeerId, getUserConnections, updateConnectionPeerId } from '../connections';
import type { Connection } from '../connections';
import { get, type Manifest, type Chunk } from '../store';
import {
  getP2PDiagnostics,
  recordP2PDiagnostic,
  type P2PDiagnosticEvent,
  type P2PDiagnosticsSubscriber
} from './diagnostics';
import { getFeatureFlags, subscribeToFeatureFlags, type FeatureFlags } from '@/config/featureFlags';
import type { TransportRuntimeStatus, TransportStateValue } from './transports/types';
export type { PeerJSEndpoint, PeerJSSignalingConfiguration } from './peerjs-adapter';

export interface P2PControlState {
  autoConnect: boolean;
  manualAccept: boolean;
  isolate: boolean;
  paused: boolean;
  pauseInbound: boolean;
  pauseOutbound: boolean;
}

export type P2PControlFlag = keyof P2PControlState;

export type ControlResumeTargets = Partial<Record<P2PControlFlag, number>>;

export interface ConnectOptions {
  manual?: boolean;
  source?: string;
  allowDuringIsolation?: boolean;
}
import { NodeMetricsTracker, type NodeMetricSnapshot } from './nodeMetrics';
import { ReplicationOrchestrator, type ReplicationReason, type ReplicaAdvertisement } from './replication';

export type P2PStatus = 'offline' | 'connecting' | 'waiting' | 'online';

export type P2PTransportKey = 'peerjs' | 'webtorrent' | 'gun' | 'integrated';

export interface P2PTransportStatus {
  id: P2PTransportKey;
  label: string;
  enabled: boolean;
  state: TransportStateValue;
  fallbackCount: number;
  lastFallbackAt: number | null;
  lastError: string | null;
  connectedPeers: number;
}

export interface P2PStats {
  status: P2PStatus;
  connectedPeers: number;
  discoveredPeers: number;
  localContent: number;
  networkContent: number;
  activeRequests: number;
  rendezvousPeers: number;
  lastRendezvousSync: number | null;
  uptimeMs: number;
  bytesUploaded: number;
  bytesDownloaded: number;
  relayCount: number;
  pingCount: number;
  connectionAttempts: number;
  successfulConnections: number;
  failedConnectionAttempts: number;
  rendezvousAttempts: number;
  rendezvousSuccesses: number;
  rendezvousFailures: number;
  rendezvousFailureStreak: number;
  timeToFirstPeerMs: number | null;
  lastBeaconLatencyMs: number | null;
  metrics: NodeMetricSnapshot;
  signalingEndpointUrl: string | null;
  signalingEndpointLabel: string | null;
  signalingEndpointId: string | null;
  transportFallbacks: number;
  lastTransportFallbackAt: number | null;
  transports: P2PTransportStatus[];
}

export interface PeerConnectionDetail {
  peerId: string;
  userId: string | null;
  profile?: PeerProfile;
  status: ConnectionHealth['status'];
  connectedAt: number | null;
  lastActivity: number | null;
  avgRttMs: number | null;
  lastSeenAt: number | null;
}

export interface PendingPeer {
  peerId: string;
  userId?: string | null;
  queuedAt: number;
}

export interface EnsureManifestOptions {
  includeChunks?: boolean;
  sourcePeerId?: string;
}

interface RendezvousOptions {
  enabled: boolean;
  config?: RendezvousMeshConfig;
}

interface P2PManagerOptions {
  rendezvous?: RendezvousOptions;
  controls?: P2PControlState;
  signaling?: PeerJSSignalingConfiguration;
}

export class P2PManager {
  private peerjs: PeerJSAdapter;
  private chunkProtocol: ChunkProtocol;
  private discovery: PeerDiscovery;
  private postSync: PostSyncManager;
  private commentSync: CommentSync;
  private bootstrap: BootstrapRegistry;
  private healthMonitor: ConnectionHealthMonitor;
  private peerExchange: PeerExchangeProtocol;
  private gossip: GossipProtocol;
  private roomDiscovery: RoomDiscovery;
  private status: P2PStatus = 'offline';
  private cleanupInterval?: number;
  private announceInterval?: number;
  private reconnectInterval?: number;
  private pingInterval?: number;
  private peerId: string | null = null;
  private options: P2PManagerOptions;
  private rendezvousConfig: RendezvousMeshConfig;
  private rendezvousEnabled: boolean;
  private rendezvousSignerPromise?: Promise<PresenceTicketSigner>;
  private rendezvousTicket?: PresenceTicketEnvelope;
  private rendezvousPeerCache: Map<string, RendezvousPeerRecord> = new Map();
  private lastRendezvousSync = 0;
  private rendezvousPollInterval?: number;
  private rendezvousInFlight = false;
  private rendezvousPendingStart = false;
  private rendezvousFailureStreak = 0;
  private rendezvousDisabledReason: 'user' | 'capability' | 'failure' | null = null;
  private ed25519Supported: boolean | null = null;
  private ed25519ProbePromise?: Promise<boolean>;
  private desiredConnectionFloor = 3;
  private maxMeshConnections = 8;
  private metrics: NodeMetricsTracker;
  private metricsEnabled = false;
  private knownConnections: Map<string, Connection> = new Map();
  private latestMetrics: NodeMetricSnapshot;
  private sessionStartedAt: number | null = null;
  private firstPeerConnectedAt: number | null = null;
  private timeToFirstPeerMs: number | null = null;
  private lastBeaconLatencyMs: number | null = null;
  private pendingPings: Map<string, number> = new Map();
  private controlState: P2PControlState;
  private controlStateListeners = new Set<(state: P2PControlState) => void>();
  private controlResumeListeners = new Set<(targets: ControlResumeTargets) => void>();
  private controlResumeTimers: Map<P2PControlFlag, number> = new Map();
  private controlResumeTargets: ControlResumeTargets = {};
  private blockedPeers: Set<string> = new Set();
  private pendingInboundPeers: Map<string, PendingPeer> = new Map();
  private pendingPeerListeners = new Set<(peers: PendingPeer[]) => void>();
  private pendingOutboundConnections: Set<string> = new Set();
  private commentCleanup?: () => void;
  private signalingConfig: PeerJSSignalingConfiguration;
  private activeSignalingEndpoint: PeerJSEndpoint | null = null;
  private webTorrentAdapter: any | null = null;
  private gunAdapter: any | null = null;
  private integratedAdapter: any | null = null;
  private transportStates: Record<P2PTransportKey, P2PTransportStatus>;
  private totalTransportFallbacks = 0;
  private lastTransportFallbackAt: number | null = null;
  private transportTelemetryEnabled = true;
  private featureFlagUnsubscribe?: () => void;
  private signalingEndpointListeners = new Set<(endpoint: PeerJSEndpoint | null) => void>();
  private unsubscribeEndpointChanges: (() => void) | null = null;
  private replication?: ReplicationOrchestrator;
  private replicationTargets: Map<string, number> = new Map();
  private readonly defaultReplicaTarget = 3;
  private readonly minReplicaFreeBytes = 25 * 1024 * 1024;

  constructor(private localUserId: string, options: P2PManagerOptions = {}) {
    console.log('[P2P] Initializing P2P Manager with PeerJS');
    console.log('[P2P] 🌐 Using PeerJS cloud signaling (zero config)');
    console.log('[P2P] 🔄 Pure P2P discovery via PEX + Gossip');
    console.log('[P2P] User ID:', localUserId);

    this.options = options;
    const rendezvousConfig = options.rendezvous?.config ?? loadRendezvousConfig();
    this.rendezvousConfig = rendezvousConfig;
    this.rendezvousEnabled = options.rendezvous?.enabled ?? false;

    this.latestMetrics = this.createEmptyMetricsSnapshot();
    this.metrics = new NodeMetricsTracker(localUserId, {
      onSnapshot: (snapshot) => {
        this.latestMetrics = snapshot;
      },
    });

    this.controlState = options.controls ?? {
      autoConnect: true,
      manualAccept: false,
      isolate: false,
      paused: false,
      pauseInbound: false,
      pauseOutbound: false,
    };

    this.signalingConfig = options.signaling ?? createDefaultPeerJSSignalingConfig();
    this.peerjs = new PeerJSAdapter(localUserId, this.signalingConfig);
    this.unsubscribeEndpointChanges = this.peerjs.subscribeToEndpointChanges((endpoint) => {
      this.activeSignalingEndpoint = endpoint;
      this.notifySignalingEndpointListeners(endpoint);
    });
    this.peerjs.onConnectionFailure((peerId, reason, context) => {
      if (this.metricsEnabled) {
        this.metrics.recordFailedConnection();
      }
      this.updateTransportState('peerjs', {
        state: 'degraded',
        lastError: typeof context?.message === 'string' ? context.message : reason,
      });
      recordP2PDiagnostic({
        level: reason === 'error' ? 'error' : 'warn',
        source: 'manager',
        code: 'connect-failed',
        message: 'Peer connection attempt failed',
        context: {
          peerId,
          reason,
          ...context,
        },
      });
    });
    this.discovery = new PeerDiscovery('pending', localUserId);
    this.bootstrap = new BootstrapRegistry();
    this.healthMonitor = new ConnectionHealthMonitor((peerId) => {
      console.log(`[P2P] Health monitor requesting reconnect to ${peerId}`);
      this.reconnectToPeer(peerId);
    });

    this.notifySignalingEndpointListeners(this.activeSignalingEndpoint);

    const initialFlags = getFeatureFlags();
    this.transportTelemetryEnabled = initialFlags.transportFallbackTelemetry;
    this.transportStates = {
      peerjs: {
        id: 'peerjs',
        label: 'PeerJS DataChannels',
        enabled: true,
        state: 'initializing',
        fallbackCount: 0,
        lastFallbackAt: null,
        lastError: null,
        connectedPeers: 0,
      },
      webtorrent: {
        id: 'webtorrent',
        label: 'WebTorrent Bridge',
        enabled: initialFlags.webTorrentTransport,
        state: initialFlags.webTorrentTransport ? 'initializing' : 'idle',
        fallbackCount: 0,
        lastFallbackAt: null,
        lastError: null,
        connectedPeers: 0,
      },
      gun: {
        id: 'gun',
        label: 'GUN Overlay',
        enabled: initialFlags.gunTransport,
        state: initialFlags.gunTransport ? 'initializing' : 'idle',
        fallbackCount: 0,
        lastFallbackAt: null,
        lastError: null,
        connectedPeers: 0,
      },
      integrated: {
        id: 'integrated',
        label: 'Integrated Resilient Transport',
        enabled: initialFlags.integratedTransport,
        state: initialFlags.integratedTransport ? 'initializing' : 'idle',
        fallbackCount: 0,
        lastFallbackAt: null,
        lastError: null,
        connectedPeers: 0,
      },
    };
    this.featureFlagUnsubscribe = subscribeToFeatureFlags((flags) => {
      this.syncTransportFlags(flags);
    });

    // Chunk protocol sends messages via PeerJS
    this.chunkProtocol = new ChunkProtocol(
      (peerId, message) => this.sendChunkThroughTransports(peerId, message),
      (update) => this.handleChunkTransfer(update)
    );

    // Post sync sends messages via PeerJS
    this.postSync = new PostSyncManager(
      (peerId, message) => this.peerjs.sendToPeer(peerId, 'post', message),
      () => this.peerjs.getConnectedPeers(),
      (manifestIds, sourcePeerId) => this.ensureManifestsAvailable(manifestIds, sourcePeerId)
    );

    // Comment sync sends messages via PeerJS
    this.commentSync = new CommentSync(
      (peerId, message) => this.peerjs.sendToPeer(peerId, 'comment', message),
      () => this.peerjs.getConnectedPeers()
    );

    // Peer Exchange Protocol - discover peers from peers
    this.peerExchange = new PeerExchangeProtocol(
      (peerId, type, payload) => this.peerjs.sendToPeer(peerId, type, payload),
      (newPeers) => this.handlePEXDiscovery(newPeers)
    );

    // Gossip Protocol - continuous peer broadcasting
    this.gossip = new GossipProtocol(
      () => this.getGossipPeerList(),
      (type, payload) => this.peerjs.broadcast(type, payload),
      (peers) => this.handleGossipPeers(peers)
    );

    // Room-based discovery for easy peer finding
    this.roomDiscovery = new RoomDiscovery((peerId) => {
      console.log('[P2P] Room discovery found peer:', peerId);
      this.connectToPeer(peerId, { source: 'room-discovery' });
    });

    this.setupEventHandlers();
  }

  private notifySignalingEndpointListeners(endpoint: PeerJSEndpoint | null): void {
    for (const listener of this.signalingEndpointListeners) {
      try {
        listener(endpoint);
      } catch (error) {
        console.warn('[P2P] Signaling endpoint listener threw', error);
      }
    }
  }

  private formatEndpointUrl(endpoint: PeerJSEndpoint): string {
    const protocol = endpoint.secure ? 'wss' : 'ws';
    return `${protocol}://${endpoint.host}:${endpoint.port}${endpoint.path}`;
  }

  private createEmptyMetricsSnapshot(): NodeMetricSnapshot {
    return {
      uptimeMs: 0,
      bytesUploaded: 0,
      bytesDownloaded: 0,
      relayCount: 0,
      pingCount: 0,
      connectionAttempts: 0,
      successfulConnections: 0,
      failedConnectionAttempts: 0,
      rendezvousAttempts: 0,
      rendezvousSuccesses: 0,
      rendezvousFailures: 0,
    };
  }

  setCommentCleanup(cleanup: (() => void) | null): void {
    this.commentCleanup = cleanup ?? undefined;
  }

  runCommentCleanup(): void {
    this.commentCleanup?.();
    this.commentCleanup = undefined;
  }

  getControlState(): P2PControlState {
    return { ...this.controlState };
  }

  getControlResumeTargets(): ControlResumeTargets {
    return { ...this.controlResumeTargets };
  }

  subscribeToControlState(listener: (state: P2PControlState) => void): () => void {
    this.controlStateListeners.add(listener);
    try {
      listener(this.getControlState());
    } catch (error) {
      console.warn('[P2P] Control state listener threw during initial emit', error);
    }
    return () => {
      this.controlStateListeners.delete(listener);
    };
  }

  subscribeToControlResumes(listener: (targets: ControlResumeTargets) => void): () => void {
    this.controlResumeListeners.add(listener);
    try {
      listener(this.getControlResumeTargets());
    } catch (error) {
      console.warn('[P2P] Control resume listener threw during initial emit', error);
    }
    return () => {
      this.controlResumeListeners.delete(listener);
    };
  }

  private emitControlState(): void {
    const snapshot = this.getControlState();
    for (const listener of this.controlStateListeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn('[P2P] Control state listener threw', error);
      }
    }
  }

  private emitControlResumes(): void {
    const snapshot = this.getControlResumeTargets();
    for (const listener of this.controlResumeListeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn('[P2P] Control resume listener threw', error);
      }
    }
  }

  private clearControlAutoResume(flag: P2PControlFlag): void {
    const timer = this.controlResumeTimers.get(flag);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.controlResumeTimers.delete(flag);
    }
    if (flag in this.controlResumeTargets) {
      delete this.controlResumeTargets[flag];
      this.emitControlResumes();
    }
  }

  private scheduleControlAutoResume(flag: P2PControlFlag, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      this.clearControlAutoResume(flag);
      return;
    }
    this.clearControlAutoResume(flag);
    const deadline = Date.now() + durationMs;
    this.controlResumeTargets[flag] = deadline;
    this.emitControlResumes();
    const timer = window.setTimeout(() => {
      this.controlResumeTimers.delete(flag);
      delete this.controlResumeTargets[flag];
      this.emitControlResumes();
      const update = { [flag]: false } as Partial<P2PControlState>;
      this.updateControlState(update);
    }, durationMs);
    this.controlResumeTimers.set(flag, timer);
  }

  applyControlFlag(flag: P2PControlFlag, value: boolean, options?: { autoResumeMs?: number }): void {
    const update = { [flag]: value } as Partial<P2PControlState>;
    this.updateControlState(update);
    if (value) {
      if (options?.autoResumeMs) {
        this.scheduleControlAutoResume(flag, options.autoResumeMs);
      } else {
        this.clearControlAutoResume(flag);
      }
    } else {
      this.clearControlAutoResume(flag);
    }
  }

  getDiagnosticEvents(): P2PDiagnosticEvent[] {
    return getP2PDiagnostics().getEvents();
  }

  subscribeToDiagnostics(listener: P2PDiagnosticsSubscriber): () => void {
    return getP2PDiagnostics().subscribe(listener);
  }

  getActiveSignalingEndpoint(): PeerJSEndpoint | null {
    return this.activeSignalingEndpoint;
  }

  subscribeToSignalingEndpoint(
    listener: (endpoint: PeerJSEndpoint | null) => void
  ): () => void {
    this.signalingEndpointListeners.add(listener);
    try {
      listener(this.activeSignalingEndpoint);
    } catch (error) {
      console.warn('[P2P] Signaling endpoint listener threw during initial emit', error);
    }

    return () => {
      this.signalingEndpointListeners.delete(listener);
    };
  }

  clearDiagnostics(): void {
    getP2PDiagnostics().clear();
  }

  updateControlState(update: Partial<P2PControlState>): void {
    const previous = this.controlState;
    this.controlState = { ...this.controlState, ...update };
    console.log('[P2P] ⚙️ Control state updated:', this.controlState);

    for (const key of Object.keys(update) as P2PControlFlag[]) {
      if (!this.controlState[key]) {
        this.clearControlAutoResume(key);
      }
    }

    if (update.paused !== undefined && update.paused !== previous.paused) {
      if (update.paused) {
        this.status = 'waiting';
      }
    }

    if (previous.manualAccept && !this.controlState.manualAccept) {
      this.releasePendingPeers('manual-accept-disabled');
    }

    this.emitControlState();
  }

  setBlockedPeers(peers: string[]): void {
    this.blockedPeers = new Set((peers || []).filter(Boolean));
    this.enforceBlockedPeers();
    let queueChanged = false;
    for (const peerId of Array.from(this.pendingInboundPeers.keys())) {
      if (this.blockedPeers.has(peerId)) {
        this.pendingInboundPeers.delete(peerId);
        queueChanged = true;
      }
    }
    if (queueChanged) {
      this.emitPendingPeerUpdate();
    }
  }

  private isPeerBlocked(peerId: string | null | undefined): boolean {
    return !!peerId && this.blockedPeers.has(peerId);
  }

  getPendingPeers(): PendingPeer[] {
    return Array.from(this.pendingInboundPeers.values()).sort((a, b) => a.queuedAt - b.queuedAt);
  }

  subscribeToPendingPeers(listener: (peers: PendingPeer[]) => void): () => void {
    this.pendingPeerListeners.add(listener);
    try {
      listener(this.getPendingPeers());
    } catch (error) {
      console.warn('[P2P] Pending peer listener threw during initial emit', error);
    }
    return () => {
      this.pendingPeerListeners.delete(listener);
    };
  }

  approvePendingPeer(peerId: string): boolean {
    const pending = this.pendingInboundPeers.get(peerId);
    if (!pending) {
      return false;
    }

    const connected = this.connectToPeer(peerId, {
      manual: true,
      source: 'manual-approval',
      allowDuringIsolation: true,
    });

    if (connected) {
      this.pendingInboundPeers.delete(peerId);
      this.emitPendingPeerUpdate();
    }

    return connected;
  }

  rejectPendingPeer(peerId: string): void {
    if (this.pendingInboundPeers.delete(peerId)) {
      console.log(`[P2P] ❎ Pending peer rejected: ${peerId}`);
      this.emitPendingPeerUpdate();
    }
    this.peerjs.disconnectFrom(peerId);
  }

  private emitPendingPeerUpdate(): void {
    const snapshot = this.getPendingPeers();
    for (const listener of this.pendingPeerListeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn('[P2P] Pending peer listener error', error);
      }
    }
  }

  private queueInboundPeer(peerId: string): void {
    const metadata = this.peerjs.getConnectionMetadata(peerId);
    const userId = this.extractUserId(metadata);
    const existing = this.pendingInboundPeers.get(peerId);
    const queuedAt = existing?.queuedAt ?? Date.now();
    this.pendingInboundPeers.set(peerId, {
      peerId,
      userId: userId ?? existing?.userId ?? null,
      queuedAt,
    });
    console.log(`[P2P] ⏳ Queued inbound peer ${peerId}${userId ? ` (user: ${userId})` : ''} for manual approval`);
    this.emitPendingPeerUpdate();
  }

  private extractUserId(metadata: unknown): string | undefined {
    if (!metadata || typeof metadata !== 'object') {
      return undefined;
    }
    const candidate = (metadata as { userId?: unknown }).userId;
    return typeof candidate === 'string' ? candidate : undefined;
  }

  private releasePendingPeers(source: string): void {
    if (this.pendingInboundPeers.size === 0) {
      return;
    }

    console.log(`[P2P] Releasing ${this.pendingInboundPeers.size} pending peers (${source})`);
    let changed = false;
    for (const pending of this.getPendingPeers()) {
      const connected = this.connectToPeer(pending.peerId, {
        manual: true,
        source,
        allowDuringIsolation: true,
      });
      if (connected) {
        this.pendingInboundPeers.delete(pending.peerId);
        changed = true;
      }
    }

    if (changed) {
      this.emitPendingPeerUpdate();
    }
  }

  private enforceBlockedPeers(): void {
    const connected = this.peerjs.getConnectedPeers();
    for (const peerId of connected) {
      if (this.blockedPeers.has(peerId)) {
        console.log(`[P2P] 🚫 Disconnecting blocked peer: ${peerId}`);
        this.peerjs.disconnectFrom(peerId);
        const lostContent = this.discovery.removePeer(peerId);
        this.requestReplication(lostContent, 'rebalance');
      }
    }
  }

  private capturePeerHealthSnapshot(peerId: string): PeerHealthSnapshot | undefined {
    const health = this.healthMonitor.getConnectionHealth(peerId);
    if (!health) {
      return undefined;
    }

    return {
      status: health.status,
      avgRtt: health.avgRtt,
      updatedAt: Date.now()
    };
  }

  private updateDiscoveryHealth(peerId: string): void {
    const snapshot = this.capturePeerHealthSnapshot(peerId);
    if (snapshot) {
      this.discovery.updatePeerHealth(peerId, snapshot);
    }
  }

  private requestReplication(manifestHashes: string[], reason: ReplicationReason = 'shortfall'): void {
    if (!this.replication || manifestHashes.length === 0) {
      return;
    }

    const unique = Array.from(new Set(manifestHashes.filter(hash => typeof hash === 'string' && hash.length > 0)));
    for (const manifestId of unique) {
      const target = this.replicationTargets.get(manifestId) ?? this.defaultReplicaTarget;
      if (!this.replicationTargets.has(manifestId)) {
        this.replicationTargets.set(manifestId, target);
      }
      void this.replication
        .ensureRedundancy(manifestId, target, reason)
        .catch((error) => {
          console.warn('[P2P] Replication request failed', manifestId, error);
        });
    }
  }

  private isPaused(): boolean {
    return this.controlState.paused;
  }

  private canAutoConnect(): boolean {
    if (this.controlState.paused) {
      return false;
    }
    if (!this.controlState.autoConnect) {
      return false;
    }
    if (this.controlState.manualAccept) {
      return false;
    }
    if (this.controlState.isolate) {
      return false;
    }
    if (this.controlState.pauseOutbound) {
      return false;
    }
    return true;
  }

  /**
   * Start P2P networking
   */
  async start(): Promise<void> {
    console.log('[P2P] 🚀 Starting P2P manager...');
    console.log('[P2P] User ID:', this.localUserId);
    this.status = 'connecting';
    this.sessionStartedAt = Date.now();
    this.firstPeerConnectedAt = null;
    this.timeToFirstPeerMs = null;
    this.lastBeaconLatencyMs = null;
    recordP2PDiagnostic({
      level: 'info',
      source: 'manager',
      code: 'manager-start',
      message: 'Starting P2P manager',
      context: { userId: this.localUserId }
    });

    try {
      try {
        await this.metrics.initialize();
        this.metricsEnabled = true;
      } catch (error) {
        this.metricsEnabled = false;
        console.warn('[P2P] ⚠️ Node metrics unavailable - continuing without telemetry', error);
        recordP2PDiagnostic({
          level: 'warn',
          source: 'manager',
          code: 'metrics-init-failed',
          message: 'Node metrics tracker unavailable; continuing without telemetry',
          context: {
            reason: error instanceof Error ? error.message : String(error)
          }
        });
      }
      // Initialize PeerJS connection
      console.log('[P2P] 🔌 Initializing PeerJS...');
      this.peerId = await this.peerjs.initialize();
      this.updateTransportState('peerjs', {
        state: 'ready',
      });
      console.log('[P2P] ✅ PeerJS initialized with ID:', this.peerId);
      recordP2PDiagnostic({
        level: 'info',
        source: 'manager',
        code: 'peerjs-initialized',
        message: 'PeerJS adapter initialized',
        context: { peerId: this.peerId }
      });

      const activeEndpoint = this.peerjs.getActiveEndpoint();
      if (activeEndpoint) {
        this.activeSignalingEndpoint = activeEndpoint;
        const endpointContext = {
          id: activeEndpoint.id,
          label: activeEndpoint.label,
          url: this.formatEndpointUrl(activeEndpoint),
          host: activeEndpoint.host,
          port: activeEndpoint.port,
          secure: activeEndpoint.secure,
          path: activeEndpoint.path,
        };
        recordP2PDiagnostic({
          level: 'info',
          source: 'manager',
          code: 'signaling-endpoint-selected',
          message: 'PeerJS signaling endpoint selected',
          context: endpointContext,
        });
        this.notifySignalingEndpointListeners(activeEndpoint);
      }

      if (this.metricsEnabled) {
        this.metrics.startSession();
      }

      // Update discovery with our peer ID
      console.log('[P2P] 🔍 Creating discovery manager...');
      this.discovery = new PeerDiscovery(this.peerId, this.localUserId);
      
      // Scan local content - THIS IS CRITICAL
      console.log('[P2P] 📂 Scanning local content from IndexedDB...');
      const startScan = performance.now();
      const localContent = await this.discovery.scanLocalContent();
      const scanDuration = performance.now() - startScan;
      console.log(`[P2P] ✅ Content scan complete in ${scanDuration.toFixed(2)}ms`);
      console.log(`[P2P] 📊 Found ${localContent.length} local items:`, localContent.slice(0, 5));
      recordP2PDiagnostic({
        level: 'info',
        source: 'manager',
        code: 'content-scan-complete',
        message: 'Local content scan finished',
        context: { duration: scanDuration, items: localContent.length }
      });

      this.replication = new ReplicationOrchestrator(
        {
          chunkProtocol: this.chunkProtocol,
          discovery: this.discovery,
          ensureManifest: async (manifestId) => this.ensureManifest(manifestId, { includeChunks: true }),
          getPeersWithContent: (manifestId) => this.discovery.getPeersWithContent(manifestId),
          hasLocalContent: (manifestId) => this.discovery.hasLocalContent(manifestId),
          getLocalPeerId: () => this.peerId
        },
        {
          defaultRedundancy: this.defaultReplicaTarget,
          minFreeBytes: this.minReplicaFreeBytes
        }
      );
      await this.replication.initialize();
      await this.initializeAlternateTransports();

      // Verify stats immediately
      const initialStats = this.discovery.getStats();
      console.log('[P2P] 📊 Initial discovery stats:', initialStats);

      if (localContent.length === 0) {
        console.warn('[P2P] ⚠️ WARNING: No local content found! This may indicate:');
        console.warn('  - No posts or files have been created yet');
        console.warn('  - IndexedDB is empty or not accessible');
        console.warn('  - Content scanning failed');
      }

      const shouldStartRendezvous = this.rendezvousEnabled || this.rendezvousPendingStart;

      if (shouldStartRendezvous) {
        this.rendezvousEnabled = true;
        this.rendezvousPendingStart = false;
        console.log('[P2P] 🌐 Rendezvous mesh enabled, initializing...');
        try {
          await this.initializeRendezvousMesh();
          recordP2PDiagnostic({
            level: 'info',
            source: 'manager',
            code: 'rendezvous-start',
            message: 'Rendezvous mesh initialized'
          });
        } catch (error) {
          console.error('[P2P] ❌ Rendezvous mesh initialization failed:', error);
          recordP2PDiagnostic({
            level: 'error',
            source: 'manager',
            code: 'rendezvous-error',
            message: error instanceof Error ? error.message : 'Unknown rendezvous initialization error'
          });
        }
      } else {
        console.log('[P2P] 🌐 Rendezvous mesh disabled for this session');
        recordP2PDiagnostic({
          level: 'info',
          source: 'manager',
          code: 'rendezvous-disabled',
          message: 'Rendezvous mesh disabled for session'
        });
      }

      // Announce presence to all connected peers
      console.log('[P2P] 📢 Announcing presence to network...');
      this.announcePresence();
      
      // Set up periodic announcements
      let announceCount = 0;
      this.announceInterval = window.setInterval(() => {
        announceCount++;
        const content = this.discovery.getLocalContent();
        console.log(`[P2P] 📢 Periodic announce #${announceCount}: ${content.length} items`);
        this.announcePresence();
        
        // Log stats periodically
        if (announceCount % 3 === 0) {
          const stats = this.getStats();
          console.log('[P2P] 📊 Current stats:', JSON.stringify(stats, null, 2));
        }
      }, 30000); // Every 30 seconds
      
      // Set up cleanup
      this.cleanupInterval = window.setInterval(() => {
        this.discovery.cleanup();
        this.chunkProtocol.cleanup();
      }, 60000); // Every minute
      
      // Start health monitoring
      this.healthMonitor.start();

      this.startPingInterval();

      // Start gossip protocol for continuous peer discovery
      console.log('[P2P] 🗣️ Starting gossip protocol...');
      this.gossip.start();
      recordP2PDiagnostic({
        level: 'info',
        source: 'manager',
        code: 'gossip-start',
        message: 'Gossip protocol started'
      });
      
      // Auto-join global room for easy peer discovery
      console.log('[P2P] 🚪 Auto-joining global discovery room...');
      this.roomDiscovery.joinRoom('swarm-space-global');

      await this.loadKnownConnections();
      this.autoConnectKnownConnections('startup');
      this.autoConnectKnownPeers('startup');

      // State 1→2: Connected to signaling, now waiting for peers
      this.status = 'waiting';
      console.log('[P2P] 📡 State 1→2: Connected to signaling, waiting for peer discovery...');

      // Automatic peer discovery via rendezvous mesh when available
      const rendezvousReady = this.rendezvousEnabled && this.hasRendezvousEndpoints();
      const discoveryMode = rendezvousReady ? 'rendezvous mesh' : 'bootstrap registry';
      console.log(`[P2P] 🔍 Starting automatic peer discovery via ${discoveryMode}...`);
      const discoveryAttempt = this.discoverAndConnectPeers('initial').catch(err => {
        const message = err instanceof Error ? err.message : String(err);
        console.log('[P2P] ℹ️ Automatic discovery attempt failed:', message);
      });

      // Attempt automatic connections to bootstrap peers
      this.connectToBootstrapPeers();
      this.maintainMeshConnectivity('startup');

      // Wait briefly for discovery to complete, then check for connections
      setTimeout(() => {
        const connectedPeers = this.peerjs.getConnectedPeers();
        console.log(`[P2P] 🔍 Post-discovery check: ${connectedPeers.length} peers connected`);

        if (connectedPeers.length === 0) {
          console.log('[P2P] 💡 No peers found via initial discovery.');
          console.log('[P2P] 🔄 Will continue trying via periodic reconnect and gossip...');
        }
      }, 5000);
      
      // Set up periodic reconnection and discovery attempts
      this.reconnectInterval = window.setInterval(() => {
        this.connectToBootstrapPeers();
        this.autoConnectKnownConnections('interval');
        this.autoConnectKnownPeers('interval');
        this.discoverAndConnectPeers('interval').catch(() => {});
        this.maintainMeshConnectivity('interval');

        // Update status based on peer count
        const connectedPeers = this.peerjs.getConnectedPeers();
        if (connectedPeers.length > 0 && this.status === 'waiting') {
          this.status = 'online';
          console.log('[P2P] 🎉 State 2→3: Swarm formation! Connected to peers.');
        } else if (connectedPeers.length === 0 && this.status === 'online') {
          this.status = 'waiting';
          console.log('[P2P] ⚠️ State 3→2: All peers disconnected, waiting for reconnection...');
        }
      }, 30000); // Every 30 seconds
      const finalStats = this.getStats();
      console.log('[P2P] ✅ P2P MANAGER STARTED SUCCESSFULLY!');
      console.log('[P2P] 📊 Final stats:', JSON.stringify(finalStats, null, 2));
      console.log('[P2P] 💡 Your Peer ID:', this.peerId);
      console.log('[P2P] 🔗 Share this ID with others to connect!');
      console.log('[P2P] 🌐 Bootstrap registry:', this.bootstrap.getStats());
      recordP2PDiagnostic({
        level: 'info',
        source: 'manager',
        code: 'manager-started',
        message: 'P2P manager started successfully',
        context: finalStats as unknown as Record<string, unknown>
      });

    } catch (error) {
      console.error('[P2P] ❌ FAILED TO START:', error);
      this.status = 'offline';
      recordP2PDiagnostic({
        level: 'error',
        source: 'manager',
        code: 'manager-start-failed',
        message: error instanceof Error ? error.message : 'Unknown manager start error'
      });
      throw error;
    }
  }

  /**
   * Stop P2P networking
   */
  stop(): void {
    console.log('[P2P] Stopping P2P manager...');
    recordP2PDiagnostic({
      level: 'info',
      source: 'manager',
      code: 'manager-stop',
      message: 'Stopping P2P manager'
    });

    if (this.announceInterval) {
      clearInterval(this.announceInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
    }
    this.stopPingInterval();
    this.pendingPings.clear();
    this.clearRendezvousTimers();
    this.rendezvousPeerCache.clear();
    this.rendezvousTicket = undefined;
    this.lastRendezvousSync = 0;
    this.rendezvousPendingStart = false;

    this.unsubscribeEndpointChanges?.();
    this.unsubscribeEndpointChanges = null;
    this.activeSignalingEndpoint = null;
    this.notifySignalingEndpointListeners(null);

    this.webTorrentAdapter?.stop();
    this.webTorrentAdapter = null;
    this.gunAdapter?.stop();
    this.gunAdapter = null;
    this.featureFlagUnsubscribe?.();
    this.featureFlagUnsubscribe = undefined;
    this.updateTransportState('peerjs', { state: 'idle', connectedPeers: 0 });
    this.updateTransportState('webtorrent', { state: 'idle', connectedPeers: 0 });
    this.updateTransportState('gun', { state: 'idle', connectedPeers: 0 });
    this.totalTransportFallbacks = 0;
    this.lastTransportFallbackAt = null;

    this.gossip.stop();
    this.healthMonitor.stop();
    this.peerjs.destroy();
    this.status = 'offline';
    this.peerId = null;
    this.knownConnections.clear();

    this.pendingInboundPeers.clear();
    this.pendingOutboundConnections.clear();
    this.emitPendingPeerUpdate();

    this.sessionStartedAt = null;
    this.firstPeerConnectedAt = null;
    this.timeToFirstPeerMs = null;
    this.lastBeaconLatencyMs = null;

    if (this.metricsEnabled) {
      void this.metrics.stopSession();
    }

    console.log('[P2P] P2P manager stopped');
    recordP2PDiagnostic({
      level: 'info',
      source: 'manager',
      code: 'manager-stopped',
      message: 'P2P manager stopped successfully'
    });
  }

  /**
   * Connect to a peer by their ID
   */
  connectToPeer(peerId: string, options: ConnectOptions = {}): boolean {
    const { manual = false, source = manual ? 'manual' : 'auto', allowDuringIsolation = false } = options;

    if (!peerId) {
      console.warn('[P2P] ⚠️ connectToPeer called without a peer ID');
      recordP2PDiagnostic({
        level: 'warn',
        source: 'manager',
        code: 'connect-missing-id',
        message: 'connectToPeer invoked without a peer ID',
      });
      return false;
    }

    if (this.isPeerBlocked(peerId)) {
      console.log(`[P2P] 🚫 Connection to ${peerId} blocked by user control.`);
      recordP2PDiagnostic({
        level: 'warn',
        source: 'manager',
        code: 'connect-blocked',
        message: 'Connection blocked by user controls',
        context: { peerId, source }
      });
      return false;
    }

    if (this.isPaused()) {
      console.log(`[P2P] ⏸️ Connection to ${peerId} blocked (${source}) because networking is paused.`);
      recordP2PDiagnostic({
        level: 'warn',
        source: 'manager',
        code: 'connect-paused',
        message: 'Connection suppressed because networking is paused',
        context: { peerId, source }
      });
      return false;
    }

    if (this.controlState.pauseOutbound) {
      console.log(`[P2P] ⛔ Outbound connections paused - skipping link to ${peerId} (${source})`);
      recordP2PDiagnostic({
        level: 'info',
        source: 'manager',
        code: 'connect-outbound-paused',
        message: 'Outbound connection prevented due to pause control',
        context: { peerId, source },
      });
      return false;
    }

    if (!manual && !this.canAutoConnect()) {
      console.log(`[P2P] ⛔ Auto-connection to ${peerId} ignored (${source}) due to user controls`, this.controlState);
      recordP2PDiagnostic({
        level: 'info',
        source: 'manager',
        code: 'connect-auto-suppressed',
        message: 'Auto-connect suppressed by user controls',
        context: { peerId, source }
      });
      return false;
    }

    if (!manual && this.controlState.isolate && !allowDuringIsolation) {
      console.log(`[P2P] 🛡️ Isolation active - skipping auto connection to ${peerId} (${source})`);
      recordP2PDiagnostic({
        level: 'info',
        source: 'manager',
        code: 'connect-isolation-blocked',
        message: 'Connection skipped due to isolation mode',
        context: { peerId, source }
      });
      return false;
    }

    console.log(`[P2P] Connecting to peer (${source}):`, peerId);
    recordP2PDiagnostic({
      level: 'info',
      source: 'manager',
      code: 'connect-attempt',
      message: 'Initiating peer connection',
      context: { peerId, source, manual }
    });
    this.pendingOutboundConnections.add(peerId);
    if (this.metricsEnabled) {
      this.metrics.recordConnectionAttempt();
    }
    this.peerjs.connectToPeer(peerId);
    return true;
  }

  /**
   * Manually disconnect from a peer
   */
  disconnectFromPeer(peerId: string): void {
    if (!peerId) {
      return;
    }

    console.log('[P2P] Manually disconnecting from peer:', peerId);
    this.pendingOutboundConnections.delete(peerId);
    this.peerjs.disconnectFrom(peerId);
  }

  /**
   * Reconnect to a peer (after connection loss)
   */
  private reconnectToPeer(peerId: string): void {
    console.log('[P2P] Attempting reconnection to peer:', peerId);
    this.healthMonitor.removeConnection(peerId);
    this.peerjs.connectToPeer(peerId);
  }

  /**
   * Discover and connect to peers automatically using the rendezvous mesh.
   * Falls back to bootstrap registry + gossip when mesh is disabled.
   */
  private async discoverAndConnectPeers(trigger: 'initial' | 'interval' = 'interval'): Promise<void> {
    if (!this.canAutoConnect()) {
      console.log(`[P2P] ⏸️ Auto-discovery skipped (${trigger}) due to user controls`, this.controlState);
      return;
    }

    const rendezvousConfigured = this.rendezvousEnabled && this.hasRendezvousEndpoints();

    if (!rendezvousConfigured) {
      console.log('[P2P] ℹ️ Rendezvous mesh disabled or not configured; relying on bootstrap registry and gossip');
      return;
    }

    console.log(`[P2P] 🔍 Triggering rendezvous mesh refresh (${trigger})...`);
    await this.refreshRendezvousMesh(`discover:${trigger}`);
  }

  /**
   * Connect to bootstrap peers automatically
   */
  private connectToBootstrapPeers(): void {
    if (!this.canAutoConnect()) {
      console.log('[P2P] ⏸️ Bootstrap auto-connect suppressed due to user controls', this.controlState);
      return;
    }

    const connectedPeers = new Set(this.peerjs.getConnectedPeers());
    const bestPeers = this.bootstrap.getBestPeers(5);
    
    console.log(`[P2P] 🔄 Auto-connect: ${connectedPeers.size} connected, ${bestPeers.length} in registry`);
    
    // Connect to best peers that we're not already connected to
    let attempted = 0;
    for (const peer of bestPeers) {
      if (!connectedPeers.has(peer.peerId) && peer.peerId !== this.peerId) {
        console.log(`[P2P] 🔗 Auto-connecting to peer: ${peer.peerId} (reliability: ${peer.reliability.toFixed(2)})`);
        if (this.connectToPeer(peer.peerId, { source: 'bootstrap' })) {
          attempted++;
        }
      }
    }
    
    if (attempted === 0 && bestPeers.length === 0) {
      console.log('[P2P] ℹ️ No bootstrap peers in registry');
    }
  }

  /**
   * Announce presence with available content
   */
  private announcePresence(): void {
    if (this.isPaused()) {
      return;
    }

    const localContent = this.discovery.getLocalContent();
    const currentRoom = this.roomDiscovery.getCurrentRoom();
    const replicaSummary = this.discovery.getReplicaAdvertisement();

    this.peerjs.broadcast('announce', {
      userId: this.localUserId,
      peerId: this.peerId,
      availableContent: localContent,
      room: currentRoom,
      timestamp: Date.now(),
      replicas: replicaSummary
    });
  }

  /**
   * Request a chunk from the P2P network
   */
  async requestChunk(chunkHash: string): Promise<Uint8Array | null> {
    const peerId = this.discovery.getBestPeerForContent(chunkHash);

    if (!peerId) {
      console.log(`[P2P] No peers have chunk ${chunkHash}`);
      return null;
    }

    console.log(`[P2P] Requesting chunk ${chunkHash} from peer ${peerId}`);
    return await this.chunkProtocol.requestChunk(peerId, chunkHash);
  }

  async ensureManifest(
    manifestId: string,
    options: EnsureManifestOptions = {}
  ): Promise<Manifest | null> {
    if (!manifestId) {
      return null;
    }

    const manifest = await this.ensureSingleManifest(manifestId, options.sourcePeerId);
    if (!manifest) {
      return null;
    }

    if (options.includeChunks !== false) {
      await this.ensureChunksForManifest(manifest, options.sourcePeerId);
    }

    return manifest;
  }

  /**
   * Announce new local content
   */
  announceContent(manifestHash: string): void {
    this.discovery.addLocalContent(manifestHash);
    this.peerjs.broadcast('content-available', {
      manifestHashes: [manifestHash]
    });
  }

  /**
   * Check if content is available on network
   */
  isContentAvailable(manifestHash: string): boolean {
    return this.discovery.isContentAvailable(manifestHash);
  }

  /**
   * Get peers that have specific content
   */
  getPeersWithContent(manifestHash: string): string[] {
    return this.discovery.getPeersWithContent(manifestHash);
  }

  /**
   * Get current peer ID
   */
  getPeerId(): string | null {
    return this.peerId;
  }

  async setRendezvousEnabled(
    enabled: boolean,
    options: { reason?: 'user' | 'capability' | 'failure' } = {}
  ): Promise<void> {
    if (this.rendezvousEnabled === enabled && (!enabled || !this.rendezvousPendingStart)) {
      if (!enabled && options.reason && this.rendezvousDisabledReason !== options.reason) {
        this.rendezvousDisabledReason = options.reason;
      }
      return;
    }

    const reason = options.reason ?? (enabled ? null : 'user');

    if (!enabled) {
      this.rendezvousEnabled = false;
      this.options.rendezvous = {
        ...(this.options.rendezvous ?? {}),
        enabled: false,
      };
      this.rendezvousPendingStart = false;
      this.clearRendezvousTimers();
      this.rendezvousPeerCache.clear();
      this.lastRendezvousSync = 0;
      this.rendezvousFailureStreak = 0;
      const disableReason = reason ?? this.rendezvousDisabledReason;
      if (disableReason) {
        this.rendezvousDisabledReason = disableReason;
      }
      if (disableReason === 'capability' || disableReason === 'failure') {
        this.emitRendezvousDisableDiagnostic(disableReason);
      }
      return;
    }

    this.rendezvousEnabled = true;
    this.options.rendezvous = {
      ...(this.options.rendezvous ?? {}),
      enabled: true,
    };
    this.rendezvousDisabledReason = null;

    if (!this.peerId) {
      console.log('[P2P] Rendezvous mesh will start once PeerJS is ready');
      this.rendezvousPendingStart = true;
      return;
    }

    const capabilityAvailable = await this.ensureRendezvousCapability();
    if (!capabilityAvailable) {
      this.rendezvousEnabled = false;
      this.options.rendezvous = {
        ...(this.options.rendezvous ?? {}),
        enabled: false,
      };
      this.rendezvousPendingStart = false;
      this.clearRendezvousTimers();
      this.rendezvousPeerCache.clear();
      this.lastRendezvousSync = 0;
      this.rendezvousFailureStreak = 0;
      this.rendezvousDisabledReason = 'capability';
      this.emitRendezvousDisableDiagnostic('capability');
      return;
    }

    this.rendezvousPendingStart = false;
    await this.initializeRendezvousMesh();
  }

  private async initializeRendezvousMesh(): Promise<void> {
    if (!this.peerId) {
      throw new Error('Cannot initialize rendezvous mesh without a peer ID');
    }

    const capabilityAvailable = await this.ensureRendezvousCapability();
    if (!capabilityAvailable) {
      return;
    }

    const beaconEndpoints = this.getBeaconEndpoints();
    const capsuleSources = this.getCapsuleSources();

    if (beaconEndpoints.length === 0 && capsuleSources.length === 0) {
      console.warn('[P2P] Rendezvous mesh enabled but no endpoints configured');
      return;
    }

    try {
      await this.refreshRendezvousMesh('startup');
    } catch (error) {
      console.error('[P2P] Rendezvous mesh refresh failed during initialization:', error);
    }

    this.clearRendezvousTimers();
    const interval = Math.max(30_000, this.rendezvousConfig.refreshIntervalMs);
    this.rendezvousPollInterval = window.setInterval(() => {
      void this.refreshRendezvousMesh('interval');
    }, interval);
  }

  private ensureRendezvousSigner(): Promise<PresenceTicketSigner> {
    if (!this.rendezvousSignerPromise) {
      this.rendezvousSignerPromise = (async () => {
        const supported = await this.ensureRendezvousCapability();
        if (!supported) {
          throw new Error('Ed25519 signing not supported; rendezvous mesh unavailable');
        }
        return loadRendezvousSigner();
      })();
    }
    return this.rendezvousSignerPromise;
  }

  private async ensureRendezvousCapability(): Promise<boolean> {
    if (this.ed25519Supported !== null) {
      return this.ed25519Supported;
    }

    if (!this.ed25519ProbePromise) {
      this.ed25519ProbePromise = probeEd25519Support()
        .then((supported) => {
          this.ed25519Supported = supported;
          recordP2PDiagnostic({
            level: supported ? 'info' : 'error',
            source: 'rendezvous',
            code: supported ? 'rendezvous-capability-ed25519' : 'rendezvous-capability-missing',
            message: supported
              ? 'Browser supports Ed25519 signing for rendezvous tickets'
              : 'Browser is missing Ed25519 WebCrypto support; rendezvous mesh cannot sign tickets',
          });
          return supported;
        })
        .catch((error) => {
          this.ed25519Supported = false;
          recordP2PDiagnostic({
            level: 'error',
            source: 'rendezvous',
            code: 'rendezvous-capability-error',
            message: 'Failed to probe Ed25519 capability for rendezvous mesh',
            context: {
              reason: error instanceof Error ? error.message : String(error),
            },
          });
          return false;
        });
    }

    return this.ed25519ProbePromise;
  }

  private emitRendezvousDisableDiagnostic(
    reason: 'capability' | 'failure',
    context: Record<string, unknown> = {}
  ): void {
    if (this.rendezvousDisabledReason === reason && Object.keys(context).length === 0) {
      return;
    }

    if (reason === 'capability') {
      recordP2PDiagnostic({
        level: 'error',
        source: 'rendezvous',
        code: 'rendezvous-disabled-ed25519',
        message: 'Rendezvous mesh disabled: browser cannot sign Ed25519 presence tickets',
        context,
      });
    } else {
      recordP2PDiagnostic({
        level: 'warn',
        source: 'rendezvous',
        code: 'rendezvous-disabled-failure-streak',
        message: 'Rendezvous mesh disabled after repeated fetch failures; falling back to bootstrap discovery',
        context: {
          ...context,
          failureStreak: this.rendezvousFailureStreak,
        },
      });
    }
  }

  private async refreshRendezvousMesh(reason: string): Promise<void> {
    if (!this.peerId || !this.rendezvousEnabled) {
      return;
    }
    if (this.rendezvousInFlight) {
      console.log('[P2P] Rendezvous refresh already running, skipping', reason);
      return;
    }

    this.rendezvousInFlight = true;

    try {
      const now = Date.now();
      const records: RendezvousPeerRecord[] = [];
      const beaconEndpoints = this.getBeaconEndpoints();
      let totalAttempts = 0;
      let totalSuccesses = 0;

      if (beaconEndpoints.length > 0) {
        const capabilityAvailable = await this.ensureRendezvousCapability();
        if (!capabilityAvailable) {
          this.emitRendezvousDisableDiagnostic('capability');
          await this.setRendezvousEnabled(false, { reason: 'capability' });
          return;
        }

        let announcement = this.rendezvousTicket;
        if (!announcement || announcement.payload.expiresAt - 5000 < now) {
          try {
            announcement = await this.createPresenceAnnouncement(now);
          } catch (error) {
            console.error('[P2P] Unable to create presence ticket for rendezvous mesh:', error);
            announcement = undefined;
          }
        }

        if (!announcement) {
          console.warn('[P2P] Rendezvous mesh could not create presence ticket; requesting anonymous peer list');
        }
        try {
          const trustedTickets = this.rendezvousConfig.trustedTicketPublicKeys;
          const beaconResult = await fetchBeaconPeers(beaconEndpoints, announcement, {
            now,
            trustedPublicKeys: trustedTickets.length > 0 ? trustedTickets : undefined,
            defaultTimeoutMs: this.rendezvousConfig.beaconRequestTimeoutMs,
            defaultRetryLimit: this.rendezvousConfig.beaconRetryLimit,
            defaultRetryBackoffMs: this.rendezvousConfig.beaconRetryBackoffMs,
          });
          records.push(...beaconResult.records);
          totalAttempts += beaconResult.attempts;
          totalSuccesses += beaconResult.successes;
          if (this.metricsEnabled) {
            if (beaconResult.attempts > 0) {
              this.metrics.recordRendezvousAttempt(beaconResult.attempts);
            }
            if (beaconResult.successes > 0) {
              this.metrics.recordRendezvousSuccess(beaconResult.successes);
            }
            const failureCount = Math.max(0, beaconResult.failures + beaconResult.aborted);
            if (failureCount > 0) {
              this.metrics.recordRendezvousFailure(failureCount);
            }
          }
          if (beaconResult.lastLatencyMs != null) {
            this.lastBeaconLatencyMs = beaconResult.lastLatencyMs;
          }
        } catch (error) {
          console.error('[P2P] Beacon rendezvous fetch failed:', error);
        }
      }

      const capsuleSources = this.getCapsuleSources();
      if (capsuleSources.length > 0) {
        try {
          const trustedCapsules = this.rendezvousConfig.trustedCapsulePublicKeys;
          const capsuleResult = await fetchCapsulePeers(capsuleSources, {
            now,
            trustedPublicKeys: trustedCapsules.length > 0 ? trustedCapsules : undefined,
            defaultTimeoutMs: this.rendezvousConfig.capsuleRequestTimeoutMs,
            defaultRetryLimit: this.rendezvousConfig.capsuleRetryLimit,
            defaultRetryBackoffMs: this.rendezvousConfig.capsuleRetryBackoffMs,
          });
          records.push(...capsuleResult.records);
          totalAttempts += capsuleResult.attempts;
          totalSuccesses += capsuleResult.successes;
          if (this.metricsEnabled) {
            if (capsuleResult.attempts > 0) {
              this.metrics.recordRendezvousAttempt(capsuleResult.attempts);
            }
            if (capsuleResult.successes > 0) {
              this.metrics.recordRendezvousSuccess(capsuleResult.successes);
            }
            const failureCount = Math.max(0, capsuleResult.failures + capsuleResult.aborted);
            if (failureCount > 0) {
              this.metrics.recordRendezvousFailure(failureCount);
            }
          }
        } catch (error) {
          console.error('[P2P] Capsule rendezvous fetch failed:', error);
        }
      }

      if (totalSuccesses > 0) {
        this.rendezvousFailureStreak = 0;
        if (records.length > 0) {
          this.mergeRendezvousRecords(records);
        }
        this.lastRendezvousSync = now;
      } else if (totalAttempts > 0) {
        this.rendezvousFailureStreak += 1;
        const threshold = this.rendezvousConfig.rendezvousFailureThreshold ?? 3;
        recordP2PDiagnostic({
          level: 'warn',
          source: 'rendezvous',
          code: 'rendezvous-fetch-empty',
          message: 'Rendezvous fetch cycle completed without successful responses',
          context: {
            failureStreak: this.rendezvousFailureStreak,
            threshold,
          },
        });

        if (this.rendezvousFailureStreak >= threshold) {
          this.emitRendezvousDisableDiagnostic('failure');
          await this.setRendezvousEnabled(false, { reason: 'failure' });
          return;
        }
      }
    } finally {
      this.rendezvousInFlight = false;
    }
  }

  private async createPresenceAnnouncement(now: number): Promise<PresenceTicketEnvelope> {
    if (!this.peerId) {
      throw new Error('Cannot create presence announcement without a peer ID');
    }
    const signer = await this.ensureRendezvousSigner();
    this.rendezvousTicket = await createPresenceTicket({
      peerId: this.peerId,
      userId: this.localUserId,
      signer,
      ttlMs: this.rendezvousConfig.ticketTtlMs,
      now
    });
    return this.rendezvousTicket;
  }

  private mergeRendezvousRecords(records: RendezvousPeerRecord[]): void {
    const now = Date.now();
    const connectedPeers = new Set(this.peerjs.getConnectedPeers());

    for (const record of records) {
      const key = `${record.peerId}:${record.userId}`;
      const existing = this.rendezvousPeerCache.get(key);
      if (!existing || existing.expiresAt < record.expiresAt) {
        this.rendezvousPeerCache.set(key, record);
      }

      if (record.peerId === this.peerId) {
        continue;
      }

      this.bootstrap.addPeer(record.peerId, record.userId, true);
      this.discovery.registerPeer(record.peerId, record.userId, []);

      const knownConnection = this.knownConnections.get(record.userId);
      if (knownConnection) {
        const currentPeerId = knownConnection.peerId ?? knownConnection.lastPeerId;
        if (currentPeerId !== record.peerId) {
          this.knownConnections.set(record.userId, {
            ...knownConnection,
            lastPeerId: record.peerId,
            lastPeerIdAt: new Date().toISOString(),
          });
        }
      }

      this.peerExchange.updatePeer({
        peerId: record.peerId,
        userId: record.userId,
        lastSeen: now,
        reliability: 0.8,
        contentCount: 0
      });

      if (!connectedPeers.has(record.peerId)) {
        this.connectToPeer(record.peerId, { source: 'rendezvous' });
      }
    }

    if (records.length > 0) {
      this.gossip.triggerGossip();
      const peerIds = Array.from(new Set(records
        .map(record => record.peerId)
        .filter(peerId => peerId && peerId !== this.peerId)));
      if (peerIds.length > 0) {
        this.maintainMeshConnectivity('rendezvous', peerIds);
      }
      this.autoConnectKnownConnections('rendezvous');
    }

    for (const [key, record] of this.rendezvousPeerCache.entries()) {
      if (record.expiresAt < now) {
        this.rendezvousPeerCache.delete(key);
      }
    }
  }

  private clearRendezvousTimers(): void {
    if (this.rendezvousPollInterval) {
      clearInterval(this.rendezvousPollInterval);
      this.rendezvousPollInterval = undefined;
    }
  }

  private getBeaconEndpoints(): BeaconEndpoint[] {
    return this.rendezvousConfig.beacons.map(endpoint => ({
      ...endpoint,
      community: endpoint.community ?? this.rendezvousConfig.community
    }));
  }

  private getCapsuleSources(): CapsuleSource[] {
    return this.rendezvousConfig.capsules;
  }

  private hasRendezvousEndpoints(): boolean {
    return this.rendezvousConfig.beacons.length > 0 || this.rendezvousConfig.capsules.length > 0;
  }

  private startPingInterval(): void {
    if (typeof window === 'undefined') return;
    if (this.pingInterval) return;
    this.pingInterval = window.setInterval(() => {
      this.sendPings();
    }, 30000); // Ping every 30 seconds to reduce network overhead
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }

  private sendPings(): void {
    if (this.isPaused()) {
      return;
    }

    const peers = this.peerjs.getConnectedPeers();
    for (const peerId of peers) {
      this.sendPing(peerId);
    }
  }

  private sendPing(peerId: string): void {
    const sentAt = Date.now();
    const sent = this.peerjs.sendToPeer(peerId, 'ping', { sentAt });
    if (sent) {
      this.pendingPings.set(peerId, sentAt);
      this.healthMonitor.recordPing(peerId);
      if (this.metricsEnabled) {
        this.metrics.recordPing();
      }
    }
  }

  private handleChunkTransfer(update: ChunkTransferUpdate): void {
    if (update.direction === 'upload') {
      if (this.metricsEnabled) {
        this.metrics.recordBytesUploaded(update.bytes);
        this.metrics.recordRelay();
      }
    } else {
      if (this.metricsEnabled) {
        this.metrics.recordBytesDownloaded(update.bytes);
      }
    }
  }

  private sendChunkThroughTransports(peerId: string, message: ChunkMessage): boolean {
    const sent = this.peerjs.sendToPeer(peerId, 'chunk', message);
    if (sent) {
      this.updateTransportState('peerjs', {
        state: 'active',
        connectedPeers: this.peerjs.getConnectedPeers().length,
      });
      if (message.type === 'request_chunk' || message.type === 'request_manifest') {
        this.discovery.updatePeerSeen(peerId);
      }
      return true;
    }

    let delivered = false;

    if (this.transportStates.integrated.enabled && this.integratedAdapter) {
      const fallbackResult = this.integratedAdapter.send('chunk', peerId, message);
      if (fallbackResult === 'confirmed') {
        this.recordTransportFallback('peerjs', 'integrated', peerId, message.type);
        delivered = true;
      } else if (fallbackResult === 'failed') {
        this.updateTransportState('integrated', {
          lastError: 'chunk-send-failed',
          state: 'degraded',
        });
      }
    }

    if (!delivered && this.transportStates.webtorrent.enabled && this.webTorrentAdapter) {
      const fallbackSent = this.webTorrentAdapter.send('chunk', peerId, message);
      if (fallbackSent) {
        this.recordTransportFallback('peerjs', 'webtorrent', peerId, message.type);
        delivered = true;
      } else {
        this.updateTransportState('webtorrent', {
          lastError: 'chunk-send-failed',
          state: 'degraded',
        });
      }
    }

    if (!delivered && this.transportStates.gun.enabled && this.gunAdapter) {
      const fallbackSent = this.gunAdapter.send('chunk', peerId, message);
      if (fallbackSent) {
        this.recordTransportFallback('peerjs', 'gun', peerId, message.type);
        delivered = true;
      } else {
        this.updateTransportState('gun', {
          lastError: 'chunk-send-failed',
          state: 'degraded',
        });
      }
    }

    if (delivered && (message.type === 'request_chunk' || message.type === 'request_manifest')) {
      this.discovery.updatePeerSeen(peerId);
    }

    return delivered;
  }

  private recordTransportFallback(
    primary: P2PTransportKey,
    fallback: P2PTransportKey,
    peerId: string,
    channel: string
  ): void {
    if (!this.transportTelemetryEnabled) {
      return;
    }

    const now = Date.now();
    this.totalTransportFallbacks += 1;
    this.lastTransportFallbackAt = now;

    const fallbackState = this.transportStates[fallback];
    this.updateTransportState(fallback, {
      fallbackCount: fallbackState.fallbackCount + 1,
      lastFallbackAt: now,
      state: 'active',
    });

    const primaryState = this.transportStates[primary];
    if (primaryState.state !== 'error') {
      this.updateTransportState(primary, {
        state: 'degraded',
      });
    }

    recordP2PDiagnostic({
      level: 'info',
      source: 'manager',
      code: 'transport-fallback',
      message: `Fallback from ${primary} to ${fallback}`,
      context: {
        peerId,
        channel,
        fallback,
        total: this.totalTransportFallbacks,
      },
    });
  }

  private handleAlternateChunkMessage(
    transport: P2PTransportKey,
    peerId: string,
    payload: unknown
  ): void {
    if (!this.isChunkMessage(payload)) {
      return;
    }
    this.discovery.updatePeerSeen(peerId);
    this.healthMonitor.updateActivity(peerId);
    this.updateTransportState(transport, {
      state: 'active',
    });
    void this.chunkProtocol.handleMessage(peerId, payload as ChunkMessage);
  }

  private updateTransportState(key: P2PTransportKey, updates: Partial<P2PTransportStatus>): void {
    const current = this.transportStates[key];
    this.transportStates[key] = {
      ...current,
      ...updates,
    };
  }

  private applyAdapterStatus(key: P2PTransportKey, status: TransportRuntimeStatus): void {
    this.updateTransportState(key, {
      state: status.state,
      lastError: status.lastError,
    });
  }

  private handleTransportPeerUpdate(key: P2PTransportKey, peers: string[]): void {
    this.updateTransportState(key, {
      connectedPeers: peers.length,
      state: peers.length > 0 ? 'active' : this.transportStates[key].state,
    });
  }

  private async initializeAlternateTransports(): Promise<void> {
    await Promise.all([
      this.initializeWebTorrentTransport(),
      this.initializeGunTransport(),
      this.initializeIntegratedTransport(),
    ]);
  }

  private async initializeWebTorrentTransport(): Promise<void> {
    if (!this.peerId || !this.transportStates.webtorrent.enabled || this.webTorrentAdapter) {
      return;
    }

    try {
      // Dynamic import to handle load failures gracefully
      const { WebTorrentAdapter } = await import('./transports/webtorrentAdapter');
      
      const trackers = (this.rendezvousConfig as { webtorrentTrackers?: string[] })?.webtorrentTrackers ?? [];
      const adapter = new WebTorrentAdapter({
        swarmId: this.peerId,
        trackers,
      });
      this.webTorrentAdapter = adapter;
      adapter.onStatusChange((status) => this.applyAdapterStatus('webtorrent', status));
      adapter.onPeerUpdate((peers) => this.handleTransportPeerUpdate('webtorrent', peers));
      adapter.onMessage('chunk', (remotePeerId, payload) => {
        this.handleAlternateChunkMessage('webtorrent', remotePeerId, payload);
      });
      
      await adapter.start({ peerId: this.peerId });
      this.updateTransportState('webtorrent', { state: 'ready' });
      console.log('[P2PManager] WebTorrent transport initialized');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[P2PManager] Failed to initialize WebTorrent transport:', message);
      this.updateTransportState('webtorrent', { state: 'error', lastError: message });
    }
  }

  private async initializeGunTransport(): Promise<void> {
    if (!this.peerId || !this.transportStates.gun.enabled || this.gunAdapter) {
      return;
    }

    try {
      // Dynamic import to handle load failures gracefully
      const { GunAdapter } = await import('./transports/gunAdapter');
      
      const peers = (this.rendezvousConfig as { gunPeers?: string[] })?.gunPeers ?? [];
      const adapter = new GunAdapter({ peers });
      this.gunAdapter = adapter;
      adapter.onStatusChange((status) => this.applyAdapterStatus('gun', status));
      adapter.onPeerUpdate((peerIds) => this.handleTransportPeerUpdate('gun', peerIds));
      adapter.onMessage('chunk', (remotePeerId, payload) => {
        this.handleAlternateChunkMessage('gun', remotePeerId, payload);
      });
      
      await adapter.start({ peerId: this.peerId });
      this.updateTransportState('gun', { state: 'ready' });
      console.log('[P2PManager] GUN transport initialized');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[P2PManager] Failed to initialize GUN transport:', message);
      this.updateTransportState('gun', { state: 'error', lastError: message });
    }
  }

  private async initializeIntegratedTransport(): Promise<void> {
    if (!this.peerId || !this.transportStates.integrated.enabled || this.integratedAdapter) {
      return;
    }

    try {
      const { IntegratedAdapter } = await import('./transports/integratedAdapter');
      
      const trackers = (this.rendezvousConfig as { webtorrentTrackers?: string[] })?.webtorrentTrackers ?? [];
      const gunPeers = (this.rendezvousConfig as { gunPeers?: string[] })?.gunPeers ?? [];
      
      const adapter = new IntegratedAdapter({
        swarmId: this.peerId,
        trackers,
        gunPeers,
      });
      this.integratedAdapter = adapter;
      adapter.onStatusChange((status) => this.applyAdapterStatus('integrated', status));
      adapter.onPeerUpdate((peers) => this.handleTransportPeerUpdate('integrated', peers));
      adapter.onMessage('chunk', (remotePeerId, payload) => {
        this.handleAlternateChunkMessage('integrated', remotePeerId, payload);
      });
      
      await adapter.start({ peerId: this.peerId });
      this.updateTransportState('integrated', { state: 'ready' });
      console.log('[P2PManager] Integrated transport initialized (WebTorrent DHT + GUN signaling + WebRTC)');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[P2PManager] Failed to initialize integrated transport:', message);
      this.updateTransportState('integrated', { state: 'error', lastError: message });
    }
  }

  private syncTransportFlags(flags: FeatureFlags): void {
    this.transportTelemetryEnabled = flags.transportFallbackTelemetry;

    // Separate transports (legacy mode)
    this.updateTransportState('webtorrent', { enabled: flags.webTorrentTransport });
    if (!flags.webTorrentTransport) {
      this.webTorrentAdapter?.stop();
      this.webTorrentAdapter = null;
      this.updateTransportState('webtorrent', {
        state: 'idle',
        connectedPeers: 0,
      });
    } else if (this.peerId && !this.webTorrentAdapter) {
      void this.initializeWebTorrentTransport();
    }

    this.updateTransportState('gun', { enabled: flags.gunTransport });
    if (!flags.gunTransport) {
      this.gunAdapter?.stop();
      this.gunAdapter = null;
      this.updateTransportState('gun', {
        state: 'idle',
        connectedPeers: 0,
      });
    } else if (this.peerId && !this.gunAdapter) {
      void this.initializeGunTransport();
    }

    // Integrated transport (new unified mode)
    this.updateTransportState('integrated', { enabled: flags.integratedTransport });
    if (!flags.integratedTransport) {
      this.integratedAdapter?.stop();
      this.integratedAdapter = null;
      this.updateTransportState('integrated', {
        state: 'idle',
        connectedPeers: 0,
      });
    } else if (this.peerId && !this.integratedAdapter) {
      void this.initializeIntegratedTransport();
    }
  }

  /**
   * Get P2P statistics
   */
  getStats(): P2PStats {
    const connectedPeers = this.peerjs.getConnectedPeers();
    const discoveredPeers = this.discovery.getAllPeers();
    const discoveryStats = this.discovery.getStats();
    const chunkStats = this.chunkProtocol.getStats();

    this.updateTransportState('peerjs', {
      connectedPeers: connectedPeers.length,
    });

    // Update status based on signaling connection and peer count
    const hasSignaling = this.peerjs.isSignalingActive();
    const hasPeers = connectedPeers.length > 0;

    if (this.isPaused()) {
      this.status = 'waiting';
    } else if (!hasSignaling) {
      // Lost signaling connection
      this.status = 'connecting';
    } else if (hasSignaling && !hasPeers) {
      // Connected to signaling but no peers yet - always set to waiting
      this.status = 'waiting';
    } else if (hasSignaling && hasPeers) {
      // Has both signaling and peers - full swarm mode
      this.status = 'online';
    }

    const metricsSnapshot = this.metricsEnabled
      ? this.metrics.getSnapshot()
      : this.latestMetrics;
    this.latestMetrics = metricsSnapshot;

    return {
      status: this.status,
      connectedPeers: connectedPeers.length,
      discoveredPeers: discoveredPeers.length,
      localContent: discoveryStats.localContent,
      networkContent: discoveryStats.totalContent,
      activeRequests: chunkStats.activeRequests,
      rendezvousPeers: this.rendezvousPeerCache.size,
      lastRendezvousSync: this.lastRendezvousSync === 0 ? null : this.lastRendezvousSync,
      uptimeMs: metricsSnapshot.uptimeMs,
      bytesUploaded: metricsSnapshot.bytesUploaded,
      bytesDownloaded: metricsSnapshot.bytesDownloaded,
      relayCount: metricsSnapshot.relayCount,
      pingCount: metricsSnapshot.pingCount,
      connectionAttempts: metricsSnapshot.connectionAttempts,
      successfulConnections: metricsSnapshot.successfulConnections,
      failedConnectionAttempts: metricsSnapshot.failedConnectionAttempts,
      rendezvousAttempts: metricsSnapshot.rendezvousAttempts,
      rendezvousSuccesses: metricsSnapshot.rendezvousSuccesses,
      rendezvousFailures: metricsSnapshot.rendezvousFailures,
      rendezvousFailureStreak: this.rendezvousFailureStreak,
      timeToFirstPeerMs: this.timeToFirstPeerMs,
      lastBeaconLatencyMs: this.lastBeaconLatencyMs,
      metrics: metricsSnapshot,
      signalingEndpointUrl: this.activeSignalingEndpoint
        ? this.formatEndpointUrl(this.activeSignalingEndpoint)
        : null,
      signalingEndpointLabel: this.activeSignalingEndpoint
        ? this.activeSignalingEndpoint.label
        : null,
      signalingEndpointId: this.activeSignalingEndpoint ? this.activeSignalingEndpoint.id : null,
      transportFallbacks: this.totalTransportFallbacks,
      lastTransportFallbackAt: this.lastTransportFallbackAt,
      transports: Object.values(this.transportStates).map((state) => ({ ...state })),
    };
  }

  getConnectionHealthSummary(): ConnectionHealthSummary {
    return this.healthMonitor.getStats();
  }

  getActivePeerConnections(): PeerConnectionDetail[] {
    const peers = this.peerjs.getConnectedPeers();
    return peers.map((peerId) => {
      const health = this.healthMonitor.getConnectionHealth(peerId);
      const discovered = this.discovery.getPeer(peerId);
      const metadataUserId = this.extractUserId(this.peerjs.getConnectionMetadata(peerId));
      return {
        peerId,
        userId: discovered?.userId ?? metadataUserId ?? null,
        profile: discovered?.profile,
        status: health?.status ?? 'stale',
        connectedAt: health?.connectedAt ?? null,
        lastActivity: health?.lastActivity ?? null,
        avgRttMs: health?.avgRtt ?? null,
        lastSeenAt: discovered?.lastSeen ? discovered.lastSeen.getTime() : null,
      };
    });
  }

  /**
   * Get discovered peers
   */
  getDiscoveredPeers() {
    return this.discovery.getAllPeers();
  }

  /**
   * Broadcast a post to all connected peers
   */
  broadcastPost(post: Post): void {
    void this.postSync.broadcastPost(post);
  }

  /**
   * Broadcast a comment to all connected peers
   */
  broadcastComment(comment: Comment): void {
    this.commentSync.broadcastComment(comment);
  }

  refreshPeerRegistry(): void {
    this.maintainMeshConnectivity('manual-refresh');
    this.announcePresence();
  }

  /**
   * Join a discovery room
   */
  joinRoom(roomName: string): void {
    this.roomDiscovery.joinRoom(roomName);
    // Announce immediately so others in the room can find us
    this.announcePresence();
  }

  /**
   * Leave current discovery room
   */
  leaveRoom(): void {
    this.roomDiscovery.leaveRoom();
  }

  /**
   * Get current room name
   */
  getCurrentRoom(): string | null {
    return this.roomDiscovery.getCurrentRoom();
  }

  // Private methods

  private resolvePeerUserId(peerId: string, providedUserId?: string | null): string | null {
    if (providedUserId && typeof providedUserId === 'string') {
      return providedUserId;
    }

    const metadataUserId = this.extractUserId(this.peerjs.getConnectionMetadata(peerId));
    if (metadataUserId) {
      return metadataUserId;
    }

    const discovered = this.discovery.getPeer(peerId);
    if (discovered?.userId) {
      return discovered.userId;
    }

    const pending = this.pendingInboundPeers.get(peerId);
    if (pending?.userId) {
      return pending.userId ?? null;
    }

    const bootstrapPeer = this.bootstrap.getPeer(peerId);
    if (bootstrapPeer?.userId) {
      return bootstrapPeer.userId;
    }

    return null;
  }

  private async syncConnectionRecord(peerId: string, providedUserId?: string | null): Promise<void> {
    try {
      const resolvedUserId = this.resolvePeerUserId(peerId, providedUserId);
      if (!resolvedUserId || resolvedUserId === this.localUserId) {
        return;
      }

      const connection = await createConnection(
        this.localUserId,
        resolvedUserId,
        resolvedUserId,
        peerId
      );
      this.storeKnownConnection(connection);
    } catch (error) {
      console.warn('[P2P] Failed to sync connection record for peer', peerId, error);
    }
  }

  private async clearConnectionPeer(peerId: string): Promise<void> {
    try {
      const connection = await getConnectionByPeerId(peerId);
      if (!connection) {
        return;
      }

      await updateConnectionPeerId(connection.id, null);
      const otherUserId = this.getConnectionOtherUserId(connection);
      const now = new Date().toISOString();
      this.knownConnections.set(otherUserId, {
        ...connection,
        peerId: undefined,
        lastPeerId: connection.peerId ?? connection.lastPeerId,
        lastPeerIdAt: now,
      });
    } catch (error) {
      console.warn('[P2P] Failed to clear peer ID for connection', peerId, error);
    }
  }

  private getConnectionOtherUserId(connection: Connection): string {
    return connection.userId === this.localUserId
      ? connection.connectedUserId
      : connection.userId;
  }

  private storeKnownConnection(connection: Connection): void {
    const otherUserId = this.getConnectionOtherUserId(connection);
    this.knownConnections.set(otherUserId, connection);
  }

  private async loadKnownConnections(): Promise<void> {
    try {
      const connections = await getUserConnections(this.localUserId);
      this.knownConnections.clear();

      if (connections.length > 0) {
        console.log(`[P2P] 🔁 Loaded ${connections.length} known user connections from local storage`);
      }

      for (const connection of connections) {
        const otherUserId = this.getConnectionOtherUserId(connection);
        this.knownConnections.set(otherUserId, connection);

        const candidatePeerId = connection.peerId ?? connection.lastPeerId;
        if (candidatePeerId && !this.bootstrap.getPeer(candidatePeerId)) {
          this.bootstrap.addPeer(candidatePeerId, otherUserId, true);
        }
      }
    } catch (error) {
      console.warn('[P2P] Failed to load known connections', error);
    }
  }

  private autoConnectKnownConnections(reason: string): void {
    if (!this.canAutoConnect()) {
      console.log(`[P2P] ⏸️ Known connection auto-connect skipped (${reason}) due to user controls`, this.controlState);
      return;
    }

    const candidatePeerIds = Array.from(this.knownConnections.values())
      .map(connection => connection.peerId ?? connection.lastPeerId)
      .filter((peerId): peerId is string => typeof peerId === 'string' && peerId.length > 0);

    if (candidatePeerIds.length === 0) {
      return;
    }

    console.log(`[P2P] 🔄 Auto-connecting to ${candidatePeerIds.length} known peers (${reason})`);
    this.maintainMeshConnectivity(`connections:${reason}`, candidatePeerIds);
  }

  private autoConnectKnownPeers(reason: string): void {
    if (!isAutoConnectEnabled()) {
      console.log(`[P2P] ⏸️ Known peer auto-connect disabled by user`);
      return;
    }

    if (!this.canAutoConnect()) {
      console.log(`[P2P] ⏸️ Known peer auto-connect skipped (${reason}) due to user controls`, this.controlState);
      return;
    }

    const knownPeerIds = getKnownPeerIds();
    const localNodeId = getLocalNodeId();
    
    // Filter out self and local node connections
    const eligiblePeers = knownPeerIds.filter(peerId => {
      if (peerId === this.peerId) return false;
      if (isLocalNode(peerId)) return false;
      return true;
    });
    
    if (eligiblePeers.length === 0) {
      console.log(`[P2P] ℹ️ No known peers configured for auto-connect (local node: ${localNodeId})`);
      return;
    }

    console.log(`[P2P] 🔗 Auto-connecting to ${eligiblePeers.length} known peer(s) (${reason}):`, eligiblePeers);
    
    let attemptedConnections = 0;
    for (const peerId of eligiblePeers) {
      if (!this.peerjs.isConnectedTo(peerId)) {
        if (this.connectToPeer(peerId, { source: `known-peer:${reason}` })) {
          attemptedConnections++;
        }
      }
    }

    if (attemptedConnections === 0) {
      console.log(`[P2P] ℹ️ All known peers already connected or unavailable`);
    } else {
      console.log(`[P2P] ✅ Attempted ${attemptedConnections} known peer connection(s)`);
    }
  }

  /**
   * Get the stable node ID for this peer
   */
  getNodeId(): string {
    return getLocalNodeId();
  }

  private setupEventHandlers(): void {
    // Handle new peer connections
    this.peerjs.onConnection((peerId) => {
      const initiatedLocally = this.pendingOutboundConnections.delete(peerId);

      if (this.isPeerBlocked(peerId)) {
        console.log(`[P2P] 🚫 Blocked peer attempted connection: ${peerId}`);
        this.peerjs.disconnectFrom(peerId);
        const lostContent = this.discovery.removePeer(peerId);
        this.requestReplication(lostContent, 'rebalance');
        return;
      }

      if (!initiatedLocally && this.controlState.pauseInbound) {
        console.log(`[P2P] ⛔ Inbound connections paused - rejecting ${peerId}`);
        recordP2PDiagnostic({
          level: 'info',
          source: 'manager',
          code: 'inbound-paused',
          message: 'Inbound connection rejected due to pause control',
          context: { peerId },
        });
        this.peerjs.disconnectFrom(peerId);
        return;
      }

      if (!initiatedLocally && this.controlState.manualAccept) {
        this.queueInboundPeer(peerId);
        this.peerjs.disconnectFrom(peerId);
        return;
      }

      if (this.pendingInboundPeers.delete(peerId)) {
        this.emitPendingPeerUpdate();
      }
      const wasWaiting = this.status === 'waiting';
      console.log(`[P2P] ✅ Peer connected: ${peerId}`);
      
      // Update last seen for known peers
      const knownPeerIds = getKnownPeerIds();
      if (knownPeerIds.includes(peerId)) {
        updatePeerLastSeen(peerId);
        console.log(`[P2P] 📝 Updated last seen for known peer: ${peerId}`);
      }
      
      this.updateTransportState('peerjs', {
        state: 'active',
        connectedPeers: this.peerjs.getConnectedPeers().length,
        lastError: null,
      });
      if (this.metricsEnabled) {
        this.metrics.recordSuccessfulConnection();
      }
      if (!this.firstPeerConnectedAt) {
        this.firstPeerConnectedAt = Date.now();
        if (this.sessionStartedAt) {
          this.timeToFirstPeerMs = this.firstPeerConnectedAt - this.sessionStartedAt;
        }
      }
      const resolvedUserId = this.resolvePeerUserId(peerId);
      
      // State transition: waiting → online when first peer connects
      if (wasWaiting) {
        this.status = 'online';
        console.log('[P2P] 🎉 State 2→3: First peer connected! Swarm formation begins.');
      }
      
      // Register with health monitor
      this.healthMonitor.registerConnection(peerId);
      this.updateDiscoveryHealth(peerId);
      void this.syncConnectionRecord(peerId, resolvedUserId);

      // Add to bootstrap registry (successful connection)
      this.bootstrap.addPeer(peerId, resolvedUserId ?? 'unknown', true);

      // Request peer list via PEX
      console.log(`[P2P] 🔄 Requesting peer list from ${peerId} (PEX)`);
      this.peerExchange.requestPeers(peerId);

      this.announcePresence(); // Send our content inventory
      this.postSync.handlePeerConnected(peerId).catch(err =>
        console.error('[P2P] Error handling peer connection (posts):', err)
      );
      this.commentSync.handlePeerConnected(peerId).catch(err =>
        console.error('[P2P] Error handling peer connection (comments):', err)
      );

      this.sendPing(peerId);
    });

    // Handle peer disconnections
    this.peerjs.onDisconnection((peerId) => {
      this.pendingOutboundConnections.delete(peerId);
      console.log(`[P2P] Peer disconnected: ${peerId}`);

      // Remove from health monitor
      this.healthMonitor.removeConnection(peerId);
      void this.clearConnectionPeer(peerId);
      this.pendingPings.delete(peerId);
      this.discovery.updatePeerHealth(peerId, { status: 'stale', updatedAt: Date.now() });
      const lostContent = this.discovery.removePeer(peerId);
      this.requestReplication(lostContent, 'shortfall');
      this.postSync.handlePeerDisconnected(peerId).catch(err =>
        console.error('[P2P] Error handling peer disconnection:', err)
      );

      // Check if we lost all peers
      const remainingPeers = this.peerjs.getConnectedPeers();
      this.updateTransportState('peerjs', {
        connectedPeers: remainingPeers.length,
        state: remainingPeers.length > 0 ? 'active' : 'ready',
      });
      if (remainingPeers.length === 0 && this.status === 'online') {
        this.status = 'waiting';
        console.log('[P2P] ⚠️ State 3→2: All peers disconnected, back to waiting state.');
      }
    });

    // Handle peer ready
    this.peerjs.onReady(() => {
      console.log('[P2P] PeerJS ready for connections');
      this.updateTransportState('peerjs', {
        state: 'ready',
        lastError: null,
      });
    });

    // Handle signaling disconnection
    this.peerjs.onSignalingDisconnected(() => {
      console.log('[P2P] ⚠️ State N→1: Signaling lost, attempting reconnection...');
      this.status = 'connecting';
      this.updateTransportState('peerjs', {
        state: 'degraded',
        lastError: 'signaling-disconnected',
      });
    });

    // Handle announce messages
    this.peerjs.onMessage('announce', (msg) => {
      const { userId, peerId, availableContent, room, replicas } = msg.payload as {
        userId: string;
        peerId: string;
        availableContent: string[];
        room?: string;
        replicas?: ReplicaAdvertisement;
      };

      console.log(`[P2P] 📢 Received announce from peer ${peerId} (user: ${userId})`);
      console.log(`[P2P] 📢 Announce details: ${availableContent.length} items, room: ${room || 'none'}`);
      if (replicas) {
        console.log(`[P2P] 📦 Replica summary from ${peerId}: ${replicas.count} items`);
      }

      // Handle room-based discovery
      if (room) {
        console.log(`[P2P] 🚪 Processing room announcement for room: ${room}`);
        this.roomDiscovery.handleAnnouncement(peerId, userId, room);
      }
      
      // Update activity in health monitor
      this.healthMonitor.updateActivity(peerId);
      this.updateDiscoveryHealth(peerId);

      // Add to bootstrap registry
      this.bootstrap.addPeer(peerId, userId, true);

      const isNewPeer = this.discovery.registerPeer(
        peerId,
        userId,
        availableContent,
        {
          replicaCount: replicas?.count,
          replicaManifests: replicas?.manifests,
          health: this.capturePeerHealthSnapshot(peerId)
        }
      );
      void this.syncConnectionRecord(peerId, userId);

      // Update PEX knowledge so this peer can be shared with others
      this.peerExchange.updatePeer({
        peerId,
        userId,
        lastSeen: Date.now(),
        reliability: 1,
        contentCount: availableContent.length
      });

      if (isNewPeer) {
        console.log('[P2P] New peer discovered! Announcing back...');
        this.announcePresence();
      }

      this.requestReplication(availableContent, 'rebalance');

      this.maintainMeshConnectivity('announce', [peerId]);
    });

    // Handle content availability announcements
    this.peerjs.onMessage('content-available', (msg) => {
      const { manifestHashes } = msg.payload as { manifestHashes: string[] };
      const peerId = msg.from;
      
      console.log(`[P2P] Peer ${peerId} has ${manifestHashes.length} new items`);
      
      this.discovery.registerPeer(
        peerId,
        'unknown', // userId not provided in this message
        manifestHashes
      );
      this.requestReplication(manifestHashes, 'rebalance');
    });

    // Handle chunk protocol messages
    this.peerjs.onMessage('chunk', async (msg) => {
      const peerId = msg.from;
      this.discovery.updatePeerSeen(peerId);
      this.healthMonitor.updateActivity(peerId);
      this.updateDiscoveryHealth(peerId);

      if (this.isChunkMessage(msg.payload)) {
        await this.chunkProtocol.handleMessage(peerId, msg.payload as ChunkMessage);
      }
    });

    // Handle post sync messages
    this.peerjs.onMessage('post', async (msg) => {
      const peerId = msg.from;
      this.discovery.updatePeerSeen(peerId);
      this.healthMonitor.updateActivity(peerId);
      this.updateDiscoveryHealth(peerId);

      if (this.postSync.isPostSyncMessage(msg.payload)) {
        await this.postSync.handleMessage(peerId, msg.payload as PostSyncMessage);
      }
    });

    // Handle comment sync messages
    this.peerjs.onMessage('comment', async (msg) => {
      const peerId = msg.from;
      this.discovery.updatePeerSeen(peerId);
      this.healthMonitor.updateActivity(peerId);
      this.updateDiscoveryHealth(peerId);

      if (this.commentSync.isCommentSyncMessage(msg.payload)) {
        await this.commentSync.handleMessage(peerId, msg.payload as CommentSyncMessage);
      }
    });

    // Handle PEX messages
    this.peerjs.onMessage('pex', async (msg) => {
      const peerId = msg.from;
      this.discovery.updatePeerSeen(peerId);
      this.healthMonitor.updateActivity(peerId);
      this.updateDiscoveryHealth(peerId);

      if (this.isPEXMessage(msg.payload)) {
        await this.peerExchange.handleMessage(peerId, msg.payload as PEXMessage);
      }
    });

    // Handle gossip messages
    this.peerjs.onMessage('gossip', (msg) => {
      const peerId = msg.from;
      this.discovery.updatePeerSeen(peerId);
      this.healthMonitor.updateActivity(peerId);
      this.updateDiscoveryHealth(peerId);

      if (this.isGossipMessage(msg.payload)) {
        this.gossip.handleMessage(msg.payload as GossipMessage, peerId);
      }
    });

    this.peerjs.onMessage('ping', (msg) => {
      const peerId = msg.from;
      const payload = msg.payload as { sentAt?: number } | undefined;
      const sentAt = typeof payload?.sentAt === 'number' ? payload.sentAt : Date.now();
      this.discovery.updatePeerSeen(peerId);
      this.healthMonitor.updateActivity(peerId);
      this.updateDiscoveryHealth(peerId);
      this.peerjs.sendToPeer(peerId, 'pong', { sentAt, receivedAt: Date.now() });
    });

    this.peerjs.onMessage('pong', (msg) => {
      const peerId = msg.from;
      const payload = msg.payload as { sentAt?: number } | undefined;
      const fallback = this.pendingPings.get(peerId) ?? Date.now();
      const sentAt = typeof payload?.sentAt === 'number' ? payload.sentAt : fallback;
      const rtt = Math.max(0, Date.now() - sentAt);
      this.pendingPings.delete(peerId);
      this.discovery.updatePeerSeen(peerId);
      this.healthMonitor.recordPong(peerId, rtt);
      this.updateDiscoveryHealth(peerId);
    });
  }

  private isChunkMessage(payload: unknown): payload is ChunkMessage {
    if (!payload || typeof payload !== 'object' || !('type' in payload)) {
      return false;
    }

    const chunkTypes: Set<ChunkMessage['type']> = new Set([
      'request_chunk',
      'chunk_data',
      'chunk_not_found',
      'request_manifest',
      'manifest_data'
    ]);

    return chunkTypes.has((payload as ChunkMessage).type);
  }

  private isPEXMessage(payload: unknown): payload is PEXMessage {
    if (!payload || typeof payload !== 'object' || !('type' in payload)) {
      return false;
    }
    const msg = payload as PEXMessage;
    return msg.type === 'pex_request' || msg.type === 'pex_response';
  }

  private isGossipMessage(payload: unknown): payload is GossipMessage {
    if (!payload || typeof payload !== 'object' || !('type' in payload)) {
      return false;
    }
    return (payload as GossipMessage).type === 'gossip_peers';
  }

  /**
   * Handle peers discovered via PEX
   */
  private handlePEXDiscovery(newPeers: Array<{ peerId: string; userId: string; lastSeen: number; reliability: number; contentCount: number }>): void {
    console.log(`[P2P] 🎉 PEX discovered ${newPeers.length} new peers!`);
    
    for (const peer of newPeers) {
      // Add to bootstrap registry
      this.bootstrap.addPeer(peer.peerId, peer.userId, true);

      // Update PEX knowledge
      this.peerExchange.updatePeer(peer);

      // Attempt connection if not already connected
      if (!this.peerjs.isConnectedTo(peer.peerId) && peer.peerId !== this.peerId) {
        console.log(`[P2P] Auto-connecting to PEX peer: ${peer.peerId}`);
        this.connectToPeer(peer.peerId, { source: 'pex' });
      }
    }

    if (newPeers.length > 0) {
      this.maintainMeshConnectivity('pex');
    }
  }

  /**
   * Get peer list for gossip broadcasting
   */
  private getGossipPeerList(): Array<{ peerId: string; userId: string; lastSeen: number; contentCount: number; replicaCount?: number }> {
    const peers = this.peerExchange.getKnownPeers();
    return peers.map(p => ({
      peerId: p.peerId,
      userId: p.userId,
      lastSeen: p.lastSeen,
      contentCount: p.contentCount,
      replicaCount: this.discovery.getPeer(p.peerId)?.replicaCount
    }));
  }

  /**
   * Handle peers received via gossip
   */
  private handleGossipPeers(peers: Array<{ peerId: string; userId: string; lastSeen: number; contentCount: number; replicaCount?: number }>): void {
    console.log(`[P2P] 📨 Gossip received ${peers.length} peer updates`);

    for (const peer of peers) {
      // Update bootstrap registry
      this.bootstrap.addPeer(peer.peerId, peer.userId, true);

      const knownConnection = peer.userId ? this.knownConnections.get(peer.userId) : undefined;
      if (knownConnection && (knownConnection.peerId ?? knownConnection.lastPeerId) !== peer.peerId) {
        this.knownConnections.set(peer.userId, {
          ...knownConnection,
          lastPeerId: peer.peerId,
          lastPeerIdAt: new Date().toISOString(),
        });
      }

      // Update PEX knowledge
      this.peerExchange.updatePeer({
        ...peer,
        reliability: 0.5 // Default reliability for gossiped peers
      });

      // Opportunistically connect to highly available peers
      if (!this.peerjs.isConnectedTo(peer.peerId) &&
          peer.peerId !== this.peerId &&
          peer.contentCount > 5) {
        console.log(`[P2P] Auto-connecting to gossiped peer: ${peer.peerId} (${peer.contentCount} items)`);
        this.connectToPeer(peer.peerId, { source: 'gossip' });
      }
    }

    if (peers.length > 0) {
      this.maintainMeshConnectivity('gossip');
      this.autoConnectKnownConnections('gossip');
    }
  }

  private maintainMeshConnectivity(reason: string, preferredPeerIds: string[] = []): void {
    if (!this.canAutoConnect()) {
      console.log(`[P2P] ⏸️ Mesh maintenance skipped (${reason}) due to user controls`, this.controlState);
      return;
    }

    const connected = new Set(this.peerjs.getConnectedPeers());
    const target = this.calculateTargetConnections();

    console.log(`[P2P] 🔧 Mesh maintenance (${reason}) - have ${connected.size}, target ${target}`);

    const tryConnect = (peerId: string | null | undefined) => {
      if (!peerId || peerId === this.peerId || connected.has(peerId)) {
        return;
      }
      if (this.isPeerBlocked(peerId)) {
        console.log(`[P2P] 🚫 Skipping blocked peer ${peerId}`);
        return;
      }
      if (this.connectToPeer(peerId, { source: `mesh:${reason}` })) {
        console.log(`[P2P] 🔗 Mesh connect (${reason}): ${peerId}`);
        connected.add(peerId);
      }
    };

    preferredPeerIds.forEach(tryConnect);

    if (connected.size >= target) {
      return;
    }

    const candidateScores = new Map<string, number>();
    const addCandidate = (peerId: string, score: number) => {
      if (!peerId || peerId === this.peerId || connected.has(peerId)) {
        return;
      }
      if (this.isPeerBlocked(peerId)) {
        return;
      }
      const existing = candidateScores.get(peerId);
      if (existing === undefined || score > existing) {
        candidateScores.set(peerId, score);
      }
    };

    for (const peer of this.discovery.getAllPeers()) {
      addCandidate(peer.peerId, peer.availableContent.size + 10);
    }

    for (const peer of this.bootstrap.getBestPeers(10)) {
      addCandidate(peer.peerId, peer.reliability * 100 + 5);
    }

    for (const peer of this.peerExchange.getKnownPeers()) {
      addCandidate(peer.peerId, peer.contentCount + peer.reliability * 50);
    }

    const sortedCandidates = Array.from(candidateScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.maxMeshConnections);

    for (const [peerId] of sortedCandidates) {
      if (connected.size >= target) {
        break;
      }
      tryConnect(peerId);
    }
  }

  private calculateTargetConnections(): number {
    const discovered = this.discovery.getAllPeers().length;
    const dynamicTarget = Math.max(this.desiredConnectionFloor, Math.ceil(discovered / 2));
    return Math.min(this.maxMeshConnections, Math.max(2, dynamicTarget));
  }

  private getManifestCandidatePeers(manifestId: string, sourcePeerId?: string): string[] {
    const candidates = new Set<string>();
    if (sourcePeerId) {
      candidates.add(sourcePeerId);
    }
    this.discovery.getPeersWithContent(manifestId).forEach(peerId => candidates.add(peerId));
    this.peerjs.getConnectedPeers().forEach(peerId => candidates.add(peerId));
    if (this.peerId) {
      candidates.delete(this.peerId);
    }
    return Array.from(candidates);
  }

  private async ensureManifestsAvailable(manifestIds: string[], sourcePeerId?: string): Promise<void> {
    const uniqueIds = Array.from(new Set(manifestIds.filter(Boolean)));

    for (const manifestId of uniqueIds) {
      try {
        const manifest = await this.ensureSingleManifest(manifestId, sourcePeerId);
        if (manifest) {
          await this.ensureChunksForManifest(manifest, sourcePeerId);
        }
      } catch (error) {
        console.error(`[P2P] Failed to synchronize manifest ${manifestId}:`, error);
      }
    }
  }

  private async ensureSingleManifest(manifestId: string, sourcePeerId?: string): Promise<Manifest | null> {
    const existing = await get<Manifest>('manifests', manifestId);
    const existingIsComplete =
      !!existing &&
      typeof existing.fileKey === 'string' &&
      existing.fileKey.length > 0 &&
      Array.isArray(existing.chunks) &&
      existing.chunks.length > 0;

    if (existingIsComplete) {
      return existing;
    }

    const candidates = this.getManifestCandidatePeers(manifestId, sourcePeerId);

    for (const peerId of candidates) {
      if (!peerId || peerId === this.peerId) {
        continue;
      }

      try {
        const manifest = await this.chunkProtocol.requestManifest(peerId, manifestId);
        if (manifest) {
          console.log(`[P2P] ✅ Retrieved manifest ${manifestId} from ${peerId}`);
          return manifest;
        }
      } catch (error) {
        console.error(`[P2P] Manifest request to ${peerId} failed:`, error);
      }
    }

    console.warn(`[P2P] ⚠️ Unable to retrieve manifest ${manifestId} from peers`);
    return existing ?? null;
  }

  private async ensureChunksForManifest(manifest: Manifest, sourcePeerId?: string): Promise<void> {
    const candidates = this.getManifestCandidatePeers(manifest.fileId, sourcePeerId);

    for (const chunkRef of manifest.chunks) {
      const existingChunk = await get<Chunk>('chunks', chunkRef);
      if (existingChunk) {
        continue;
      }

      let fulfilled = false;

      for (const peerId of candidates) {
        if (!peerId || peerId === this.peerId) {
          continue;
        }

        try {
          const data = await this.chunkProtocol.requestChunk(peerId, chunkRef);
          if (data) {
            console.log(`[P2P] ✅ Retrieved chunk ${chunkRef} from ${peerId}`);
            fulfilled = true;
            break;
          }
        } catch (error) {
          console.error(`[P2P] Chunk request ${chunkRef} from ${peerId} failed:`, error);
        }
      }

      if (!fulfilled) {
        console.warn(`[P2P] ⚠️ Chunk ${chunkRef} for manifest ${manifest.fileId} could not be synchronized`);
      }
    }
  }
}
