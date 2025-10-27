// Credits system implementation
import { get, put, getAll } from "./store";
import { CreditTransaction, CreditBalance, User, Post } from "@/types";
import { getCurrentUser } from "./auth";
import { z } from "zod";
import type { AchievementEvent } from "./achievements";

// Credit rewards configuration
export const CREDIT_REWARDS = {
  POST_CREATE: 10,
  ENGAGEMENT: 2,
  GENESIS_ALLOCATION: 1000,
  HYPE_COST: 5,
  HYPE_BURN_PERCENTAGE: 0.2, // 20% burned
  MAX_TRANSFER: 10000,
  MIN_TRANSFER: 1,
};

// Input validation schemas
const transferAmountSchema = z.number()
  .int({ message: "Amount must be a whole number" })
  .min(CREDIT_REWARDS.MIN_TRANSFER, { message: `Minimum transfer is ${CREDIT_REWARDS.MIN_TRANSFER} credit` })
  .max(CREDIT_REWARDS.MAX_TRANSFER, { message: `Maximum transfer is ${CREDIT_REWARDS.MAX_TRANSFER} credits` });

const userIdSchema = z.string()
  .trim()
  .nonempty({ message: "User ID cannot be empty" })
  .max(100, { message: "Invalid user ID format" });

async function notifyAchievements(event: AchievementEvent): Promise<void> {
  try {
    const module = await import("./achievements");
    await module.evaluateAchievementEvent(event);
  } catch (error) {
    console.warn("[credits] Failed to notify achievements", error);
  }
}

/**
 * Get user's credit balance
 */
export async function getCreditBalance(userId: string): Promise<number> {
  const balance = await get<CreditBalance>("creditBalances", userId);
  return balance?.balance || 0;
}

/**
 * Get user's full credit balance record
 */
export async function getCreditBalanceRecord(userId: string): Promise<CreditBalance> {
  let balance = await get<CreditBalance>("creditBalances", userId);
  if (!balance) {
    balance = {
      userId,
      balance: 0,
      totalEarned: 0,
      totalSpent: 0,
      totalBurned: 0,
      lastUpdated: new Date().toISOString(),
    };
    await put("creditBalances", balance);
  }
  return balance;
}

/**
 * Update user's credit balance
 */
async function updateBalance(
  userId: string,
  delta: number,
  type: "earned" | "spent" | "burned"
): Promise<void> {
  const balance = await getCreditBalanceRecord(userId);
  balance.balance += delta;
  
  if (type === "earned") {
    balance.totalEarned += delta;
  } else if (type === "spent") {
    balance.totalSpent += Math.abs(delta);
  } else if (type === "burned") {
    balance.totalBurned += Math.abs(delta);
  }
  
  balance.lastUpdated = new Date().toISOString();
  await put("creditBalances", balance);

  // Update user credits field
  const user = await get<User>("users", userId);
  if (user) {
    user.credits = balance.balance;
    await put("users", user);
  }
}

/**
 * Award genesis credits to a new user
 */
export async function awardGenesisCredits(userId: string): Promise<void> {
  const balance = await get<CreditBalance>("creditBalances", userId);
  if (balance && balance.totalEarned > 0) {
    // Already received genesis credits
    return;
  }

  const transaction: CreditTransaction = {
    id: crypto.randomUUID(),
    fromUserId: "system",
    toUserId: userId,
    amount: CREDIT_REWARDS.GENESIS_ALLOCATION,
    type: "earned_post",
    createdAt: new Date().toISOString(),
    meta: {
      description: "Genesis allocation",
    },
  };

  await put("creditTransactions", transaction);
  await updateBalance(userId, CREDIT_REWARDS.GENESIS_ALLOCATION, "earned");

  void notifyAchievements({
    type: "credits:earned",
    userId,
    amount: CREDIT_REWARDS.GENESIS_ALLOCATION,
    source: "genesis",
    transactionId: transaction.id,
  });
}

/**
 * Award credits for creating a post
 */
export async function awardPostCredits(postId: string, userId: string): Promise<void> {
  const transaction: CreditTransaction = {
    id: crypto.randomUUID(),
    fromUserId: "system",
    toUserId: userId,
    amount: CREDIT_REWARDS.POST_CREATE,
    type: "earned_post",
    postId,
    createdAt: new Date().toISOString(),
  };

  await put("creditTransactions", transaction);
  await updateBalance(userId, CREDIT_REWARDS.POST_CREATE, "earned");

  void notifyAchievements({
    type: "credits:earned",
    userId,
    amount: CREDIT_REWARDS.POST_CREATE,
    source: "post",
    transactionId: transaction.id,
    meta: { postId },
  });
}

/**
 * Award credits for hosting data
 */
