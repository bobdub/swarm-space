// Credit wrapping system - lock credits into SWARM tokens via community pool
// Rate: 100 credits = 1 SWARM (pool-dependent)
// All wraps must pass mineHealth validation.
import { get, put, getAll } from "../store";
import { CREDIT_TO_SWARM_RATIO } from "./types";
import { getRewardPoolBalance } from "./miningRewards";
import { mintSwarm } from "./token";
import { validateMineHealth } from "./mineHealthValidator";
import type { CreditTransaction } from "@/types";

interface WrapRequest {
  id: string;
  userId: string;
  creditAmount: number;
  swarmAmount: number;
  status: "pending" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
}

export interface WrapStats {
  poolBalance: number;
  pendingWraps: number;
  queuePosition?: number;
  ratio: number;
}

/**
 * Request to lock credits into SWARM tokens.
 * 100 credits = 1 SWARM. Depends on pool availability.
 */
export async function requestCreditWrap(userId: string, creditAmount: number): Promise<string> {
  if (creditAmount <= 0) {
    throw new Error("Amount must be greater than 0");
  }

  if (creditAmount < CREDIT_TO_SWARM_RATIO) {
    throw new Error(`Minimum ${CREDIT_TO_SWARM_RATIO} credits required (= 1 SWARM)`);
  }

  // ── MineHealth Gate ──────────────────────────────────────────────────
  const health = await validateMineHealth(userId);
  if (!health.healthy) {
    throw new Error(`MineHealth check failed: ${health.reason}`);
  }

  const swarmAmount = Math.floor(creditAmount / CREDIT_TO_SWARM_RATIO);
  const actualCreditsUsed = swarmAmount * CREDIT_TO_SWARM_RATIO;

  // Check user has enough credits
  const { getCreditBalance } = await import("../credits");
  const balance = await getCreditBalance(userId);
  
  if (balance < actualCreditsUsed) {
    throw new Error("Insufficient credits");
  }

  // Create wrap request
  const request: WrapRequest = {
    id: `wrap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    creditAmount: actualCreditsUsed,
    swarmAmount,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  await put("wrapRequests", request);

  // Attempt to process immediately
  await processWrapQueue();

  return request.id;
}

/**
 * Process pending wrap requests from the queue
 */
export async function processWrapQueue(): Promise<void> {
  const poolBalance = await getRewardPoolBalance();
  const pendingRequests = await getAll<WrapRequest>("wrapRequests");
  const pending = pendingRequests
    .filter(r => r.status === "pending")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  let remainingPool = poolBalance;

  for (const request of pending) {
    if (remainingPool >= request.swarmAmount) {
      try {
        await executeWrap(request);
        remainingPool -= request.swarmAmount;
      } catch (error) {
        console.error(`[CreditWrap] Failed to process wrap ${request.id}:`, error);
        request.status = "failed";
        await put("wrapRequests", request);
      }
    } else {
      break;
    }
  }
}

/**
 * Execute a wrap request
 */
async function executeWrap(request: WrapRequest): Promise<void> {
  const { deductCredits } = await import("../credits");
  
  // Deduct credits
  await deductCredits(request.userId, request.creditAmount, `Locked ${request.creditAmount} credits → ${request.swarmAmount} SWARM`);
  
  // Mint SWARM tokens from pool
  await mintSwarm({
    to: request.userId,
    amount: request.swarmAmount,
    reason: `Wrapped ${request.creditAmount} credits → ${request.swarmAmount} SWARM`,
  });

  // Deduct from pool
  await deductFromRewardPool(request.swarmAmount);

  // Mark as completed
  request.status = "completed";
  request.completedAt = new Date().toISOString();
  await put("wrapRequests", request);

  // Record as credit_lock transaction on chain
  const { getSwarmChain } = await import("./chain");
  const { generateTransactionId } = await import("./crypto");
  const chain = getSwarmChain();
  chain.addTransaction({
    id: generateTransactionId(),
    type: "credit_lock",
    from: request.userId,
    to: "community-pool",
    amount: request.swarmAmount,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: request.userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      creditsLocked: request.creditAmount,
      swarmMinted: request.swarmAmount,
      ratio: CREDIT_TO_SWARM_RATIO,
    },
  });

  // Create transaction record
  const transaction: CreditTransaction = {
    id: crypto.randomUUID(),
    fromUserId: request.userId,
    toUserId: "community-pool",
    amount: request.creditAmount,
    type: "transfer",
    createdAt: new Date().toISOString(),
    meta: {
      description: `Locked ${request.creditAmount} credits → ${request.swarmAmount} SWARM`,
      wrapRequestId: request.id,
    },
  };

  await put("creditTransactions", transaction);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("credit-transaction", { detail: transaction }));
  }

  console.log(`[CreditWrap] Locked ${request.creditAmount} credits → ${request.swarmAmount} SWARM for user ${request.userId}`);
}

/**
 * Deduct from reward pool
 */
async function deductFromRewardPool(amount: number): Promise<void> {
  const { getRewardPool, saveRewardPool } = await import("./storage");
  
  const pool = await getRewardPool();
  if (!pool || pool.balance < amount) {
    throw new Error("Insufficient reward pool balance");
  }
  
  pool.balance -= amount;
  pool.lastUpdated = new Date().toISOString();
  await saveRewardPool(pool);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("reward-pool-update", { detail: pool }));
  }
  
  console.log(`[RewardPool] Deducted ${amount} from pool (new balance: ${pool.balance})`);
}

/**
 * Get wrap statistics
 */
export async function getWrapStats(userId?: string): Promise<WrapStats> {
  const poolBalance = await getRewardPoolBalance();
  const allRequests = await getAll<WrapRequest>("wrapRequests");
  const pending = allRequests.filter(r => r.status === "pending");
  
  const stats: WrapStats = {
    poolBalance,
    pendingWraps: pending.length,
    ratio: CREDIT_TO_SWARM_RATIO,
  };

  if (userId) {
    const userRequest = pending.find(r => r.userId === userId);
    if (userRequest) {
      const sortedPending = pending.sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      stats.queuePosition = sortedPending.findIndex(r => r.id === userRequest.id) + 1;
    }
  }

  return stats;
}

/**
 * Get user's wrap requests
 */
export async function getUserWrapRequests(userId: string): Promise<WrapRequest[]> {
  const allRequests = await getAll<WrapRequest>("wrapRequests");
  return allRequests
    .filter(r => r.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Donate SWARM tokens to the reward pool
 */
export async function donateToRewardPool(userId: string, amount: number): Promise<void> {
  if (amount <= 0) {
    throw new Error("Donation amount must be greater than 0");
  }

  const { getSwarmBalance, burnSwarm: burnToken } = await import("./token");
  const balance = await getSwarmBalance(userId);
  
  if (balance < amount) {
    throw new Error("Insufficient SWARM balance");
  }

  // Burn tokens from user
  await burnToken({
    from: userId,
    amount,
    reason: `Donated ${amount} SWARM to community pool`
  });

  // Add to reward pool
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
  
  if (!pool.contributors) pool.contributors = {};
  
  pool.balance += amount;
  pool.totalContributed += amount;
  pool.lastUpdated = new Date().toISOString();
  pool.contributors[userId] = (pool.contributors[userId] || 0) + amount;
  
  await saveRewardPool(pool);

  // Record donation transaction on chain
  const { getSwarmChain } = await import("./chain");
  const { generateTransactionId } = await import("./crypto");
  const chain = getSwarmChain();
  chain.addTransaction({
    id: generateTransactionId(),
    type: "pool_donate",
    from: userId,
    to: "community-pool",
    amount,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      poolBalanceAfter: pool.balance,
    },
  });

  console.log(`[RewardPool] User ${userId} donated ${amount} SWARM (total: ${pool.balance})`);
  
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("reward-pool-update", { detail: pool }));
    window.dispatchEvent(new CustomEvent("blockchain-transaction", {
      detail: { type: "pool_donate", from: userId, amount },
    }));
  }

  // Process any pending wraps now that pool has more balance
  await processWrapQueue();
}
