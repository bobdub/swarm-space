// Mining rewards through network participation
import { mintSwarm } from "./token";

const MINING_REWARDS = {
  TRANSACTION_PROCESSED: 0.1,
  MB_HOSTED: 0.05,
  PEER_CONNECTION: 0.02,
  NETWORK_POOL_PERCENTAGE: 0.05, // 5% goes to reward pool
} as const;

export async function rewardTransactionProcessing(userId: string, txCount: number): Promise<void> {
  const grossReward = txCount * MINING_REWARDS.TRANSACTION_PROCESSED;
  const poolContribution = grossReward * MINING_REWARDS.NETWORK_POOL_PERCENTAGE;
  const netReward = grossReward - poolContribution;
  
  // Add to network reward pool
  await addToRewardPool(poolContribution);
  
  // Mint net reward to user
  await mintSwarm({
    to: userId,
    amount: netReward,
    reason: `Processing ${txCount} transactions in mesh network`,
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
        meta: { transactions: txCount, poolContribution },
      },
    }));
  }
}

export async function rewardSpaceHosting(userId: string, megabytesHosted: number): Promise<void> {
  const grossReward = megabytesHosted * MINING_REWARDS.MB_HOSTED;
  const poolContribution = grossReward * MINING_REWARDS.NETWORK_POOL_PERCENTAGE;
  const netReward = grossReward - poolContribution;
  
  // Add to network reward pool
  await addToRewardPool(poolContribution);
  
  // Mint net reward to user
  await mintSwarm({
    to: userId,
    amount: netReward,
    reason: `Hosting ${megabytesHosted}MB in mesh network`,
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
        meta: { megabytesHosted, poolContribution },
      },
    }));
  }
}

export async function rewardPeerConnection(userId: string): Promise<void> {
  const reward = MINING_REWARDS.PEER_CONNECTION;
  
  await mintSwarm({
    to: userId,
    amount: reward,
    reason: "Establishing peer connection",
  });
}

export function getMiningRewards() {
  return MINING_REWARDS;
}

// Reward pool management
async function addToRewardPool(amount: number): Promise<void> {
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
