import { useMemo } from "react";
import { useP2PContext } from "@/contexts/P2PContext";
import { getFeatureFlags } from "@/config/featureFlags";

export interface MarketGate {
  canTrade: boolean;
  activePeers: number;
  reason: string | null;
}

/**
 * useMarketGate — market/trade actions require an active peer connection
 * so state mutations can propagate through the mesh.
 */
export function useMarketGate(): MarketGate {
  const { isEnabled, stats, getActivePeerConnections } = useP2PContext();
  return useMemo(() => {
    const swarmModeEnabled = getFeatureFlags().swarmMeshMode;
    const activePeers = Math.max(stats.connectedPeers, getActivePeerConnections().length);
    const canTrade = swarmModeEnabled && isEnabled && activePeers > 0;
    const reason = canTrade
      ? null
      : !swarmModeEnabled
        ? "SWARM Mesh mode is disabled."
        : !isEnabled
          ? "Enable P2P networking to trade."
          : "Markets only operate while connected to another peer.";
    return { canTrade, activePeers, reason };
  }, [isEnabled, stats.connectedPeers, getActivePeerConnections]);
}