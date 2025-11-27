/**
 * Hybrid P2P Transport Orchestrator
 * 
 * Orchestrates multiple transport layers working in tandem:
 * - PeerJS (WebRTC) - Primary direct P2P
 * - IntegratedAdapter (WebTorrent DHT + Gun) - Secondary mesh
 * - Gun standalone - Tertiary fallback relay
 * - Blockchain sync across all layers
 * 
 * Design Philosophy:
 * - New Stack (Integrated) = Main connectivity layer
 * - Old Stack (PeerJS) = Stable fallback
 * - Gun = Always-on mesh relay for offline resilience
 * - Blockchain data syncs across ALL connected transports
 */

import { IntegratedAdapter, type IntegratedAdapterOptions } from './integratedAdapter';
import { GunAdapter, type GunAdapterOptions } from './gunAdapter';
import { BlockchainP2PSync, type BlockchainSyncMessage } from '../../blockchain/p2pSync';
import type {
  TransportMessageHandler,
  TransportPeerListener,
  TransportRuntimeStatus,
  TransportStatusListener,
} from './types';

export interface HybridOrchestratorOptions {
  localPeerId: string;
  swarmId: string;
  trackers?: string[];
  gunPeers?: string[];
  onPeerJSFallback?: () => void;
}

type TransportPriority = 'integrated' | 'gun' | 'peerjs';

interface TransportHealth {
  transport: TransportPriority;
  status: TransportRuntimeStatus;
  connectedPeers: number;
  lastActivity: number;
  failureCount: number;
}

export class HybridOrchestrator {
  private integratedAdapter: IntegratedAdapter;
  private gunAdapter: GunAdapter;
  private blockchainSync: BlockchainP2PSync | null = null;
  
  private readonly transportHealth = new Map<TransportPriority, TransportHealth>();
  private readonly peersByTransport = new Map<TransportPriority, Set<string>>();
  private readonly messageHandlers = new Map<string, Set<TransportMessageHandler>>();
  private readonly peerListeners = new Set<TransportPeerListener>();
  private readonly statusListeners = new Set<TransportStatusListener>();
  
  private isStarted = false;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  
  // Adaptive routing - learns which transport works best
  private transportReliability = new Map<TransportPriority, number>([
    ['integrated', 1.0],  // Start with integrated as primary
    ['gun', 0.8],         // Gun as secondary
    ['peerjs', 0.6],      // PeerJS as fallback
  ]);

  constructor(private readonly options: HybridOrchestratorOptions) {
    // Initialize integrated adapter (WebTorrent DHT + Gun + WebRTC)
    this.integratedAdapter = new IntegratedAdapter({
      swarmId: options.swarmId,
      trackers: options.trackers,
      gunPeers: options.gunPeers,
    });

    // Initialize standalone Gun adapter (pure mesh relay)
    this.gunAdapter = new GunAdapter({
      peers: options.gunPeers,
    });

    // Initialize transport health tracking
    this.initializeHealthTracking();
  }

  async start(): Promise<void> {
    if (this.isStarted) return;
    
    console.log('[HybridOrchestrator] 🚀 Starting multi-transport P2P system');
    
    const context = { peerId: this.options.localPeerId };
    
    // Start all transports in parallel
    const startPromises = [
      this.startIntegrated(context),
      this.startGun(context),
    ];
    
    await Promise.allSettled(startPromises);
    
    // Initialize blockchain sync across all transports
    this.initializeBlockchainSync();
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    this.isStarted = true;
    console.log('[HybridOrchestrator] ✅ Multi-transport system active');
    this.logTransportStatus();
  }

  stop(): void {
    if (!this.isStarted) return;
    
    console.log('[HybridOrchestrator] 🛑 Stopping multi-transport system');
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    this.blockchainSync?.stop();
    this.blockchainSync = null;
    
    this.integratedAdapter.stop();
    this.gunAdapter.stop();
    
    this.transportHealth.clear();
    this.peersByTransport.clear();
    
    this.isStarted = false;
  }

  /**
   * Intelligent send with adaptive routing
   * Tries transports in order of reliability, falls back gracefully
   */
  send(channel: string, peerId: string, payload: unknown): 'confirmed' | 'relayed' | 'failed' {
    const orderedTransports = this.getTransportsByReliability();
    
    for (const transport of orderedTransports) {
      const result = this.sendViaTransport(transport, channel, peerId, payload);
      
      if (result === 'confirmed') {
        this.recordTransportSuccess(transport);
        return 'confirmed';
      } else if (result === 'relayed') {
        this.recordTransportSuccess(transport);
        return 'relayed';
      } else {
        this.recordTransportFailure(transport);
      }
    }
    
    console.warn('[HybridOrchestrator] All transports failed to send message');
    return 'failed';
  }

