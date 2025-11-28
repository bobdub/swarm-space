/**
 * Blockchain Recorder - Total Integration
 * Records all user actions to SWARM blockchain as NFT transactions
 */

import { getSwarmChain } from "./chain";
import type { SwarmTransaction, TransactionType } from "./types";
import { getCurrentUser } from "../auth";

export interface BlockchainActionParams {
  userId: string;
  type: TransactionType;
  amount?: number;
  meta?: Record<string, unknown>;
}

/**
 * Record any action to the blockchain
 */
export async function recordToBlockchain(params: BlockchainActionParams): Promise<SwarmTransaction> {
  const chain = getSwarmChain();
  const user = await getCurrentUser();
  
  if (!user) {
    throw new Error("User not authenticated");
  }

  // Create blockchain transaction
  const transaction: SwarmTransaction = {
    id: crypto.randomUUID(),
    type: params.type,
    from: params.userId,
    to: "swarm-network",
    amount: params.amount || 0,
    timestamp: new Date().toISOString(),
    signature: `sig-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    publicKey: user.id,
    nonce: Date.now(),
    fee: 0,
    meta: params.meta,
  };

  // Add to blockchain
  chain.addTransaction(transaction);

  // Broadcast via P2P if available
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("blockchain-transaction", {
        detail: transaction,
      })
    );
  }

  console.log(`[Blockchain] Recorded ${params.type}:`, transaction.id);
  return transaction;
}

/**
 * Record a post creation to blockchain
 */
export async function recordPostToBlockchain(postId: string, userId: string, content: string): Promise<void> {
  await recordToBlockchain({
    userId,
    type: "nft_mint",
    amount: 0,
    meta: {
      postId,
      contentPreview: content.slice(0, 100),
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Record a comment to blockchain
 */
export async function recordCommentToBlockchain(
  commentId: string,
  postId: string,
  userId: string,
  text: string
): Promise<void> {
  await recordToBlockchain({
    userId,
    type: "nft_mint",
    amount: 0,
    meta: {
      commentId,
      postId,
      textPreview: text.slice(0, 100),
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Record a reaction to blockchain
 */
export async function recordReactionToBlockchain(
  postId: string,
  userId: string,
  emoji: string
): Promise<void> {
  await recordToBlockchain({
    userId,
    type: "nft_transfer",
    amount: 0,
    meta: {
      postId,
      emoji,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Record an achievement unlock to blockchain
 */
export async function recordAchievementToBlockchain(
  achievementId: string,
  userId: string,
  achievementTitle: string
): Promise<void> {
  await recordToBlockchain({
    userId,
    type: "achievement_wrap",
    amount: 1,
    meta: {
      achievementId,
      achievementTitle,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Record a reward transaction to blockchain
 */
export async function recordRewardToBlockchain(
  userId: string,
  amount: number,
  reason: string
): Promise<void> {
  await recordToBlockchain({
    userId,
    type: "reward_claim",
    amount,
    meta: {
      reason,
      timestamp: new Date().toISOString(),
    },
  });
}
