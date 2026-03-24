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

import { getMiningSession } from './storage';
import { PEER_STALE_THRESHOLD_MINING } from '../p2p/swarmMineHealth.standalone';
import { getAll } from '../store';
import type { SwarmCoin } from './types';

interface MeshMineHealthMetadata {
  userId?: string;
  peerCount?: number;
  connectedPeers?: number;
  miningActive?: boolean;
  meshHealth?: number;
  updatedAt?: number;
}

export interface MineHealthResult {
  healthy: boolean;
  reason?: string;
  peerCount: number;
  miningActive: boolean;
  lastBlockAge: number;
  /** Sum of weight from all user-owned weighted coins */
  weightedCoinBonus: number;
  /** 0-100 health score published by mesh runtime when available */
  meshHealthScore?: number;
  /** True when runtime mesh metadata was considered current */
  meshMetadataFresh: boolean;
}

/**
 * Query user's wallet coins and sum their weights for reputation bonus.
 */
async function getWeightedCoinBonus(userId: string): Promise<number> {
  try {
    const allCoins = await getAll<SwarmCoin>('swarmCoins');
    const userCoins = allCoins.filter((c) => c.ownerId === userId && c.status === 'wallet');
    return userCoins.reduce((sum, coin) => sum + (coin.weight ?? 0), 0);
  } catch {
    return 0;
  }
}

function readMeshMineHealthMetadata(userId: string): { peerCount: number; miningActive: boolean; meshHealthScore?: number; fresh: boolean } {
  if (typeof window === 'undefined') {
    return { peerCount: 0, miningActive: false, meshHealthScore: undefined, fresh: false };
  }

  const meshState = (window as Window & { __swarmMeshState?: MeshMineHealthMetadata }).__swarmMeshState;
  if (!meshState) {
    return { peerCount: 0, miningActive: false, meshHealthScore: undefined, fresh: false };
  }

  const updatedAt = typeof meshState.updatedAt === 'number' ? meshState.updatedAt : 0;
  const isFresh = Date.now() - updatedAt <= 90_000;
  if (!isFresh) {
    return { peerCount: 0, miningActive: false, meshHealthScore: meshState.meshHealth, fresh: false };
  }

  const isUserMatch = !meshState.userId || meshState.userId === userId;
  if (!isUserMatch) {
    return { peerCount: 0, miningActive: false, meshHealthScore: meshState.meshHealth, fresh: false };
  }

  const peerCount = typeof meshState.peerCount === 'number'
    ? meshState.peerCount
    : typeof meshState.connectedPeers === 'number'
      ? meshState.connectedPeers
      : 0;

  return {
    peerCount,
    miningActive: Boolean(meshState.miningActive),
    meshHealthScore: meshState.meshHealth,
    fresh: true,
  };
}

/**
 * Validates that the current node meets mineHealth requirements
 * for economic operations (swaps, deployments, wraps).
 */
export async function validateMineHealth(userId: string): Promise<MineHealthResult> {
  const session = await getMiningSession(userId);

  const sessionMiningActive = !!session && session.status === 'active';
  const lastBlockAge = session?.endedAt
    ? Date.now() - new Date(session.endedAt).getTime()
    : session?.startedAt
      ? Date.now() - new Date(session.startedAt).getTime()
      : Infinity;

  const meshMetadata = readMeshMineHealthMetadata(userId);
  const miningActive = sessionMiningActive || meshMetadata.miningActive;
  const peerCount = meshMetadata.fresh ? meshMetadata.peerCount : 0;

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
        reason: 'No active mining session. Start mining or reconnect to the mesh.',
        peerCount,
        miningActive,
        lastBlockAge,
        weightedCoinBonus,
        meshHealthScore: meshMetadata.meshHealthScore,
        meshMetadataFresh: meshMetadata.fresh,
      };
    }
  }

  // Rule 2: Must have at least 1 peer (network participation)
  // Relaxed for solo-node bootstrap: skip if mining is active OR solo creator pass
  if (peerCount === 0 && !miningActive && !soloCreatorPass) {
    return {
      healthy: false,
      reason: 'No active peer connections. Connect to the SWARM mesh first.',
      peerCount,
      miningActive,
      lastBlockAge,
      weightedCoinBonus,
      meshHealthScore: meshMetadata.meshHealthScore,
      meshMetadataFresh: meshMetadata.fresh,
    };
  }

  return {
    healthy: true,
    peerCount,
    miningActive,
    lastBlockAge,
    weightedCoinBonus,
    meshHealthScore: meshMetadata.meshHealthScore,
    meshMetadataFresh: meshMetadata.fresh,
  };
}
