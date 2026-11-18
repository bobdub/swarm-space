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
import { getSwarmMeshStandalone } from "@/lib/p2p/swarmMesh.standalone";
import { settleMiningPayout } from "@/lib/mining/miningPayouts";
import { saveMiningSession } from "@/lib/blockchain/storage";
import type { MiningSession } from "@/lib/blockchain/types";
import { toast } from "sonner";
import { canUseMemberFeatures } from '@/lib/preview/guestAccess';

// Module-level flag — survives re-renders and re-mounts from navigation
let globalNotified = false;

// Stable session ID for the auto-miner lifetime
let autoMineSessionId: string | null = null;
let autoMineStartedAt: string | null = null;

export function AutoMiningService() {
  const { user } = useAuth();
  const { isEnabled, stats } = useP2PContext();
  const miningRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const flags = getFeatureFlags();
    const shouldMine = flags.swarmMeshMode && isEnabled && stats.connectedPeers > 0 && canUseMemberFeatures(user) && !!user;

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
      autoMineStartedAt = session.startedAt;
      saveMiningSession(session).catch(() => {});

      // ── BUG-11 FIX: Write __swarmMeshState immediately ──
      (window as any).__swarmMeshState = {
        userId: user.id,
        peerCount: stats.connectedPeers,
        connectedPeers: stats.connectedPeers,
        miningActive: true,
        meshHealth: stats.connectedPeers > 0 ? 100 : 0,
        updatedAt: Date.now(),
      };

      // Keep __swarmMeshState fresh for mineHealthValidator. Rewards no
      // longer wait on this tick — they are paid from the mining-change
      // subscription below the moment the mesh counters move.
      intervalRef.current = setInterval(() => {
        if (!user) return;
        (window as any).__swarmMeshState = {
          userId: user.id,
          peerCount: stats.connectedPeers,
          connectedPeers: stats.connectedPeers,
          miningActive: true,
          meshHealth: stats.connectedPeers > 0 ? 100 : 0,
          updatedAt: Date.now(),
        };
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
        (window as any).__swarmMeshState = {
          userId: user?.id,
          peerCount: 0,
          connectedPeers: 0,
          miningActive: false,
          meshHealth: 0,
          updatedAt: Date.now(),
        };
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

  // ── Event-driven payouts ──
  // Pay as soon as the mesh mining counters change (block confirmed, relay,
  // discovery, heartbeat/ack) instead of every 30s. Payouts are derived from
  // the same summary the mining displays use, so they always agree. Mesh
  // work already requires live peers, so we don't gate on the (10s-polled)
  // React peer count here.
  useEffect(() => {
    const flags = getFeatureFlags();
    if (!flags.swarmMeshMode || !isEnabled || !user || !canUseMemberFeatures(user)) return;
    let mesh: ReturnType<typeof getSwarmMeshStandalone>;
    try { mesh = getSwarmMeshStandalone(); } catch { return; }

    let lastConfirmed = -1;
    const userId = user.id;
    const unsub = mesh.onMiningChange((current) => {
      const due = settleMiningPayout(userId, current);
      if (due.meshWorkUnits > 0) void rewardTransactionProcessing(userId, due.meshWorkUnits);
      if (due.serviceUnits > 0) void rewardSpaceHosting(userId, due.serviceUnits);

      // BUG-10: keep the persisted session's block count current.
      if (autoMineSessionId && current.confirmedBlocks !== lastConfirmed) {
        lastConfirmed = current.confirmedBlocks;
        saveMiningSession({
          id: autoMineSessionId,
          userId,
          startedAt: autoMineStartedAt ?? new Date().toISOString(),
          blocksFound: current.confirmedBlocks,
          totalReward: 0,
          hashRate: 0,
          status: "active",
        }).catch(() => {});
      }
    });
    return unsub;
  }, [isEnabled, user]);

  return null;
}
