// Mining rewards through verified network participation
// CREATOR Proof: Only confirmed mesh work earns rewards
// SWARM is paid only by shared-chain block rewards (see chain.minePendingTransactions).

const MINING_REWARDS = {
  TRANSACTION_PROCESSED: 0.1,  // Per confirmed mesh work action
  MB_HOSTED: 0.05,             // Per network service unit
  PEER_CONNECTION: 0,          // REMOVED — connecting alone doesn't earn (honesty)
  NETWORK_POOL_PERCENTAGE: 0.05, // 5% goes to reward pool
} as const;

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

async function broadcastRewardPoolUpdate(pool: any): Promise<void> {
  // Dispatch event for P2P sync
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("reward-pool-update", {
      detail: pool
    }));
  }
}

/**
 * After a block lands with the pool's share of the reward: refresh the pool
 * record from the chain, seed the graveyard coin the 5% tax always created,
 * and tell the UI. Never mints.
 */
export async function recordBlockPoolShare(): Promise<void> {
  const { derivePoolFromChain } = await import("./storage");
  const pool = await derivePoolFromChain();
  try {
    const { createEmptyPoolCoin } = await import("./coinWrap");
    const { put } = await import("../store");
    await put("swarmCoins", createEmptyPoolCoin());
  } catch (err) {
    console.warn("[RewardPool] Failed to seed empty coin:", err);
  }
  await broadcastRewardPoolUpdate(pool);
}

export async function getRewardPoolBalance(): Promise<number> {
  const { getRewardPool } = await import("./storage");
  const pool = await getRewardPool();
  return pool?.balance || 0;
}
