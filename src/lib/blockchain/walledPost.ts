/**
 * Walled Post Engine
 * ──────────────────
 * Encrypted paywall for posts using the Literal Wrap Protocol.
 *
 * Lock: 5 SWARM fee → 1 coin wraps post metadata, 4 go to pool.
 *       User can pay with ANY coin or token — non-SWARM assets are
 *       auto-swapped at ratio via the community pool.
 *
 * Unlock: Viewer pays creator-set token price → wrapped into serving coin.
 *         Can pay with any asset at ratio.
 *
 * Extract: Owner extracts payments → post becomes community-unlocked.
 *
 * Ratios:
 *   - SWARM coins: 1:1 (direct, no swap needed)
 *   - Sub-chain coins: 2:1 to SWARM (SWAP_RATIO_TO_SWARM)
 *   - Creator tokens: 10:1 to SWARM (TOKEN_TO_SWARM_RATIO)
 */

import { getAll, get, put } from "../store";
import { validateMineHealth } from "./mineHealthValidator";
import { generateTransactionId } from "./crypto";
import { getSwarmChain } from "./chain";
import { extractTokensFromCoin } from "./coinWrap";
import type {
  SwarmCoin,
  WrappedTokenPayload,
  SwarmTransaction,
  WalledPostLock,
  DeployedCoin,
} from "./types";
import {
  WALLED_POST_SWARM_FEE,
  WALLED_POST_CONTENT_COIN_COUNT,
  WALLED_POST_POOL_COINS,
  COIN_MAX_WEIGHT,
  TOKEN_WEIGHT_UNIT,
  WRAP_METADATA_OVERHEAD,
  SWAP_RATIO_TO_SWARM,
  TOKEN_TO_SWARM_RATIO,
} from "./types";
import type { Post } from "@/types";

// ── Payment Asset Types ────────────────────────────────────────────────

export type PaymentAssetType = "swarm" | "coin" | "token";

export interface PaymentAsset {
  type: PaymentAssetType;
  id: string;
  ticker: string;
  /** How many units of this asset = 1 SWARM coin */
  ratioToSwarm: number;
}

/**
 * Calculate the dynamic cost in any asset to cover a SWARM amount.
 * e.g., 5 SWARM at 10:1 token ratio = 50 tokens
 */
export function calculateDynamicCost(swarmAmount: number, asset: PaymentAsset): number {
  return swarmAmount * asset.ratioToSwarm;
}

/**
 * Get the ratio for a given asset type.
 */
export function getAssetRatio(type: PaymentAssetType): number {
  switch (type) {
    case "swarm": return 1;
    case "coin": return SWAP_RATIO_TO_SWARM; // 2:1
    case "token": return TOKEN_TO_SWARM_RATIO; // 10:1
  }
}

/**
 * Build a list of available payment assets for a user.
 */
export async function getUserPaymentAssets(userId: string): Promise<PaymentAsset[]> {
  const assets: PaymentAsset[] = [];

  // SWARM is always available
  assets.push({
    type: "swarm",
    id: "SWARM",
    ticker: "SWARM",
    ratioToSwarm: 1,
  });

  // User's deployed coins
  try {
    const coins = await getAll<DeployedCoin>("deployedCoins");
    const userCoins = coins.filter((c) => c.deployerUserId === userId && c.status === "active");
    for (const coin of userCoins) {
      assets.push({
        type: "coin",
        id: coin.coinId,
        ticker: coin.ticker,
        ratioToSwarm: SWAP_RATIO_TO_SWARM,
      });
    }
  } catch { /* no deployed coins store yet */ }

  // User's token holdings
  try {
    const { getUserProfileTokenHoldings } = await import("./profileTokenBalance");
    const holdings = await getUserProfileTokenHoldings(userId);
    for (const holding of holdings) {
      if (holding.amount > 0) {
        assets.push({
          type: "token",
          id: holding.tokenId,
          ticker: holding.ticker,
          ratioToSwarm: TOKEN_TO_SWARM_RATIO,
        });
      }
    }
  } catch { /* no holdings */ }

  return assets;
}

