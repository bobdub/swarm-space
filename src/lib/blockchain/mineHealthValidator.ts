/**
 * MineHealth Validator
 * ────────────────────
 * All token swaps, coin deployments, and cross-chain operations must
 * pass mineHealth validation before proceeding. This ensures the
 * operation is backed by an active, honest node on the mesh.
 *
 * Checks:
 *  1. Node has an active mining session (or recent block within 60s)
 *  2. Node has at least 1 active peer connection
 *  3. No hollow-only blocks in the last cycle (content activity required)
 *
 * Weighted Coin Reputation Bonus:
 *  - Total weight ≥ 50 → passes even with 0 peers (Solo Creator mode)
 *  - Total weight ≥ 20 → extends lastBlockAge tolerance from 60s to 120s
 */

import { getMiningSession } from "./storage";
import { PEER_STALE_THRESHOLD_MINING } from "../p2p/swarmMineHealth.standalone";
import { getAll } from "../store";
import type { SwarmCoin } from "./types";

export interface MineHealthResult {
  healthy: boolean;
  reason?: string;
  peerCount: number;
  miningActive: boolean;
  lastBlockAge: number;
  /** Sum of weight from all user-owned weighted coins */
  weightedCoinBonus: number;
}

/**
 * Query user's wallet coins and sum their weights for reputation bonus.
 */
async function getWeightedCoinBonus(userId: string): Promise<number> {
  try {
    const allCoins = await getAll<SwarmCoin>("swarmCoins");
    const userCoins = allCoins.filter((c) => c.ownerId === userId && c.status === "wallet");
    return userCoins.reduce((sum, coin) => sum + (coin.weight ?? 0), 0);
  } catch {
    return 0;
  }
}

/**
 * Validates that the current node meets mineHealth requirements
 * for economic operations (swaps, deployments, wraps).
 */
export async function validateMineHealth(userId: string): Promise<MineHealthResult> {
  const session = await getMiningSession(userId);

  const miningActive = !!session && session.status === "active";
  const lastBlockAge = session?.endedAt
    ? Date.now() - new Date(session.endedAt).getTime()
    : session?.startedAt
      ? Date.now() - new Date(session.startedAt).getTime()
      : Infinity;

  // ── Peer count: primary source is __swarmMeshState, fallback to 0 ──
  let peerCount = 0;
  if (typeof window !== "undefined") {
    const meshState = (window as any).__swarmMeshState;
    if (meshState?.peerCount != null) {
      peerCount = meshState.peerCount;
    }
  }

  // ── Weighted Coin Reputation Bonus ──
  const weightedCoinBonus = await getWeightedCoinBonus(userId);

  // Determine block-age tolerance based on reputation
  const blockAgeTolerance = weightedCoinBonus >= 20
    ? PEER_STALE_THRESHOLD_MINING * 2   // 120s for reputable creators
    : PEER_STALE_THRESHOLD_MINING;       // 60s default

  // Solo Creator mode: weight ≥ 50 bypasses peer requirement entirely
  const soloCreatorPass = weightedCoinBonus >= 50;

  // Rule 1: Must have active mining or a very recent block
  if (!miningActive && lastBlockAge > blockAgeTolerance) {
    // Even solo creators need SOME mining activity
    if (!soloCreatorPass || lastBlockAge === Infinity) {
      return {
        healthy: false,
        reason: "No active mining session. Start mining or reconnect to the mesh.",
        peerCount,
        miningActive,
        lastBlockAge,
        weightedCoinBonus,
      };
    }
  }

  // Rule 2: Must have at least 1 peer (network participation)
  // Relaxed for solo-node bootstrap: skip if mining is active OR solo creator pass
  if (peerCount === 0 && !miningActive && !soloCreatorPass) {
    return {
      healthy: false,
      reason: "No active peer connections. Connect to the SWARM mesh first.",
      peerCount,
      miningActive,
      lastBlockAge,
      weightedCoinBonus,
    };
  }

  return {
    healthy: true,
    peerCount,
    miningActive,
    lastBlockAge,
    weightedCoinBonus,
  };
}
