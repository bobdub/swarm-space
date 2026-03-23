/**
 * AutoMiningService — Background mining rewards based on REAL mesh activity.
 * Only rewards when connected to SWARM Mesh with active peers.
 * Rewards are proportional to actual network contributions (blocks, heartbeats, relays).
 */

import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useP2PContext } from "@/contexts/P2PContext";
import { getFeatureFlags } from "@/config/featureFlags";
import { rewardTransactionProcessing, rewardSpaceHosting } from "@/lib/blockchain/miningRewards";
import { getSwarmMeshStandalone, type MiningStats } from "@/lib/p2p/swarmMesh.standalone";
import { toast } from "sonner";

// Module-level flag — survives re-renders and re-mounts from navigation
let globalNotified = false;

// Track last-seen stats to only reward NEW activity
let lastSeenStats: MiningStats | null = null;

export function AutoMiningService() {
  const { user } = useAuth();
  const { isEnabled, stats } = useP2PContext();
  const miningRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const flags = getFeatureFlags();
    const shouldMine = flags.swarmMeshMode && isEnabled && stats.connectedPeers > 0 && !!user;

    if (shouldMine && !miningRef.current) {
      miningRef.current = true;
      if (!globalNotified) {
        toast.success("Mining active — you're strengthening the network", { id: "auto-mine", duration: 3000 });
        globalNotified = true;
      }

      // Snapshot current stats so we only reward deltas
      try {
        lastSeenStats = getSwarmMeshStandalone().getMiningStats();
      } catch {
        lastSeenStats = null;
      }

      intervalRef.current = setInterval(() => {
        if (!user) return;

        try {
          const mesh = getSwarmMeshStandalone();
          const current = mesh.getMiningStats();

          if (!lastSeenStats) {
            lastSeenStats = current;
            return;
          }

          // Calculate REAL deltas since last reward cycle
          const newBlocks = current.blocksMinedTotal - (lastSeenStats.blocksMinedTotal ?? 0);
          const newRelays = current.blocksRelayed - (lastSeenStats.blocksRelayed ?? 0);
          const newHeartbeats = current.heartbeatsSent - (lastSeenStats.heartbeatsSent ?? 0);
          const newAcks = current.acksReceived - (lastSeenStats.acksReceived ?? 0);
          const newPeersDiscovered = current.peersDiscovered - (lastSeenStats.peersDiscovered ?? 0);

          // Blocks produced + relayed = "mesh work" (replaces fake txCount)
          const meshWork = newBlocks + newRelays + newPeersDiscovered;
          // Heartbeats + acks = "network service" (replaces fake mbHosted)
          const networkService = newHeartbeats + newAcks;

          if (meshWork > 0) {
            void rewardTransactionProcessing(user.id, meshWork);
          }
          if (networkService > 0) {
            void rewardSpaceHosting(user.id, Math.ceil(networkService / 10));
          }

          lastSeenStats = current;
        } catch {
          // Mesh not available — skip this cycle
        }
      }, 30_000);
    }

    if (!shouldMine && miningRef.current) {
      miningRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isEnabled, stats.connectedPeers, user]);

  return null;
}
