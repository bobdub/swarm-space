// Credit wrapping system - converts earned credits to mined SWARM tokens
import { get, put, getAll } from "../store";
import { getRewardPoolBalance } from "./miningRewards";
import { mintSwarm } from "./token";
import type { CreditTransaction } from "@/types";

interface WrapRequest {
  id: string;
  userId: string;
  amount: number;
  status: "pending" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
}

export interface WrapStats {
  poolBalance: number;
  pendingWraps: number;
  queuePosition?: number;
}

/**
 * Request to wrap credits into SWARM tokens
 */
export async function requestCreditWrap(userId: string, creditAmount: number): Promise<string> {
  if (creditAmount <= 0) {
    throw new Error("Amount must be greater than 0");
  }

  // Check user has enough credits
  const { getCreditBalance } = await import("../credits");
  const balance = await getCreditBalance(userId);
  
  if (balance < creditAmount) {
    throw new Error("Insufficient credits");
  }

  // Create wrap request
  const request: WrapRequest = {
    id: `wrap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    amount: creditAmount,
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
    if (remainingPool >= request.amount) {
      // Process wrap
      try {
        await executeWrap(request, remainingPool);
        remainingPool -= request.amount;
      } catch (error) {
        console.error(`[CreditWrap] Failed to process wrap ${request.id}:`, error);
        request.status = "failed";
        await put("wrapRequests", request);
      }
    } else {
      // Not enough in pool, wait
      break;
    }
  }
}

/**
 * Execute a wrap request
 */
async function executeWrap(request: WrapRequest, availablePool: number): Promise<void> {
  const { deductCredits } = await import("../credits");
  
  // Deduct credits
  await deductCredits(request.userId, request.amount, "Credit wrapping to SWARM");
  
  // Mint SWARM tokens
  await mintSwarm({
    to: request.userId,
    amount: request.amount,
    reason: `Wrapped ${request.amount} credits to SWARM`,
  });

  // Deduct from pool
  await deductFromRewardPool(request.amount);

  // Mark as completed
  request.status = "completed";
  request.completedAt = new Date().toISOString();
  await put("wrapRequests", request);

  // Create transaction record
  const transaction: CreditTransaction = {
    id: crypto.randomUUID(),
    fromUserId: request.userId,
    toUserId: "system",
    amount: request.amount,
    type: "transfer",
    createdAt: new Date().toISOString(),
    meta: {
      description: `Wrapped ${request.amount} credits to SWARM tokens`,
      wrapRequestId: request.id,
    },
  };

  await put("creditTransactions", transaction);

  // Dispatch event
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("credit-transaction", { detail: transaction }));
  }

  console.log(`[CreditWrap] Wrapped ${request.amount} credits for user ${request.userId}`);
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

  console.log(`[RewardPool] Pool updated, will sync with peers automatically via P2P blockchain sync`);
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
    reason: `Donated ${amount} SWARM to reward pool`
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
  
  pool.balance += amount;
  pool.totalContributed += amount;
  pool.lastUpdated = new Date().toISOString();
  
  // Track contributor
  pool.contributors[userId] = (pool.contributors[userId] || 0) + amount;
  
  await saveRewardPool(pool);

  console.log(`[RewardPool] User ${userId} donated ${amount} SWARM to reward pool (total: ${pool.balance})`);
  console.log(`[RewardPool] Pool will be synced with peers automatically via P2P blockchain sync`);

  // Process any pending wraps now that pool has more balance
  await processWrapQueue();
}
