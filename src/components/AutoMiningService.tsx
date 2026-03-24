/**
 * AutoMiningService — Background mining rewards based on REAL mesh activity.
 * Only rewards when connected to SWARM Mesh with active peers.
 * CREATOR Proof: Only CONFIRMED blocks (peer-consensus-verified) earn rewards.
 * Hollow blocks (no content activity) earn 50% of normal rate.
 *
 * BUG-10 FIX: Now persists MiningSession to IndexedDB so validateMineHealth succeeds.
 * BUG-11 FIX: Now writes window.__swarmMeshState so mineHealthValidator reads live peer count.
 */

import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useP2PContext } from "@/contexts/P2PContext";
import { getFeatureFlags } from "@/config/featureFlags";
import { rewardTransactionProcessing, rewardSpaceHosting } from "@/lib/blockchain/miningRewards";
import { getSwarmMeshStandalone, type MiningStats } from "@/lib/p2p/swarmMesh.standalone";
import { saveMiningSession } from "@/lib/blockchain/storage";
import type { MiningSession } from "@/lib/blockchain/types";
import { toast } from "sonner";

// Module-level flag — survives re-renders and re-mounts from navigation
let globalNotified = false;

// Track last-seen stats to only reward NEW activity
let lastSeenStats: MiningStats | null = null;

// Stable session ID for the auto-miner lifetime
let autoMineSessionId: string | null = null;

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
        toast.success("CREATOR Mining active — blocks require mesh consensus", { id: "auto-mine", duration: 3000 });
        globalNotified = true;
      }

      // ── BUG-10 FIX: Persist an active MiningSession to IndexedDB ──
      autoMineSessionId = `auto-mine-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const session: MiningSession = {
        id: autoMineSessionId,
        userId: user.id,
        startedAt: new Date().toISOString(),
        blocksFound: 0,
        totalReward: 0,
        hashRate: 0,
        status: "active",
      };
      saveMiningSession(session).catch(() => {});

      // ── BUG-11 FIX: Write __swarmMeshState immediately ──
      (window as any).__swarmMeshState = { peerCount: stats.connectedPeers };

      // Snapshot current stats so we only reward deltas
      try {
        lastSeenStats = getSwarmMeshStandalone().getMiningStats();
      } catch {
        lastSeenStats = null;
      }

      intervalRef.current = setInterval(() => {
        if (!user) return;

        // ── BUG-11 FIX: Keep __swarmMeshState fresh every tick ──
        (window as any).__swarmMeshState = { peerCount: stats.connectedPeers };

        try {
          const mesh = getSwarmMeshStandalone();
          const current = mesh.getMiningStats();

          if (!lastSeenStats) {
            lastSeenStats = current;
            return;
          }

          // ── CREATOR Proof: Only reward CONFIRMED blocks ──
          const newConfirmed = current.confirmedBlocks - (lastSeenStats.confirmedBlocks ?? 0);
          const newHollow = current.hollowBlocks - (lastSeenStats.hollowBlocks ?? 0);
          const newRelays = current.blocksRelayed - (lastSeenStats.blocksRelayed ?? 0);
          const newHeartbeats = current.heartbeatsSent - (lastSeenStats.heartbeatsSent ?? 0);
          const newAcks = current.acksReceived - (lastSeenStats.acksReceived ?? 0);
          const newPeersDiscovered = current.peersDiscovered - (lastSeenStats.peersDiscovered ?? 0);

          // Full confirmed blocks + hollow blocks at 50% + relays + discoveries = mesh work
          const fullBlockWork = Math.max(0, newConfirmed - newHollow);
          const hollowWork = Math.floor(Math.max(0, newHollow) * 0.5);
          const meshWork = fullBlockWork + hollowWork + newRelays + newPeersDiscovered;

          // Heartbeats + acks = network service
          const networkService = newHeartbeats + newAcks;

          if (meshWork > 0) {
            void rewardTransactionProcessing(user.id, meshWork);
          }
          if (networkService > 0) {
            void rewardSpaceHosting(user.id, Math.ceil(networkService / 10));
          }

          // ── BUG-10 FIX: Update session with latest stats ──
          if (autoMineSessionId) {
            const updatedSession: MiningSession = {
              id: autoMineSessionId,
              userId: user.id,
              startedAt: session.startedAt,
              blocksFound: current.confirmedBlocks,
              totalReward: 0,
              hashRate: 0,
              status: "active",
            };
            saveMiningSession(updatedSession).catch(() => {});
          }

          lastSeenStats = current;
        } catch {
          // Mesh not available — skip this cycle
        }
      }, 30_000);
    }

    if (!shouldMine && miningRef.current) {
      miningRef.current = false;

      // ── BUG-10 FIX: Mark session completed when mining stops ──
      if (autoMineSessionId && user) {
        const completedSession: MiningSession = {
          id: autoMineSessionId,
          userId: user.id,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          blocksFound: 0,
          totalReward: 0,
          hashRate: 0,
          status: "completed",
        };
        saveMiningSession(completedSession).catch(() => {});
        autoMineSessionId = null;
      }

      // ── BUG-11 FIX: Clear mesh state on stop ──
      if (typeof window !== "undefined") {
        (window as any).__swarmMeshState = { peerCount: 0 };
      }

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
