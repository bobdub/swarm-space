/**
 * Hybrid Transport Integration Layer
 * 
 * DEPRECATED: Being replaced by unified SwarmMesh system.
 * Maintained for backward compatibility during migration.
 * 
 * @deprecated Use SwarmMesh instead
 */

import { HybridOrchestrator, type HybridOrchestratorOptions } from './transports/hybridOrchestrator';
import { getConnectionResilience, type CircuitBreakerState } from './connectionResilience';
import type { P2PManager } from './manager';
import { SwarmMesh, getSwarmMesh, type SwarmMeshOptions } from './swarmMesh';

export interface HybridIntegrationConfig {
  enabled: boolean;
  useAsPreferredTransport: boolean;
  fallbackToPeerJS: boolean;
  useUnifiedMesh?: boolean; // New: Use unified SWARM Mesh
}

export class HybridIntegration {
  private orchestrator: HybridOrchestrator | null = null;
  private swarmMesh: SwarmMesh | null = null;
  private resilience = getConnectionResilience();
  private config: HybridIntegrationConfig;

  constructor(
    private manager: P2PManager,
    config: Partial<HybridIntegrationConfig> = {}
  ) {
    this.config = {
      enabled: config.enabled ?? true,
      useAsPreferredTransport: config.useAsPreferredTransport ?? true,
      fallbackToPeerJS: config.fallbackToPeerJS ?? true,
      useUnifiedMesh: config.useUnifiedMesh ?? true, // Default to unified mesh
    };
  }

  async initialize(options: HybridOrchestratorOptions): Promise<void> {
    if (!this.config.enabled) {
      console.log('[HybridIntegration] Hybrid transport disabled, using legacy stack');
      return;
    }

    // Use unified SWARM Mesh if enabled
    if (this.config.useUnifiedMesh) {
      console.log('[HybridIntegration] 🌐 Initializing unified SWARM Mesh');
      
      const meshOptions: SwarmMeshOptions = {
        localPeerId: options.localPeerId,
        swarmId: options.swarmId || 'swarm-space-mesh',
        trackers: options.trackers,
        gunPeers: options.gunPeers,
      };

      this.swarmMesh = getSwarmMesh(meshOptions);
      await this.swarmMesh.start();

      this.setupMeshIntegration();
      console.log('[HybridIntegration] ✅ SWARM Mesh active');
      return;
    }

    // Legacy hybrid orchestrator (deprecated)
    console.log('[HybridIntegration] 🚀 Initializing legacy hybrid transport layer');

    this.orchestrator = new HybridOrchestrator(options);
    await this.orchestrator.start();

    this.setupIntegration();

    console.log('[HybridIntegration] ✅ Hybrid transport layer active');
  }

  destroy(): void {
    if (this.swarmMesh) {
      this.swarmMesh.stop();
      this.swarmMesh = null;
    }
    
    if (this.orchestrator) {
      this.orchestrator.stop();
      this.orchestrator = null;
    }
  }

  /**
   * Send message via unified mesh or hybrid orchestrator
   */
  send(channel: string, peerId: string, payload: unknown): 'confirmed' | 'relayed' | 'failed' {
    // Check circuit breaker
    if (!this.resilience.canAttemptConnection(peerId)) {
      console.warn(`[HybridIntegration] Circuit breaker OPEN for ${peerId}, skipping send`);
      return 'failed';
    }

    // Use SWARM Mesh if available
    if (this.swarmMesh) {
      const result = this.swarmMesh.send(channel, peerId, payload);
      
      // Update circuit breaker state
      if (result === 'confirmed' || result === 'relayed') {
        this.resilience.recordSuccess(peerId);
      } else {
        this.resilience.recordFailure(peerId);
      }
      
      return result;
    }

    // Fallback to legacy orchestrator
    if (!this.orchestrator) {
      return 'failed';
    }

    const result = this.orchestrator.send(channel, peerId, payload);

    // Update circuit breaker state
    if (result === 'confirmed' || result === 'relayed') {
      this.resilience.recordSuccess(peerId);
    } else {
      this.resilience.recordFailure(peerId);
    }

    return result;
  }

  /**
   * Broadcast via unified mesh or hybrid orchestrator
   */
  broadcast(channel: string, payload: unknown): void {
    if (this.swarmMesh) {
      this.swarmMesh.broadcast(channel, payload);
      return;
    }

    if (this.orchestrator) {
      this.orchestrator.broadcast(channel, payload);
    }
  }

  /**
   * Check if peer should be attempted based on circuit breaker
   */
  shouldAttemptPeer(peerId: string): boolean {
    return this.resilience.canAttemptConnection(peerId);
  }

  /**
   * Get circuit breaker state for diagnostics
   */
  getCircuitBreakerState(peerId: string): CircuitBreakerState | null {
    return this.resilience.getState(peerId);
  }

  /**
   * Get resilience stats for monitoring
   */
  getResilienceStats() {
    return this.resilience.getStats();
  }

  /**
   * Get transport status from orchestrator
   */
  getTransportStatus() {
    return this.orchestrator?.getTransportStatus() || null;
  }

  /**
   * Force reset circuit breaker (admin action)
   */
  resetCircuitBreaker(peerId: string): void {
    this.resilience.forceReset(peerId);
    console.log(`[HybridIntegration] Circuit breaker reset for ${peerId}`);
  }

  /**
   * Reset all open circuit breakers
   */
  resetAllCircuitBreakers(): void {
    const openBreakers = this.resilience.getOpenBreakers();
    openBreakers.forEach(peerId => this.resilience.forceReset(peerId));
    console.log(`[HybridIntegration] Reset ${openBreakers.length} circuit breakers`);
  }

  isEnabled(): boolean {
    return this.config.enabled && (this.swarmMesh !== null || this.orchestrator !== null);
  }

  private setupIntegration(): void {
    if (!this.orchestrator) return;

    // Subscribe to peer updates from orchestrator
    this.orchestrator.onPeerUpdate((peerIds) => {
      console.log(`[HybridIntegration] Peer update: ${peerIds.length} peers via hybrid transports`);
    });

    console.log('[HybridIntegration] Integration hooks established');
  }

  private setupMeshIntegration(): void {
    if (!this.swarmMesh) return;

    // Subscribe to peer updates from SWARM Mesh
    this.swarmMesh.onPeerUpdate((peerIds) => {
      console.log(`[SWARM Mesh] 🌐 Peer update: ${peerIds.length} peers connected`);
    });

    // Log mesh stats periodically
    setInterval(() => {
      const stats = this.swarmMesh?.getStats();
      if (stats) {
        console.log(`[SWARM Mesh] 📊 Stats: ${stats.totalPeers} peers, ${stats.directConnections} direct, health: ${stats.meshHealth}%`);
      }
    }, 30000); // Every 30 seconds

    console.log('[SWARM Mesh] 🔗 Integration hooks established');
  }
}

/**
 * Helper to check circuit breaker before connection attempt
 */
export function shouldAttemptConnection(peerId: string): boolean {
  const resilience = getConnectionResilience();
  return resilience.canAttemptConnection(peerId);
}

/**
 * Record connection success for circuit breaker
 */
export function recordConnectionSuccess(peerId: string): void {
  const resilience = getConnectionResilience();
  resilience.recordSuccess(peerId);
}

/**
 * Record connection failure for circuit breaker
 */
export function recordConnectionFailure(peerId: string, error?: string): void {
  const resilience = getConnectionResilience();
  resilience.recordFailure(peerId, error);
}
