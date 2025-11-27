/**
 * SWARM Mesh Adapter
 * 
 * Bridges SwarmMesh into the useP2P hook interface
 * Provides a compatibility layer so SwarmMesh can be used as a drop-in replacement
 */

import { getSwarmMesh, destroySwarmMesh, type SwarmMesh } from './swarmMesh';
import type { P2PStats, P2PStatus } from './manager';

export interface SwarmMeshAdapterOptions {
  localPeerId: string;
  swarmId?: string;
}

export class SwarmMeshAdapter {
  private mesh: SwarmMesh;
  private localPeerId: string;

  constructor(options: SwarmMeshAdapterOptions) {
    this.localPeerId = options.localPeerId;
    this.mesh = getSwarmMesh({
      localPeerId: options.localPeerId,
      swarmId: options.swarmId || 'swarm-space-main'
    });
  }

  async start(): Promise<void> {
    console.log('[SwarmMeshAdapter] 🌐 Starting unified SWARM Mesh');
    await this.mesh.start();
    console.log('[SwarmMeshAdapter] ✅ SWARM Mesh active');
  }

  stop(): void {
    console.log('[SwarmMeshAdapter] 🛑 Stopping SWARM Mesh');
    this.mesh.stop();
    destroySwarmMesh();
  }

  getStats(): P2PStats {
    const meshStats = this.mesh.getStats();
    
    return {
      status: meshStats.totalPeers > 0 ? ('online' as P2PStatus) : ('waiting' as P2PStatus),
      connectedPeers: meshStats.totalPeers,
      discoveredPeers: meshStats.totalPeers,
      localContent: 0,
      networkContent: 0,
      activeRequests: 0,
      rendezvousPeers: 0,
      lastRendezvousSync: null,
      uptimeMs: 0,
      bytesUploaded: 0,
      bytesDownloaded: 0,
      relayCount: 0,
      pingCount: 0,
      connectionAttempts: 0,
      successfulConnections: meshStats.directConnections,
      failedConnectionAttempts: 0,
      rendezvousAttempts: 0,
      rendezvousSuccesses: 0,
      rendezvousFailures: 0,
      rendezvousFailureStreak: 0,
      timeToFirstPeerMs: null,
      lastBeaconLatencyMs: null,
      metrics: {
        uptimeMs: 0,
        bytesUploaded: 0,
        bytesDownloaded: 0,
        relayCount: 0,
        pingCount: 0,
        connectionAttempts: 0,
        successfulConnections: meshStats.directConnections,
        failedConnectionAttempts: 0,
        rendezvousAttempts: 0,
        rendezvousSuccesses: 0,
        rendezvousFailures: 0,
      },
      signalingEndpointUrl: null,
      signalingEndpointLabel: 'SWARM Mesh',
      signalingEndpointId: 'swarm-mesh',
      transportFallbacks: 0,
      lastTransportFallbackAt: null,
      transports: [],
    };
  }

  getMeshStats() {
    return this.mesh.getStats();
  }

  connect(peerId: string): void {
    console.log('[SwarmMeshAdapter] Connecting to peer via mesh:', peerId);
    // SWARM Mesh handles connections automatically through integrated transports
  }

  getPeerId(): string {
    return this.localPeerId;
  }
}