  /**
   * Broadcast to all connected peers across all transports
   */
  broadcast(channel: string, payload: unknown): void {
    const allPeers = this.getAllConnectedPeers();
    
    for (const peerId of allPeers) {
      this.send(channel, peerId, payload);
    }
  }

  onMessage(channel: string, handler: TransportMessageHandler): () => void {
    if (!this.messageHandlers.has(channel)) {
      this.messageHandlers.set(channel, new Set());
    }
    const handlers = this.messageHandlers.get(channel)!;
    handlers.add(handler);

    // Register with all transports
    const unsubscribers = [
      this.integratedAdapter.onMessage(channel, handler),
      this.gunAdapter.onMessage(channel, handler),
    ];

    return () => {
      handlers.delete(handler);
      unsubscribers.forEach(unsub => unsub());
      if (handlers.size === 0) {
        this.messageHandlers.delete(channel);
      }
    };
  }

  onPeerUpdate(listener: TransportPeerListener): () => void {
    this.peerListeners.add(listener);
    listener(this.getAllConnectedPeers());

    // Subscribe to all transport peer updates
    const unsubscribers = [
      this.integratedAdapter.onPeerUpdate(() => this.handlePeerUpdate()),
      this.gunAdapter.onPeerUpdate(() => this.handlePeerUpdate()),
    ];

    return () => {
      this.peerListeners.delete(listener);
      unsubscribers.forEach(unsub => unsub());
    };
  }

  getTransportStatus(): {
    primary: TransportPriority;
    health: Map<TransportPriority, TransportHealth>;
    totalPeers: number;
  } {
    return {
      primary: this.getPrimaryTransport(),
      health: new Map(this.transportHealth),
      totalPeers: this.getAllConnectedPeers().length,
    };
  }

  // Blockchain Integration

  private initializeBlockchainSync(): void {
    this.blockchainSync = new BlockchainP2PSync(
      (type: string, payload: unknown) => {
        // Broadcast blockchain messages across all transports
        this.broadcast('blockchain', payload);
      },
      undefined, // onBlockReceived - handled by chain
      undefined  // onChainReceived - handled by chain
    );

    // Start blockchain sync
    this.blockchainSync.start();

    // Handle incoming blockchain messages
    this.onMessage('blockchain', async (peerId: string, payload: unknown) => {
      if (this.blockchainSync && this.isBlockchainMessage(payload)) {
        await this.blockchainSync.handleMessage(payload, peerId);
      }
    });

    // Listen for reward pool updates from local operations
    if (typeof window !== 'undefined') {
      window.addEventListener('reward-pool-update', ((event: CustomEvent) => {
        if (this.blockchainSync && event.detail) {
          console.log('[HybridOrchestrator] Broadcasting reward pool update to peers');
          this.blockchainSync.broadcastRewardPoolUpdate(event.detail);
        }
      }) as EventListener);
    }

    console.log('[HybridOrchestrator] Blockchain sync initialized across all transports');
  }

