/**
 * SWARM Mesh Adapter
 * 
 * Bridges SwarmMesh into the useP2P hook interface
 * Provides a compatibility layer so SwarmMesh can be used as a drop-in replacement
 */

import { getSwarmMesh, destroySwarmMesh, type SwarmMesh } from './swarmMesh';
import type { P2PStats, P2PStatus } from './manager';
import type { Post, Comment } from '@/types';

// Default Gun relay servers for peer discovery and message relay
const DEFAULT_GUN_PEERS = [
  'https://gun-manhattan.herokuapp.com/gun',
  'https://gun-us.herokuapp.com/gun',
  'https://gun-eu.herokuapp.com/gun',
];

// Default WebTorrent trackers for DHT discovery
const DEFAULT_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
];

export interface SwarmMeshAdapterOptions {
  localPeerId: string;
  swarmId?: string;
  gunPeers?: string[];
  trackers?: string[];
}

export class SwarmMeshAdapter {
  private mesh: SwarmMesh;
  private localPeerId: string;

  constructor(options: SwarmMeshAdapterOptions) {
    this.localPeerId = options.localPeerId;
    this.mesh = getSwarmMesh({
      localPeerId: options.localPeerId,
      swarmId: options.swarmId || 'swarm-space-main',
      gunPeers: options.gunPeers || DEFAULT_GUN_PEERS,
      trackers: options.trackers || DEFAULT_TRACKERS,
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
    const isConnected = meshStats.totalPeers > 0;
    
    return {
      status: (isConnected ? 'online' : 'waiting') as P2PStatus,
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
    this.mesh.connectToPeer(peerId);
  }

  getPeerId(): string {
    return this.localPeerId;
  }

  /**
   * Broadcast a post to all connected peers
   */
  broadcastPost(post: Post): void {
    console.log('[SwarmMeshAdapter] 📢 Broadcasting post:', post.id);
    this.mesh.broadcastPost(post);
  }

  /**
   * Get connected peer IDs
   */
  getConnectedPeers(): string[] {
    return this.mesh.getConnectedPeers();
  }
}