export async function awardHostingCredits(userId: string, bytesHosted: number): Promise<void> {
  // Calculate credits based on bytes hosted (1 credit per MB)
  const amount = Math.floor(bytesHosted / (1024 * 1024));
  if (amount <= 0) return;

  const transaction: CreditTransaction = {
    id: crypto.randomUUID(),
    fromUserId: "system",
    toUserId: userId,
    amount,
    type: "earned_hosting",
    createdAt: new Date().toISOString(),
    meta: {
      description: `Hosting ${bytesHosted} bytes`,
    },
  };

  await put("creditTransactions", transaction);
  await updateBalance(userId, amount, "earned");

  void notifyAchievements({
    type: "credits:earned",
    userId,
    amount,
    source: "hosting",
    transactionId: transaction.id,
  });
}

interface AchievementCreditParams {
  userId: string;
  amount: number;
  achievementId: string;
  achievementSlug: string;
  achievementTitle: string;
  skipAchievementEvent?: boolean;
}

export async function awardAchievementCredits(params: AchievementCreditParams): Promise<void> {
  if (params.amount <= 0) {
    return;
  }

  const transaction: CreditTransaction = {
    id: crypto.randomUUID(),
    fromUserId: "system",
    toUserId: params.userId,
    amount: params.amount,
    type: "achievement_reward",
    createdAt: new Date().toISOString(),
    meta: {
      achievementId: params.achievementId,
      achievementSlug: params.achievementSlug,
      achievementTitle: params.achievementTitle,
    },
  };

  await put("creditTransactions", transaction);
  await updateBalance(params.userId, params.amount, "earned");

  if (!params.skipAchievementEvent) {
    void notifyAchievements({
      type: "credits:earned",
      userId: params.userId,
      amount: params.amount,
      source: "achievement",
      transactionId: transaction.id,
      meta: { achievementId: params.achievementId },
    });
  }
}

/**
 * Hype a post (costs credits, portion burned)
 */
export async function hymePost(postId: string, amount: number = CREDIT_REWARDS.HYPE_COST): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");

  // Validate inputs
  try {
    transferAmountSchema.parse(amount);
    userIdSchema.parse(postId);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(error.errors[0].message);
    }
    throw error;
  }

  const balance = await getCreditBalance(user.id);
  if (balance < amount) {
    throw new Error("Insufficient credits");
  }

  const post = await get<Post>("posts", postId);
  if (!post) throw new Error("Post not found");

  const burnAmount = Math.floor(amount * CREDIT_REWARDS.HYPE_BURN_PERCENTAGE);
  const transferAmount = amount - burnAmount;

  // Create burn transaction
  const burnTx: CreditTransaction = {
    id: crypto.randomUUID(),
    fromUserId: user.id,
    toUserId: "burned",
    amount: burnAmount,
    type: "hype",
    postId,
    createdAt: new Date().toISOString(),
    meta: {
      burn: burnAmount,
      description: "Hype burn",
    },
  };

  // Create transfer transaction to post author
  const transferTx: CreditTransaction = {
    id: crypto.randomUUID(),
    fromUserId: user.id,
    toUserId: post.author,
    amount: transferAmount,
    type: "hype",
    postId,
    createdAt: new Date().toISOString(),
    meta: {
      description: "Hype reward",
    },
  };

  await put("creditTransactions", burnTx);
  await put("creditTransactions", transferTx);

  // Update balances
  await updateBalance(user.id, -amount, "spent");
  await updateBalance("burned", burnAmount, "burned");
  await updateBalance(post.author, transferAmount, "earned");

  void notifyAchievements({
    type: "credits:hype",
    userId: user.id,
    amount,
    postId,
    recipientId: post.author,
  });

  void notifyAchievements({
    type: "credits:earned",
    userId: post.author,
    amount: transferAmount,
    source: "hype",
    transactionId: transferTx.id,
    meta: { postId },
  });
}

/**
 * Transfer credits P2P
 */
export async function transferCredits(toUserId: string, amount: number): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");

  // Validate inputs
  try {
    transferAmountSchema.parse(amount);
    userIdSchema.parse(toUserId);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(error.errors[0].message);
    }
    throw error;
  }

  if (user.id === toUserId) {
    throw new Error("Cannot send credits to yourself");
  }

  const balance = await getCreditBalance(user.id);
  if (balance < amount) {
    throw new Error("Insufficient credits");
  }

  // Verify recipient exists
  const recipient = await get<User>("users", toUserId);
  if (!recipient) {
    throw new Error("Recipient user not found");
  }

  const transaction: CreditTransaction = {
    id: crypto.randomUUID(),
    fromUserId: user.id,
    toUserId,
    amount,
    type: "transfer",
    createdAt: new Date().toISOString(),
  };

  await put("creditTransactions", transaction);
  await updateBalance(user.id, -amount, "spent");
  await updateBalance(toUserId, amount, "earned");
}

/**
 * Get user's credit transaction history
 */
export async function getCreditTransactions(userId: string): Promise<CreditTransaction[]> {
  const allTxs = await getAll<CreditTransaction>("creditTransactions");
  return allTxs
    .filter(tx => tx.fromUserId === userId || tx.toUserId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