  private isBlockchainMessage(payload: unknown): payload is BlockchainSyncMessage {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'type' in payload &&
      (payload as { type: string }).type === 'blockchain_sync'
    );
  }

  // Transport Management

  private async startIntegrated(context: { peerId: string }): Promise<void> {
    try {
      await this.integratedAdapter.start(context);
      
      this.integratedAdapter.onStatusChange((status) => {
        const health = this.transportHealth.get('integrated');
        if (health) {
          health.status = status;
          health.lastActivity = Date.now();
        }
      });
      
      console.log('[HybridOrchestrator] ✅ Integrated adapter started (PRIMARY)');
    } catch (error) {
      console.error('[HybridOrchestrator] ❌ Integrated adapter failed:', error);
      this.recordTransportFailure('integrated');
    }
  }

  private async startGun(context: { peerId: string }): Promise<void> {
    try {
      await this.gunAdapter.start(context);
      
      this.gunAdapter.onStatusChange((status) => {
        const health = this.transportHealth.get('gun');
        if (health) {
          health.status = status;
          health.lastActivity = Date.now();
        }
      });
      
      console.log('[HybridOrchestrator] ✅ Gun adapter started (SECONDARY)');
    } catch (error) {
      console.error('[HybridOrchestrator] ❌ Gun adapter failed:', error);
      this.recordTransportFailure('gun');
    }
  }

  private sendViaTransport(
    transport: TransportPriority,
    channel: string,
    peerId: string,
    payload: unknown
  ): 'confirmed' | 'relayed' | 'failed' {
    try {
      switch (transport) {
        case 'integrated':
          return this.integratedAdapter.send(channel, peerId, payload);
        case 'gun':
          return this.gunAdapter.send(channel, peerId, payload) ? 'relayed' : 'failed';
        case 'peerjs':
          // PeerJS fallback handled by manager
          return 'failed';
        default:
          return 'failed';
      }
    } catch (error) {
      console.warn(`[HybridOrchestrator] Send via ${transport} failed:`, error);
      return 'failed';
    }
  }

  private initializeHealthTracking(): void {
    const transports: TransportPriority[] = ['integrated', 'gun', 'peerjs'];
    
    for (const transport of transports) {
      this.transportHealth.set(transport, {
        transport,
        status: { state: 'idle', lastError: null },
        connectedPeers: 0,
        lastActivity: Date.now(),
        failureCount: 0,
      });
      
      this.peersByTransport.set(transport, new Set());
    }
  }

  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
      this.adjustTransportPriorities();
    }, 30000); // Check every 30 seconds
  }

  private performHealthCheck(): void {
    const now = Date.now();
    const staleThreshold = 120000; // 2 minutes
    
    for (const [transport, health] of this.transportHealth) {
      const timeSinceActivity = now - health.lastActivity;
      
      if (timeSinceActivity > staleThreshold && health.status.state === 'active') {
        console.warn(`[HybridOrchestrator] Transport ${transport} appears stale`);
        health.status = { state: 'degraded', lastError: 'No recent activity' };
      }
    }
  }

  private adjustTransportPriorities(): void {
    // Adjust reliability scores based on health
    for (const [transport, health] of this.transportHealth) {
      const currentReliability = this.transportReliability.get(transport) || 0.5;
      
      let newReliability = currentReliability;
      
      if (health.status.state === 'active' || health.status.state === 'ready') {
        newReliability = Math.min(1.0, currentReliability + 0.05);
      } else if (health.status.state === 'degraded' || health.status.state === 'error') {
        newReliability = Math.max(0.1, currentReliability - 0.1);
      }
      
      // Factor in peer count
      if (health.connectedPeers > 0) {
        newReliability = Math.min(1.0, newReliability + 0.05);
      }
      
      this.transportReliability.set(transport, newReliability);
    }
  }

  private getTransportsByReliability(): TransportPriority[] {
    return Array.from(this.transportReliability.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by reliability descending
      .map(([transport]) => transport);
  }

  private getPrimaryTransport(): TransportPriority {
    return this.getTransportsByReliability()[0] || 'integrated';
  }

  private recordTransportSuccess(transport: TransportPriority): void {
    const health = this.transportHealth.get(transport);
    if (health) {
      health.lastActivity = Date.now();
      health.failureCount = Math.max(0, health.failureCount - 1);
    }
  }

  private recordTransportFailure(transport: TransportPriority): void {
    const health = this.transportHealth.get(transport);
    if (health) {
      health.failureCount++;
    }
  }

  private handlePeerUpdate(): void {
    // Aggregate peers from all transports
    const allPeers = this.getAllConnectedPeers();
    
    // Update peer counts in health tracking
    // Note: This is approximate since we're deduplicating
    for (const listener of this.peerListeners) {
      try {
        listener(allPeers);
      } catch (error) {
        console.warn('[HybridOrchestrator] Peer listener failed:', error);
      }
    }
  }

  private getAllConnectedPeers(): string[] {
    const peerSet = new Set<string>();
    
    for (const peers of this.peersByTransport.values()) {
      for (const peerId of peers) {
        peerSet.add(peerId);
      }
    }
    
    return Array.from(peerSet);
  }

  private logTransportStatus(): void {
    console.log('[HybridOrchestrator] 📊 Transport Status:');
    
    for (const [transport, health] of this.transportHealth) {
      const reliability = this.transportReliability.get(transport) || 0;
      console.log(`  ${transport}:`, {
        state: health.status.state,
        reliability: (reliability * 100).toFixed(0) + '%',
        peers: health.connectedPeers,
        failures: health.failureCount,
      });
    }
  }
}
