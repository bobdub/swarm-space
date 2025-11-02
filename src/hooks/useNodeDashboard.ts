import { useMemo } from 'react';
import { useP2PContext } from '@/contexts/P2PContext';
import type { ConnectionHealthSummary } from '@/lib/p2p/connectionHealth';
import type { BlocklistEntry } from '@/lib/p2p/blocklistStore';
import type {
  P2PStats,
  P2PControlState,
  ControlResumeTargets,
  PendingPeer,
  PeerConnectionDetail,
  P2PTransportStatus,
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
  controlResumes: ControlResumeTargets;
  blockedPeers: string[];
  blocklist: BlocklistEntry[];
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
    avgPacketLoss: number;
    handshakeConfidence: number;
    bandwidthKbps: number;
    timeToFirstPeerMs: number | null;
  };
  connectionHealth: {
    summary: ConnectionHealthSummary;
    lastHandshakeAt: number | null;
    strength: number;
    packetLoss: number;
    handshakeConfidence: number;
    connections: PeerConnectionDetail[];
  };
  peers: {
    connected: PeerConnectionDetail[];
    discovered: DiscoveredPeer[];
    blocked: string[];
    pending: PendingPeer[];
    totalDiscovered: number;
  };
  blocklist: {
    inbound: BlocklistEntry[];
    outbound: BlocklistEntry[];
    all: BlocklistEntry[];
  };
  controls: P2PControlState;
  controlResumes: ControlResumeTargets;
  diagnostics: P2PDiagnosticEvent[];
  transports: {
    fallbackTotal: number;
    lastFallbackAt: number | null;
    status: P2PTransportStatus[];
  };
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

  const inboundBlocks = source.blocklist.filter((entry) => entry.direction === 'all' || entry.direction === 'inbound');
  const outboundBlocks = source.blocklist.filter((entry) => entry.direction === 'all' || entry.direction === 'outbound');
  const bandwidthKbps = (() => {
    const uptimeSeconds = source.stats.metrics.uptimeMs > 0 ? source.stats.metrics.uptimeMs / 1000 : 0;
    if (uptimeSeconds <= 0) {
      return 0;
    }
    const totalBytes = source.stats.bytesUploaded + source.stats.bytesDownloaded;
    return (totalBytes * 8) / uptimeSeconds / 1000;
  })();

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
      avgPacketLoss: source.connectionSummary.avgPacketLoss,
      handshakeConfidence: source.connectionSummary.handshakeConfidence,
      bandwidthKbps,
      timeToFirstPeerMs: source.stats.timeToFirstPeerMs,
    },
    connectionHealth: {
      summary: source.connectionSummary,
      lastHandshakeAt,
      strength,
      packetLoss: source.connectionSummary.avgPacketLoss,
      handshakeConfidence: source.connectionSummary.handshakeConfidence,
      connections: sortedConnections,
    },
    peers: {
      connected: sortedConnections,
      discovered: sortedDiscovered,
      blocked: source.blockedPeers,
      pending: source.pendingPeers,
      totalDiscovered: sortedDiscovered.length,
    },
    blocklist: {
      inbound: inboundBlocks,
      outbound: outboundBlocks,
      all: source.blocklist,
    },
    controls: source.controls,
    controlResumes: source.controlResumes,
    diagnostics: source.diagnostics,
    transports: {
      fallbackTotal: source.stats.transportFallbacks,
      lastFallbackAt: source.stats.lastTransportFallbackAt,
      status: source.stats.transports,
    },
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
    controlResumes,
    blockedPeers,
    blocklist,
    pendingPeers,
    getDiscoveredPeers,
    getPeerId,
    getConnectionHealthSummary,
    getActivePeerConnections,
    diagnostics,
  } = useP2PContext();

  return useMemo(
    () => buildNodeDashboardSnapshot({
      stats,
      isEnabled,
      isConnecting,
      isRendezvousMeshEnabled,
      rendezvousDisabledReason,
      controls,
      controlResumes,
      blockedPeers,
      blocklist,
      pendingPeers,
      discoveredPeers: getDiscoveredPeers(),
      peerId: getPeerId(),
      connectionSummary: getConnectionHealthSummary(),
      connections: getActivePeerConnections(),
      diagnostics,
    }),
    [
      stats,
      isEnabled,
      isConnecting,
      isRendezvousMeshEnabled,
      rendezvousDisabledReason,
      controls,
      controlResumes,
      blockedPeers,
      blocklist,
      pendingPeers,
      getDiscoveredPeers,
      getPeerId,
      getConnectionHealthSummary,
      getActivePeerConnections,
      diagnostics,
    ]
  );
}
