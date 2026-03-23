// Mining rewards through verified network participation
// CREATOR Proof: Only confirmed mesh work earns rewards
import { mintSwarm } from "./token";

const MINING_REWARDS = {
  TRANSACTION_PROCESSED: 0.1,  // Per confirmed mesh work action
  MB_HOSTED: 0.05,             // Per network service unit
  PEER_CONNECTION: 0,          // REMOVED — connecting alone doesn't earn (honesty)
  NETWORK_POOL_PERCENTAGE: 0.05, // 5% goes to reward pool
} as const;

export async function rewardTransactionProcessing(userId: string, txCount: number): Promise<void> {
  if (txCount <= 0) return; // No work = no reward
  const grossReward = txCount * MINING_REWARDS.TRANSACTION_PROCESSED;
  const poolContribution = grossReward * MINING_REWARDS.NETWORK_POOL_PERCENTAGE;
  const netReward = grossReward - poolContribution;
  
  // Add to network reward pool
  await addToRewardPool(poolContribution);
  
  // Mint net reward to user
  await mintSwarm({
    to: userId,
    amount: netReward,
    reason: `${txCount} confirmed mesh work actions (blocks confirmed, relayed, peers discovered)`,
  });

  // Dispatch credit transaction event
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("credit-transaction", {
      detail: {
        id: crypto.randomUUID(),
        fromUserId: "system",
        toUserId: userId,
        amount: netReward,
        type: "earned_hosting",
        createdAt: new Date().toISOString(),
        meta: { confirmedActions: txCount, poolContribution },
      },
    }));
  }
}

export async function rewardSpaceHosting(userId: string, serviceUnits: number): Promise<void> {
  if (serviceUnits <= 0) return; // No service = no reward
  const grossReward = serviceUnits * MINING_REWARDS.MB_HOSTED;
  const poolContribution = grossReward * MINING_REWARDS.NETWORK_POOL_PERCENTAGE;
  const netReward = grossReward - poolContribution;
  
  // Add to network reward pool
  await addToRewardPool(poolContribution);
  
  // Mint net reward to user
  await mintSwarm({
    to: userId,
    amount: netReward,
    reason: `${serviceUnits} network service units (heartbeats, acks)`,
  });

  // Dispatch credit transaction event
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("credit-transaction", {
      detail: {
        id: crypto.randomUUID(),
        fromUserId: "system",
        toUserId: userId,
        amount: netReward,
        type: "earned_hosting",
        createdAt: new Date().toISOString(),
        meta: { serviceUnits, poolContribution },
      },
    }));
  }
}

/**
 * @deprecated Peer connection alone no longer earns rewards.
 * Rewards are only earned through confirmed mesh work (CREATOR proof).
 */
export async function rewardPeerConnection(_userId: string): Promise<void> {
  // No-op: connecting alone is not work. Rewards require confirmed blocks.
  console.log('[MiningRewards] rewardPeerConnection called but disabled — connecting is not mining');
}

export function getMiningRewards() {
  return MINING_REWARDS;
}

// Reward pool management — also seeds empty SwarmCoins (graveyard throttle)
async function addToRewardPool(amount: number): Promise<void> {
  if (amount <= 0) return;
  const { getRewardPool, saveRewardPool } = await import("./storage");
  
  let pool = await getRewardPool();
  if (!pool) {
    pool = {
      id: "global",
      balance: 0,
      totalContributed: 0,
      lastUpdated: new Date().toISOString(),
      contributors: {},
    };
  }
  
  // Ensure contributors exists (for pools created before this property was added)
  if (!pool.contributors) {
    pool.contributors = {};
  }
  
  pool.balance += amount;
  pool.totalContributed += amount;
  pool.lastUpdated = new Date().toISOString();
  
  await saveRewardPool(pool);
  console.log(`[RewardPool] Added ${amount} SWARM. New balance: ${pool.balance}`);

  // ── Graveyard Throttle: seed an empty coin into the pool ─────────
  // The 5% tax always creates an empty coin so the pool never runs dry.
  try {
    const { createEmptyPoolCoin } = await import("./coinWrap");
    const { put } = await import("../store");
    const emptyCoin = createEmptyPoolCoin();
    await put("swarmCoins", emptyCoin);
    console.log(`[RewardPool] Seeded empty coin ${emptyCoin.coinId} into pool (graveyard throttle)`);
  } catch (err) {
    console.warn("[RewardPool] Failed to seed empty coin:", err);
  }
  
  // Broadcast pool update to P2P network
  await broadcastRewardPoolUpdate(pool);
}

async function broadcastRewardPoolUpdate(pool: any): Promise<void> {
  // Dispatch event for P2P sync
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("reward-pool-update", {
      detail: pool
    }));
  }
}

export async function getRewardPoolBalance(): Promise<number> {
  const { getRewardPool } = await import("./storage");
  const pool = await getRewardPool();
  return pool?.balance || 0;
}
