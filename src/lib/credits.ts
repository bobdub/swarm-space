// Credits system implementation
import { get, put, getAll } from "./store";
import { CreditTransaction, CreditBalance, User, Post } from "@/types";
import { recordPostCredit } from "./postMetrics";
import { getCurrentUser } from "./auth";
import { z } from "zod";
import type { AchievementEvent } from "./achievements";

// Credit rewards configuration
export const CREDIT_REWARDS = {
  POST_CREATE: 1,
  COMMENT_CREATE: 0.2,
  COMMENT_DAILY_MAX: 2,
  ENGAGEMENT: 2,
  GENESIS_ALLOCATION: 100,
  ACHIEVEMENT_REWARD: 1,
  HYPE_COST: 5,
  HYPE_BURN_PERCENTAGE: 0.2, // 20% burned
  DAILY_BURN: 0.3, // Quantum metrics burn
  MAX_TRANSFER: 10000,
  MIN_TRANSFER: 1,
  TIP_MIN: 1,
  TIP_MAX: 500,
  MAX_MESSAGE_LENGTH: 240,
  TRANSFER_RATE_LIMIT: {
    WINDOW_MS: 60_000,
    MAX_TRANSACTIONS: 5,
    DAILY_AMOUNT_LIMIT: 5_000,
  },
} as const;

// Input validation schemas
const transferAmountSchema = z.number()
  .int({ message: "Amount must be a whole number" })
  .min(CREDIT_REWARDS.MIN_TRANSFER, { message: `Minimum transfer is ${CREDIT_REWARDS.MIN_TRANSFER} credit` })
  .max(CREDIT_REWARDS.MAX_TRANSFER, { message: `Maximum transfer is ${CREDIT_REWARDS.MAX_TRANSFER} credits` });

const userIdSchema = z.string()
  .trim()
  .nonempty({ message: "User ID cannot be empty" })
  .max(100, { message: "Invalid user ID format" });

interface TransferRateLimitState {
  windowStart: number;
  count: number;
  dailyWindowStart: number;
  dailyAmount: number;
}

interface TransferRateLimitCheckpoint {
  userId: string;
  storageKey: string;
  nextState: TransferRateLimitState;
}

const RATE_LIMIT_STORAGE_PREFIX = "credits:limit:";

function getRateLimitStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch (error) {
    console.warn("[credits] Unable to access localStorage for rate limiting", error);
    return null;
  }
}

function readRateLimitState(userId: string): TransferRateLimitState {
  const storage = getRateLimitStorage();
  const now = Date.now();

  if (!storage) {
    return {
      windowStart: now,
      count: 0,
      dailyWindowStart: now,
      dailyAmount: 0,
    };
  }

  const raw = storage.getItem(`${RATE_LIMIT_STORAGE_PREFIX}${userId}`);

  if (!raw) {
    return {
      windowStart: now,
      count: 0,
      dailyWindowStart: now,
      dailyAmount: 0,
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<TransferRateLimitState>;
    return {
      windowStart: typeof parsed.windowStart === "number" ? parsed.windowStart : now,
      count: typeof parsed.count === "number" ? parsed.count : 0,
      dailyWindowStart: typeof parsed.dailyWindowStart === "number" ? parsed.dailyWindowStart : now,
      dailyAmount: typeof parsed.dailyAmount === "number" ? parsed.dailyAmount : 0,
    };
  } catch (error) {
    console.warn("[credits] Failed to parse transfer rate limit state", error);
    return {
      windowStart: now,
      count: 0,
      dailyWindowStart: now,
      dailyAmount: 0,
    };
  }
}

function prepareTransferRateLimit(userId: string, amount: number): TransferRateLimitCheckpoint | null {
  const storage = getRateLimitStorage();
  if (!storage) {
    return null;
  }

  const now = Date.now();
  const currentState = readRateLimitState(userId);
  const {
    WINDOW_MS: windowMs,
    MAX_TRANSACTIONS: maxTransactions,
    DAILY_AMOUNT_LIMIT: dailyAmountLimit,
  } = CREDIT_REWARDS.TRANSFER_RATE_LIMIT;

  let { windowStart, count, dailyWindowStart, dailyAmount } = currentState;

  if (now - windowStart > windowMs) {
    windowStart = now;
    count = 0;
  }

  if (count >= maxTransactions) {
    throw new Error("Too many credit transfers right now. Please wait a moment before trying again.");
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  if (now - dailyWindowStart > DAY_MS) {
    dailyWindowStart = now;
    dailyAmount = 0;
  }

  if (dailyAmount + amount > dailyAmountLimit) {
    throw new Error(
      `Daily credit transfer limit of ${dailyAmountLimit} reached. Try again tomorrow.`,
    );
  }

  const nextState: TransferRateLimitState = {
    windowStart,
    count: count + 1,
    dailyWindowStart,
    dailyAmount: dailyAmount + amount,
  };

  return {
    userId,
    storageKey: `${RATE_LIMIT_STORAGE_PREFIX}${userId}`,
    nextState,
  };
}

function commitTransferRateLimit(checkpoint: TransferRateLimitCheckpoint | null): void {
  if (!checkpoint) {
    return;
  }

  const storage = getRateLimitStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(checkpoint.storageKey, JSON.stringify(checkpoint.nextState));
  } catch (error) {
    console.warn("[credits] Failed to persist transfer rate limit state", error);
  }
}

export interface CreditNotificationPayload {
  direction: "sent" | "received";
  userId: string;
  counterpartyId: string;
  amount: number;
  transactionId: string;
  type: CreditTransaction["type"];
  createdAt: string;
  message?: string;
}

function emitCreditNotification(payload: CreditNotificationPayload): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.dispatchEvent(new CustomEvent("credits:transaction", { detail: payload }));
  } catch (error) {
    console.warn("[credits] Failed to dispatch credit notification", error);
  }
}

