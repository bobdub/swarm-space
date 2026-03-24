import { useMemo } from 'react';
import { useP2PContext } from '@/contexts/P2PContext';
import {
  buildNodeDashboardSnapshot,
  type NodeDashboardSnapshot,
} from '@/hooks/nodeDashboardSnapshot';

export type {
  NodeDashboardSource,
  NodeDashboardSnapshot,
} from '@/hooks/nodeDashboardSnapshot';

export { buildNodeDashboardSnapshot } from '@/hooks/nodeDashboardSnapshot';

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
    getNodeId,
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
      nodeId: getNodeId(),
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
      getNodeId,
      getConnectionHealthSummary,
      getActivePeerConnections,
      diagnostics,
    ]
  );
}