// ── Helpers ────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function getPoolCoins(): Promise<SwarmCoin[]> {
  const all = await getAll<SwarmCoin>("swarmCoins");
  return all.filter((c) => c.status === "pool");
}

async function saveCoin(coin: SwarmCoin): Promise<void> {
  await put("swarmCoins", coin);
}

// ── Lock Post ──────────────────────────────────────────────────────────

/**
 * Locks a post behind an encrypted paywall.
 *
 * @param userId            — the creator locking the post
 * @param postId            — the post to lock
 * @param unlockCostTokenId — which token viewers must pay
 * @param unlockCostTicker  — ticker symbol
 * @param unlockCostAmount  — how many tokens to unlock
 * @param paymentAsset      — what asset the creator uses to pay the 5 SWARM fee
 */
export async function lockPost(
  userId: string,
  postId: string,
  unlockCostTokenId: string,
  unlockCostTicker: string,
  unlockCostAmount: number,
  paymentAsset?: PaymentAsset,
): Promise<SwarmTransaction> {
  if (unlockCostAmount <= 0) throw new Error("Unlock cost must be positive");

  // Default to SWARM if no payment asset specified
  const asset: PaymentAsset = paymentAsset ?? {
    type: "swarm",
    id: "SWARM",
    ticker: "SWARM",
    ratioToSwarm: 1,
  };

  // 1. MineHealth gate
  const health = await validateMineHealth(userId);
  if (!health.healthy) {
    throw new Error(`MineHealth check failed: ${health.reason}`);
  }

  // 2. Calculate payment in user's chosen asset
  const paymentInAsset = calculateDynamicCost(WALLED_POST_SWARM_FEE, asset);

  // 3. Verify user has enough of their chosen asset and deduct
  if (asset.type === "token") {
    const { getUserProfileTokenHoldings, saveProfileTokenHolding } = await import("./profileTokenBalance");
    const holdings = await getUserProfileTokenHoldings(userId);
    const holding = holdings.find((h) => h.tokenId === asset.id);
    if (!holding || holding.amount < paymentInAsset) {
      throw new Error(
        `Insufficient ${asset.ticker}. Need: ${paymentInAsset}, Have: ${holding?.amount ?? 0}. ` +
        `(${WALLED_POST_SWARM_FEE} SWARM × ${asset.ratioToSwarm}:1 ratio)`,
      );
    }
    holding.amount -= paymentInAsset;
    holding.lastUpdated = new Date().toISOString();
    await saveProfileTokenHolding(holding);
  } else if (asset.type === "coin") {
    // Deduct sub-chain coins from user's wallet
    const userCoins = (await getAll<SwarmCoin>("swarmCoins"))
      .filter((c) => c.ownerId === userId && c.status === "wallet");
    if (userCoins.length < paymentInAsset) {
      throw new Error(
        `Insufficient ${asset.ticker} coins. Need: ${paymentInAsset}, Have: ${userCoins.length}. ` +
        `(${WALLED_POST_SWARM_FEE} SWARM × ${asset.ratioToSwarm}:1 ratio)`,
      );
    }
    // Return payment coins to pool
    for (let i = 0; i < paymentInAsset; i++) {
      userCoins[i].status = "pool";
      userCoins[i].ownerId = "community-pool";
      await saveCoin(userCoins[i]);
    }
  } else {
    // SWARM type — verify user has enough SWARM balance
    const { getSwarmBalance } = await import("./token");
    const balance = await getSwarmBalance(userId);
    if (balance < WALLED_POST_SWARM_FEE) {
      throw new Error(
        `Insufficient SWARM balance. Need: ${WALLED_POST_SWARM_FEE}, Have: ${balance}`,
      );
    }
  }

  // 4. Pool needs at least WALLED_POST_SWARM_FEE + 1 coins
  const poolCoins = await getPoolCoins();
  const requiredCoins = WALLED_POST_SWARM_FEE + 1;
  if (poolCoins.length < requiredCoins) {
    throw new Error(
      `Community pool needs ${requiredCoins} coins. Pool has: ${poolCoins.length}`,
    );
  }

  // 5. Get the post
  const post = await get<Post>("posts", postId);
  if (!post) throw new Error(`Post ${postId} not found`);
  if (post.author !== userId) throw new Error("Only the post author can lock it");
  if (post.walled) throw new Error("Post is already walled");

  // 6. Select coins — shuffle, pick WALLED_POST_SWARM_FEE coins from pool
  const shuffled = shuffle([...poolCoins]);
  const selectedCoins = shuffled.slice(0, WALLED_POST_SWARM_FEE);

  if (selectedCoins.length < WALLED_POST_SWARM_FEE) {
    throw new Error("Not enough coins in pool");
  }

  // 7. First coin wraps post metadata
  const contentCoin = selectedCoins[0];
  const manifestIds = post.manifestIds || [];
  const contentHash = `${postId}-${Date.now()}`;

  const contentPayload: WrappedTokenPayload = {
    tokenId: `walled-content-${postId}`,
    ticker: "CONTENT",
    amount: 1,
    wrappedAt: new Date().toISOString(),
    wrappedBy: userId,
  };

  const payloadWeight = 1 * TOKEN_WEIGHT_UNIT + WRAP_METADATA_OVERHEAD;
  contentCoin.wrappedTokens.push(contentPayload);
  contentCoin.weight += payloadWeight;
  contentCoin.status = "wallet";
  contentCoin.ownerId = userId;
  await saveCoin(contentCoin);

  // 8. Remaining 4 coins go back to pool
  for (let i = WALLED_POST_CONTENT_COIN_COUNT; i < WALLED_POST_SWARM_FEE; i++) {
    selectedCoins[i].checkedForWrap = false;
    await saveCoin(selectedCoins[i]);
  }

  // 9. Create WalledPostLock record
  const lock: WalledPostLock = {
    postId,
    coinId: contentCoin.coinId,
    creatorId: userId,
    unlockCostTokenId,
    unlockCostTicker,
    unlockCostAmount,
    lockedManifestIds: manifestIds,
    lockedContentHash: contentHash,
    extractionNeeded: false,
    createdAt: new Date().toISOString(),
  };
  await put("walledPosts", lock);

  // 10. Update post record
  const updatedPost: Post = {
    ...post,
    walled: true,
    wallCoinId: contentCoin.coinId,
    unlockCostTokenId,
    unlockCostTicker,
    unlockCostAmount,
    unlockedBy: [],
    walledCommunityUnlocked: false,
  };
  await put("posts", updatedPost);

  // 11. Record transaction
  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "post_lock",
    from: userId,
    to: "community-pool",
    amount: WALLED_POST_SWARM_FEE,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      postId,
      coinId: contentCoin.coinId,
      unlockCostTokenId,
      unlockCostTicker,
      unlockCostAmount,
      coinsUsed: WALLED_POST_SWARM_FEE,
      coinsToPool: WALLED_POST_POOL_COINS,
      paymentAssetType: asset.type,
      paymentAssetTicker: asset.ticker,
      paymentAssetAmount: paymentInAsset,
      paymentRatio: asset.ratioToSwarm,
      mineHealthPassed: true,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: transaction }));
    window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
  }

  console.log(
    `[WalledPost] Post ${postId} locked. Paid ${paymentInAsset} ${asset.ticker} ` +
    `(${asset.ratioToSwarm}:1 → ${WALLED_POST_SWARM_FEE} SWARM). ` +
    `Coin ${contentCoin.coinId} serves content. Unlock cost: ${unlockCostAmount} ${unlockCostTicker}`,
  );

  return transaction;
}

