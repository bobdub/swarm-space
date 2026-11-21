/**
 * AutoMiningService — Background mining rewards based on REAL mesh activity.
 * Only rewards when connected to SWARM Mesh with active peers.
 * CREATOR Proof: rewards come only from the shared chain's block reward,
 * mined by the mesh on the cadence. Hollow blocks earn 50% of the reward.
 *
 * BUG-10 FIX: Now persists MiningSession to IndexedDB so validateMineHealth succeeds.
 * BUG-11 FIX: Now writes window.__swarmMeshState so mineHealthValidator reads live peer count.
 */

import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useP2PContext } from "@/contexts/P2PContext";
import { getFeatureFlags } from "@/config/featureFlags";
import { getSwarmMeshStandalone } from "@/lib/p2p/swarmMesh.standalone";
import { settleMiningPayout } from "@/lib/mining/miningPayouts";
import { saveMiningSession } from "@/lib/blockchain/storage";
import type { MiningSession } from "@/lib/blockchain/types";
import { canUseMemberFeatures } from '@/lib/preview/guestAccess';

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

  // ── Mining counters ──
  // Track the mesh mining counters for the session record. Payment is the
  // block reward on the shared chain, so nothing is minted here.
  useEffect(() => {
    const flags = getFeatureFlags();
    if (!flags.swarmMeshMode || !isEnabled || !user || !canUseMemberFeatures(user)) return;
    let mesh: ReturnType<typeof getSwarmMeshStandalone>;
    try { mesh = getSwarmMeshStandalone(); } catch { return; }

    let lastConfirmed = -1;
    const userId = user.id;
    const unsub = mesh.onMiningChange((current) => {
      // CREATOR work is paid by the shared chain's block reward (Bitcoin-style),
      // not by self-issued mints peers can't check. Keep the paid mark moving
      // so the old payout never re-pays this work.
      settleMiningPayout(userId, current);

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
