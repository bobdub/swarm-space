// Credits system implementation
import { get, put, getAll } from "./store";
import { CreditTransaction, CreditBalance, User, Post } from "@/types";
import { getCurrentUser } from "./auth";

// Credit rewards configuration
export const CREDIT_REWARDS = {
  POST_CREATE: 10,
  ENGAGEMENT: 2,
  GENESIS_ALLOCATION: 1000,
  HYPE_COST: 5,
  HYPE_BURN_PERCENTAGE: 0.2, // 20% burned
};

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
}

/**
 * Hype a post (costs credits, portion burned)
 */
export async function hymePost(postId: string, amount: number = CREDIT_REWARDS.HYPE_COST): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");

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
}

/**
 * Transfer credits P2P
 */
export async function transferCredits(toUserId: string, amount: number): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");

  if (user.id === toUserId) {
    throw new Error("Cannot send credits to yourself");
  }

  const balance = await getCreditBalance(user.id);
  if (balance < amount) {
    throw new Error("Insufficient credits");
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