// ── Unlock Post ────────────────────────────────────────────────────────

/**
 * Unlocks a walled post by wrapping payment tokens into the serving coin.
 * Viewers can pay with any asset at ratio.
 */
export async function unlockPost(
  userId: string,
  postId: string,
  paymentAsset: PaymentAsset,
): Promise<SwarmTransaction> {
  // 1. MineHealth gate
  const health = await validateMineHealth(userId);
  if (!health.healthy) {
    throw new Error(`MineHealth check failed: ${health.reason}`);
  }

  // 2. Get post and lock record
  const post = await get<Post>("posts", postId);
  if (!post) throw new Error(`Post ${postId} not found`);
  if (!post.walled) throw new Error("Post is not walled");
  if (post.walledCommunityUnlocked) throw new Error("Post is already community-unlocked");
  if (post.unlockedBy?.includes(userId)) throw new Error("You already unlocked this post");
  if (post.author === userId) throw new Error("You own this post — already visible");

  const lock = await get<WalledPostLock>("walledPosts", postId);
  if (!lock) throw new Error("Walled post lock record not found");

  // 3. Calculate what the user must pay in their chosen asset
  // The unlock cost is denominated in the creator's token.
  // Convert: unlockCost (in creator tokens) → SWARM equivalent → user's asset
  const unlockCostInSwarm = lock.unlockCostAmount / TOKEN_TO_SWARM_RATIO;
  const paymentInUserAsset = Math.ceil(unlockCostInSwarm * paymentAsset.ratioToSwarm);

  // 4. Verify and deduct user's chosen asset
  if (paymentAsset.type === "token") {
    const { getUserProfileTokenHoldings, saveProfileTokenHolding } = await import("./profileTokenBalance");
    const holdings = await getUserProfileTokenHoldings(userId);
    const holding = holdings.find((h) => h.tokenId === paymentAsset.id);
    if (!holding || holding.amount < paymentInUserAsset) {
      throw new Error(
        `Insufficient ${paymentAsset.ticker}. Need: ${paymentInUserAsset}, Have: ${holding?.amount ?? 0}`,
      );
    }
    holding.amount -= paymentInUserAsset;
    holding.lastUpdated = new Date().toISOString();
    await saveProfileTokenHolding(holding);
  } else if (paymentAsset.type === "coin") {
    const userCoins = (await getAll<SwarmCoin>("swarmCoins"))
      .filter((c) => c.ownerId === userId && c.status === "wallet");
    if (userCoins.length < paymentInUserAsset) {
      throw new Error(
        `Insufficient ${paymentAsset.ticker} coins. Need: ${paymentInUserAsset}, Have: ${userCoins.length}`,
      );
    }
    for (let i = 0; i < paymentInUserAsset; i++) {
      userCoins[i].status = "pool";
      userCoins[i].ownerId = "community-pool";
      await saveCoin(userCoins[i]);
    }
  } else {
    // SWARM — verify balance
    const { getSwarmBalance } = await import("./token");
    const balance = await getSwarmBalance(userId);
    if (balance < paymentInUserAsset) {
      throw new Error(
        `Insufficient SWARM balance. Need: ${paymentInUserAsset}, Have: ${balance}`,
      );
    }
  }

  // 5. Check serving coin capacity
  const allCoins = await getAll<SwarmCoin>("swarmCoins");
  const servingCoin = allCoins.find((c) => c.coinId === lock.coinId);
  if (!servingCoin) throw new Error("Serving coin not found");

  const payloadWeight = paymentInUserAsset * TOKEN_WEIGHT_UNIT + WRAP_METADATA_OVERHEAD;
  const remainingCapacity = servingCoin.maxWeight - servingCoin.weight;

  if (remainingCapacity < payloadWeight) {
    servingCoin.status = "wallet";
    servingCoin.ownerId = lock.creatorId;
    await saveCoin(servingCoin);

    lock.extractionNeeded = true;
    await put("walledPosts", lock);

    throw new Error(
      `Serving coin is full (${servingCoin.weight}/${servingCoin.maxWeight}). ` +
      `Content has stopped serving. Owner must extract payments.`,
    );
  }

  // 6. Wrap payment into serving coin
  const paymentPayload: WrappedTokenPayload = {
    tokenId: paymentAsset.id,
    ticker: paymentAsset.ticker,
    amount: paymentInUserAsset,
    wrappedAt: new Date().toISOString(),
    wrappedBy: userId,
  };
  servingCoin.wrappedTokens.push(paymentPayload);
  servingCoin.weight += payloadWeight;
  await saveCoin(servingCoin);

  // 7. Grant access
  const unlockedBy = [...(post.unlockedBy || []), userId];
  const updatedPost: Post = { ...post, unlockedBy };
  await put("posts", updatedPost);

  // 8. Check if coin is approaching capacity
  if (servingCoin.weight >= servingCoin.maxWeight * 0.95) {
    lock.extractionNeeded = true;
    await put("walledPosts", lock);
  }

  // 9. Record transaction
  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "post_unlock",
    from: userId,
    to: lock.creatorId,
    amount: paymentInUserAsset,
    tokenId: paymentAsset.id,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      postId,
      coinId: lock.coinId,
      paymentAssetType: paymentAsset.type,
      paymentTicker: paymentAsset.ticker,
      paymentRatio: paymentAsset.ratioToSwarm,
      unlockCostOriginal: lock.unlockCostAmount,
      unlockCostTicker: lock.unlockCostTicker,
      paymentInUserAsset,
      payloadWeight,
      coinWeightAfter: servingCoin.weight,
      mineHealthPassed: true,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: transaction }));
    window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
  }

  console.log(
    `[WalledPost] User ${userId} unlocked post ${postId}. ` +
    `Paid ${paymentInUserAsset} ${paymentAsset.ticker} (${paymentAsset.ratioToSwarm}:1 ratio)`,
  );

  return transaction;
}

