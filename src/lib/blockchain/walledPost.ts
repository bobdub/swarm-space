/**
 * Walled Post Engine
 * ──────────────────
 * Encrypted paywall for posts using the Literal Wrap Protocol.
 *
 * Lock: 5 SWARM fee → 1 coin wraps post metadata, 4 go to pool.
 * Unlock: Viewer pays creator-set token price → wrapped into serving coin.
 * Extract: Owner extracts payments → post becomes community-unlocked.
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
} from "./types";
import {
  WALLED_POST_SWARM_FEE,
  WALLED_POST_CONTENT_COIN_COUNT,
  WALLED_POST_POOL_COINS,
  COIN_MAX_WEIGHT,
  TOKEN_WEIGHT_UNIT,
  WRAP_METADATA_OVERHEAD,
} from "./types";
import type { Post } from "@/types";

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
 * @param userId           — the creator locking the post
 * @param postId           — the post to lock
 * @param unlockCostTokenId — which token viewers must pay
 * @param unlockCostTicker  — ticker symbol
 * @param unlockCostAmount  — how many tokens to unlock
 */
export async function lockPost(
  userId: string,
  postId: string,
  unlockCostTokenId: string,
  unlockCostTicker: string,
  unlockCostAmount: number,
): Promise<SwarmTransaction> {
  if (unlockCostAmount <= 0) throw new Error("Unlock cost must be positive");

  // 1. MineHealth gate
  const health = await validateMineHealth(userId);
  if (!health.healthy) {
    throw new Error(`MineHealth check failed: ${health.reason}`);
  }

  // 2. Pool needs at least WALLED_POST_SWARM_FEE + 1 coins
  const poolCoins = await getPoolCoins();
  const requiredCoins = WALLED_POST_SWARM_FEE + 1;
  if (poolCoins.length < requiredCoins) {
    throw new Error(
      `Community pool needs ${requiredCoins} coins. Pool has: ${poolCoins.length}`,
    );
  }

  // 3. Get the post
  const post = await get<Post>("posts", postId);
  if (!post) throw new Error(`Post ${postId} not found`);
  if (post.author !== userId) throw new Error("Only the post author can lock it");
  if (post.walled) throw new Error("Post is already walled");

  // 4. Select coins — shuffle, pick WALLED_POST_SWARM_FEE coins
  const shuffled = shuffle([...poolCoins]);
  const selectedCoins = shuffled.slice(0, WALLED_POST_SWARM_FEE);

  if (selectedCoins.length < WALLED_POST_SWARM_FEE) {
    throw new Error("Not enough coins in pool");
  }

  // 5. First coin wraps post metadata
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

  // 6. Remaining 4 coins go back to pool (already pool status)
  for (let i = WALLED_POST_CONTENT_COIN_COUNT; i < WALLED_POST_SWARM_FEE; i++) {
    // They stay in pool — no change needed, but mark them as checked=false
    selectedCoins[i].checkedForWrap = false;
    await saveCoin(selectedCoins[i]);
  }

  // 7. Create WalledPostLock record
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

  // 8. Update post record
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

  // 9. Record transaction
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
    `[WalledPost] Post ${postId} locked. Coin ${contentCoin.coinId} serves content. ` +
    `Unlock cost: ${unlockCostAmount} ${unlockCostTicker}`,
  );

  return transaction;
}

// ── Unlock Post ────────────────────────────────────────────────────────

/**
 * Unlocks a walled post by wrapping payment tokens into the serving coin.
 */
export async function unlockPost(
  userId: string,
  postId: string,
  paymentTokenId: string,
  paymentTicker: string,
  paymentAmount: number,
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

  // 3. Verify payment matches unlock cost
  if (paymentAmount < lock.unlockCostAmount) {
    throw new Error(
      `Insufficient payment. Need ${lock.unlockCostAmount} ${lock.unlockCostTicker}, got ${paymentAmount}`,
    );
  }

  // 4. Check serving coin capacity
  const allCoins = await getAll<SwarmCoin>("swarmCoins");
  const servingCoin = allCoins.find((c) => c.coinId === lock.coinId);
  if (!servingCoin) throw new Error("Serving coin not found");

  const payloadWeight = paymentAmount * TOKEN_WEIGHT_UNIT + WRAP_METADATA_OVERHEAD;
  const remainingCapacity = servingCoin.maxWeight - servingCoin.weight;

  if (remainingCapacity < payloadWeight) {
    // Coin is full — move to owner wallet, set extraction needed
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

  // 5. Wrap payment into serving coin
  const paymentPayload: WrappedTokenPayload = {
    tokenId: paymentTokenId,
    ticker: paymentTicker,
    amount: paymentAmount,
    wrappedAt: new Date().toISOString(),
    wrappedBy: userId,
  };
  servingCoin.wrappedTokens.push(paymentPayload);
  servingCoin.weight += payloadWeight;
  await saveCoin(servingCoin);

  // 6. Grant access
  const unlockedBy = [...(post.unlockedBy || []), userId];
  const updatedPost: Post = { ...post, unlockedBy };
  await put("posts", updatedPost);

  // 7. Check if coin is now full after this unlock
  if (servingCoin.weight >= servingCoin.maxWeight * 0.95) {
    // Approaching capacity — flag for extraction
    lock.extractionNeeded = true;
    await put("walledPosts", lock);
  }

  // 8. Record transaction
  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "post_unlock",
    from: userId,
    to: lock.creatorId,
    amount: paymentAmount,
    tokenId: paymentTokenId,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      postId,
      coinId: lock.coinId,
      paymentTicker,
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
    `[WalledPost] User ${userId} unlocked post ${postId} for ${paymentAmount} ${paymentTicker}`,
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

  // Use the existing extraction engine from coinWrap
  const extractTx = await extractTokensFromCoin(userId, lock.coinId);

  // Mark post as community-unlocked
  const post = await get<Post>("posts", postId);
  if (post) {
    const updatedPost: Post = {
      ...post,
      walledCommunityUnlocked: true,
    };
    await put("posts", updatedPost);
  }

  // Update lock record
  lock.extractionNeeded = false;
  await put("walledPosts", lock);

  // Record extraction transaction
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

/** Check if a user can view a walled post's content */
export function canViewWalledPost(post: Post, userId: string | undefined): boolean {
  if (!post.walled) return true;
  if (post.walledCommunityUnlocked) return true;
  if (!userId) return false;
  if (post.author === userId) return true;
  return post.unlockedBy?.includes(userId) ?? false;
}

/** Get walled post lock record */
export async function getWalledPostLock(postId: string): Promise<WalledPostLock | undefined> {
  return get<WalledPostLock>("walledPosts", postId);
}
