import { useMemo } from 'react';
import { useP2PContext } from '@/contexts/P2PContext';
import type { ConnectionHealthSummary } from '@/lib/p2p/connectionHealth';
import type {
  P2PStats,
  P2PControlState,
  PendingPeer,
  PeerConnectionDetail,
} from '@/lib/p2p/manager';
import type { DiscoveredPeer } from '@/lib/p2p/discovery';
import type { P2PDiagnosticEvent } from '@/lib/p2p/diagnostics';

export interface NodeDashboardSource {
  stats: P2PStats;
  isEnabled: boolean;
  isConnecting: boolean;
  isRendezvousMeshEnabled: boolean;
  rendezvousDisabledReason: 'capability' | 'failure' | null;
  controls: P2PControlState;
  blockedPeers: string[];
  pendingPeers: PendingPeer[];
  discoveredPeers: DiscoveredPeer[];
  peerId: string | null;
  connectionSummary: ConnectionHealthSummary;
  connections: PeerConnectionDetail[];
  diagnostics: P2PDiagnosticEvent[];
}

export interface NodeDashboardSnapshot {
  status: P2PStats['status'];
  isEnabled: boolean;
  isConnecting: boolean;
  peerId: string | null;
  signaling: {
    endpointId: string | null;
    endpointLabel: string | null;
    endpointUrl: string | null;
  };
  rendezvous: {
    enabled: boolean;
    disabledReason: 'capability' | 'failure' | null;
    peerCount: number;
    lastSync: number | null;
    failureStreak: number;
    successRate: number;
  };
  metrics: {
    uptimeMs: number;
    bytesUploaded: number;
    bytesDownloaded: number;
    relayCount: number;
    pingCount: number;
    failureRate: number;
    rendezvousSuccessRate: number;
    avgRttMs: number;
    lastBeaconLatencyMs: number | null;
  };
  connectionHealth: {
    summary: ConnectionHealthSummary;
    lastHandshakeAt: number | null;
    strength: number;
    connections: PeerConnectionDetail[];
  };
  peers: {
    connected: PeerConnectionDetail[];
    discovered: DiscoveredPeer[];
    blocked: string[];
    pending: PendingPeer[];
    totalDiscovered: number;
  };
  controls: P2PControlState;
  diagnostics: P2PDiagnosticEvent[];
}

export function buildNodeDashboardSnapshot(source: NodeDashboardSource): NodeDashboardSnapshot {
  const failureRate = source.stats.connectionAttempts > 0
    ? source.stats.failedConnectionAttempts / source.stats.connectionAttempts
    : 0;
  const rendezvousSuccessRate = source.stats.rendezvousAttempts > 0
    ? source.stats.rendezvousSuccesses / source.stats.rendezvousAttempts
    : 0;
  const lastHandshakeAt = source.connections.reduce<number | null>((latest, connection) => {
    if (!connection.lastActivity) {
      return latest;
    }
    if (latest === null) {
      return connection.lastActivity;
    }
    return Math.max(latest, connection.lastActivity);
  }, null);
  const strength = source.connectionSummary.total > 0
    ? source.connectionSummary.healthy / source.connectionSummary.total
    : 0;

  const sortedConnections = [...source.connections].sort((a, b) => {
    const aTime = a.lastActivity ?? a.connectedAt ?? 0;
    const bTime = b.lastActivity ?? b.connectedAt ?? 0;
    return bTime - aTime;
  });

  const sortedDiscovered = [...source.discoveredPeers].sort((a, b) => {
    const aTime = a.lastSeen?.getTime?.() ?? 0;
    const bTime = b.lastSeen?.getTime?.() ?? 0;
    return bTime - aTime;
  });

  return {
    status: source.stats.status,
    isEnabled: source.isEnabled,
    isConnecting: source.isConnecting,
    peerId: source.peerId,
    signaling: {
      endpointId: source.stats.signalingEndpointId,
      endpointLabel: source.stats.signalingEndpointLabel,
      endpointUrl: source.stats.signalingEndpointUrl,
    },
    rendezvous: {
      enabled: source.isRendezvousMeshEnabled,
      disabledReason: source.rendezvousDisabledReason,
      peerCount: source.stats.rendezvousPeers,
      lastSync: source.stats.lastRendezvousSync,
      failureStreak: source.stats.rendezvousFailureStreak,
      successRate: rendezvousSuccessRate,
    },
    metrics: {
      uptimeMs: source.stats.metrics.uptimeMs,
      bytesUploaded: source.stats.bytesUploaded,
      bytesDownloaded: source.stats.bytesDownloaded,
      relayCount: source.stats.relayCount,
      pingCount: source.stats.pingCount,
      failureRate,
      rendezvousSuccessRate,
      avgRttMs: source.connectionSummary.avgRttMs,
      lastBeaconLatencyMs: source.stats.lastBeaconLatencyMs,
    },
    connectionHealth: {
      summary: source.connectionSummary,
      lastHandshakeAt,
      strength,
      connections: sortedConnections,
    },
    peers: {
      connected: sortedConnections,
      discovered: sortedDiscovered,
      blocked: source.blockedPeers,
      pending: source.pendingPeers,
      totalDiscovered: sortedDiscovered.length,
    },
    controls: source.controls,
    diagnostics: source.diagnostics,
  };
}

export function useNodeDashboard(): NodeDashboardSnapshot {
  const {
    stats,
    isEnabled,
    isConnecting,
    isRendezvousMeshEnabled,
    rendezvousDisabledReason,
    controls,
    blockedPeers,
    pendingPeers,
    getDiscoveredPeers,
    getPeerId,
    getConnectionHealthSummary,
    getActivePeerConnections,
    diagnostics,
  } = useP2PContext();

  const discoveredPeers = useMemo(() => getDiscoveredPeers(), [getDiscoveredPeers, stats.discoveredPeers]);
  const connectionSummary = useMemo(
    () => getConnectionHealthSummary(),
    [getConnectionHealthSummary, stats.connectedPeers, stats.metrics.pingCount]
  );
  const connections = useMemo(
    () => getActivePeerConnections(),
    [getActivePeerConnections, stats.connectedPeers]
  );

  const peerId = getPeerId();

  return useMemo(
    () => buildNodeDashboardSnapshot({
      stats,
      isEnabled,
      isConnecting,
      isRendezvousMeshEnabled,
      rendezvousDisabledReason,
      controls,
      blockedPeers,
      pendingPeers,
      discoveredPeers,
      peerId,
      connectionSummary,
      connections,
      diagnostics,
    }),
    [
      stats,
      isEnabled,
      isConnecting,
      isRendezvousMeshEnabled,
      rendezvousDisabledReason,
      controls,
      blockedPeers,
      pendingPeers,
      discoveredPeers,
      peerId,
      connectionSummary,
      connections,
      diagnostics,
    ]
  );
}