// ── Extract Walled Post Payments ───────────────────────────────────────

/**
 * Extracts all payment tokens from a walled post's serving coin.
 * Post becomes community-unlocked. Empty coin returns to pool.
 */
export async function extractWalledPostPayments(
  userId: string,
  postId: string,
): Promise<SwarmTransaction> {
  const lock = await get<WalledPostLock>("walledPosts", postId);
  if (!lock) throw new Error("Walled post lock not found");
  if (lock.creatorId !== userId) throw new Error("Only the post creator can extract payments");

  const extractTx = await extractTokensFromCoin(userId, lock.coinId);

  const post = await get<Post>("posts", postId);
  if (post) {
    const updatedPost: Post = {
      ...post,
      walledCommunityUnlocked: true,
    };
    await put("posts", updatedPost);
  }

  lock.extractionNeeded = false;
  await put("walledPosts", lock);

  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "post_extract_payments",
    from: lock.coinId,
    to: userId,
    amount: extractTx.amount,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      postId,
      coinId: lock.coinId,
      originalExtractTxId: extractTx.id,
      communityUnlocked: true,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: transaction }));
    window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
  }

  console.log(
    `[WalledPost] Extracted payments from post ${postId}. Post is now community-unlocked.`,
  );

  return transaction;
}

// ── Query Helpers ──────────────────────────────────────────────────────

export function canViewWalledPost(post: Post, userId: string | undefined): boolean {
  if (!post.walled) return true;
  if (post.walledCommunityUnlocked) return true;
  if (!userId) return false;
  if (post.author === userId) return true;
  return post.unlockedBy?.includes(userId) ?? false;
}

export async function getWalledPostLock(postId: string): Promise<WalledPostLock | undefined> {
  return get<WalledPostLock>("walledPosts", postId);
}