async function notifyAchievements(event: AchievementEvent): Promise<void> {
  try {
    const module = await import("./achievements");
    await module.evaluateAchievementEvent(event);
  } catch (error) {
    console.warn("[credits] Failed to notify achievements", error);
  }
}

/**
 * Deduct credits from a user's balance
 */
export async function deductCredits(
  userId: string, 
  amount: number, 
  reason: string
): Promise<void> {
  const balance = await getCreditBalanceRecord(userId);
  
  if (balance.balance < amount) {
    throw new Error(`Insufficient credits. Required: ${amount}, Available: ${balance.balance}`);
  }

  balance.balance -= amount;
  balance.totalSpent += amount;
  balance.lastUpdated = new Date().toISOString();

  await put("creditBalances", balance);

  const transaction: CreditTransaction = {
    id: `txn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    fromUserId: userId,
    toUserId: "system",
    amount,
    type: "transfer",
    createdAt: new Date().toISOString(),
    meta: {
      description: reason,
    },
  };

  await put("creditTransactions", transaction);
  console.log(`[Credits] Deducted ${amount} credits from ${userId} for ${reason}`);
}

export async function getCreditBalance(userId: string): Promise<number> {
  const balance = await get<CreditBalance>("creditBalances", userId);
  if (balance?.balance != null) {
    return balance.balance;
  }

  const user = await get<User>("users", userId);
  return user?.credits ?? 0;
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

  // Dispatch event for blockchain sync
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("credit-transaction", { detail: transaction }));
  }

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

  void recordPostCredit(postId, CREDIT_REWARDS.POST_CREATE, new Date());

  // Dispatch event for blockchain sync
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("credit-transaction", { detail: transaction }));
  }

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
 * Award credits for creating a comment (with daily limit)
 */
export async function awardCommentCredits(commentId: string, postId: string, userId: string): Promise<void> {
  // Check daily comment reward limit
  const today = new Date().toISOString().split('T')[0];
  const allTxs = await getAll<CreditTransaction>("creditTransactions");
  const todayCommentRewards = allTxs.filter(tx => 
    tx.toUserId === userId && 
    tx.type === "earned_post" &&
    tx.meta?.commentId &&
    tx.createdAt.startsWith(today)
  );
  
  const todayTotal = todayCommentRewards.reduce((sum, tx) => sum + tx.amount, 0);
  
  if (todayTotal >= CREDIT_REWARDS.COMMENT_DAILY_MAX) {
    console.log(`[credits] Daily comment reward limit reached for user ${userId}`);
    return;
  }
  
  const transaction: CreditTransaction = {
    id: crypto.randomUUID(),
    fromUserId: "system",
    toUserId: userId,
    amount: CREDIT_REWARDS.COMMENT_CREATE,
    type: "earned_post",
    postId,
    createdAt: new Date().toISOString(),
    meta: {
      commentId,
      description: "Comment reward",
    },
  };

  await put("creditTransactions", transaction);
  await updateBalance(userId, CREDIT_REWARDS.COMMENT_CREATE, "earned");

  // Dispatch event for blockchain sync
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("credit-transaction", { detail: transaction }));
  }

  void notifyAchievements({
    type: "credits:earned",
    userId,
    amount: CREDIT_REWARDS.COMMENT_CREATE,
    source: "comment",
    transactionId: transaction.id,
    meta: { postId, commentId },
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

  // Dispatch event for blockchain sync
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("credit-transaction", { detail: transaction }));
  }

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

  // Dispatch event for blockchain sync
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("credit-transaction", { detail: transaction }));
  }

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
  const postLoadAmount = amount - burnAmount;
  const createdAt = new Date();
  const transaction: CreditTransaction = {
    id: crypto.randomUUID(),
    fromUserId: user.id,
    toUserId: `post:${postId}`,
    amount,
    type: "hype",
    postId,
    createdAt: createdAt.toISOString(),
    meta: {
      burn: burnAmount,
      postLoad: postLoadAmount,
      description: "Post hype boost",
    },
  };

  await put("creditTransactions", transaction);

  // Update balances
  await updateBalance(user.id, -amount, "spent");
  if (burnAmount > 0) {
    await updateBalance("burned", burnAmount, "burned");
  }

  if (postLoadAmount > 0) {
    void recordPostCredit(postId, postLoadAmount, createdAt);
  }

  void notifyAchievements({
    type: "credits:hype",
    userId: user.id,
    amount,
    postId,
    recipientId: post.author,
  });
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

interface TransferOptions {
  message?: string;
}

async function ensureRecipientExists(userId: string): Promise<User> {
  const recipient = await get<User>("users", userId);
  if (!recipient) {
    throw new Error("Recipient user not found");
  }
  return recipient;
}

function sanitizeMessage(message?: string): string | undefined {
  const trimmed = message?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.length > CREDIT_REWARDS.MAX_MESSAGE_LENGTH) {
    throw new Error(`Message must be ${CREDIT_REWARDS.MAX_MESSAGE_LENGTH} characters or fewer`);
  }

  return trimmed;
}

async function executeCreditTransfer(
  user: User,
  toUserId: string,
  amount: number,
  kind: "transfer" | "tip",
  options?: TransferOptions,
): Promise<void> {
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

  await ensureRecipientExists(toUserId);

  const rateLimitCheckpoint = prepareTransferRateLimit(user.id, amount);

  const message = sanitizeMessage(options?.message);

  const transaction: CreditTransaction = {
    id: crypto.randomUUID(),
    fromUserId: user.id,
    toUserId,
    amount,
    type: kind,
    createdAt: new Date().toISOString(),
    meta: message
      ? {
          description: message,
        }
      : undefined,
  };

  await put("creditTransactions", transaction);
  await updateBalance(user.id, -amount, "spent");
  await updateBalance(toUserId, amount, "earned");

  commitTransferRateLimit(rateLimitCheckpoint);

  emitCreditNotification({
    direction: "sent",
    userId: user.id,
    counterpartyId: toUserId,
    amount,
    transactionId: transaction.id,
    type: transaction.type,
    createdAt: transaction.createdAt,
    message,
  });

  emitCreditNotification({
    direction: "received",
    userId: toUserId,
    counterpartyId: user.id,
    amount,
    transactionId: transaction.id,
    type: transaction.type,
    createdAt: transaction.createdAt,
    message,
  });
}

export async function transferCredits(toUserId: string, amount: number, options?: TransferOptions): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");

  await executeCreditTransfer(user, toUserId, amount, "transfer", options);
}

export async function tipUser(toUserId: string, amount: number, options?: TransferOptions): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");

  if (amount < CREDIT_REWARDS.TIP_MIN || amount > CREDIT_REWARDS.TIP_MAX) {
    throw new Error(
      `Tips must be between ${CREDIT_REWARDS.TIP_MIN} and ${CREDIT_REWARDS.TIP_MAX} credits`,
    );
  }

  await executeCreditTransfer(user, toUserId, amount, "tip", options);
}
