/**
 * Blockchain Recorder - Total Integration
 * Records all user actions to SWARM blockchain as NFT transactions.
 * Every transaction is tagged with the user's active chainId so that
 * posts, comments, reactions, and rewards belong to the correct chain.
 */

import { getSwarmChain } from "./chain";
import type { SwarmTransaction, TransactionType, NFTMetadata, NFTAttribute } from "./types";
import { getCurrentUser } from "../auth";
import { getActiveChain } from "./multiChainManager";
import { generateTokenId } from "./crypto";
import { saveNFT } from "./storage";

export interface BlockchainActionParams {
  userId: string;
  type: TransactionType;
  amount?: number;
  meta?: Record<string, unknown>;
  /** Override chain — defaults to the user's active chain */
  chainId?: string;
}

/**
 * Record any action to the blockchain, tagged with the active chain.
 */
export async function recordToBlockchain(params: BlockchainActionParams): Promise<SwarmTransaction> {
  const chain = getSwarmChain();
  await chain.whenReady();
  const user = await getCurrentUser();
  
  if (!user) {
    throw new Error("User not authenticated");
  }

  const activeChain = getActiveChain();
  const chainId = params.chainId || activeChain.chainId;

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
    chainId,
    meta: {
      ...params.meta,
      chainId,
      chainTicker: activeChain.ticker,
    },
  };

  chain.addTransaction(transaction);

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("blockchain-transaction", {
        detail: transaction,
      })
    );
  }

  console.log(`[Blockchain] Recorded ${params.type} on ${chainId}:`, transaction.id);
  return transaction;
}

/**
 * Record a post creation to blockchain AND mint it as an NFT.
 * This ensures posts appear in the Wallet > NFTs tab.
 */
export async function recordPostToBlockchain(postId: string, userId: string, content: string, manifestIds?: string[]): Promise<void> {
  const activeChain = getActiveChain();
  const tokenId = generateTokenId();

  // Build NFT metadata for this post
  const hasMedia = (manifestIds?.length ?? 0) > 0;
  const attributes: NFTAttribute[] = [
    { trait_type: "Type", value: "Post" },
    { trait_type: "Has Media", value: hasMedia ? "Yes" : "No" },
    { trait_type: "Media Count", value: manifestIds?.length ?? 0, display_type: "number" },
  ];

  // Try to resolve an image reference from the first manifest
  let imageRef: string | undefined;
  if (hasMedia && manifestIds && manifestIds.length > 0) {
    try {
      const { get } = await import("../store");
      const manifest = await get("manifests", manifestIds[0]) as { mime?: string; fileId?: string; originalName?: string } | undefined;
      if (manifest?.mime?.startsWith('image/')) {
        imageRef = `manifest:${manifestIds[0]}`;
        attributes.push({ trait_type: "Image", value: manifest.originalName ?? manifestIds[0] });
      }
    } catch { /* non-critical */ }
  }

  const nft: NFTMetadata = {
    tokenId,
    name: content.length > 60 ? content.slice(0, 57) + "…" : content || "Post",
    description: content.slice(0, 200),
    image: imageRef,
    attributes,
    mintedAt: new Date().toISOString(),
    minter: userId,
  };

  // Persist the NFT to IndexedDB so getUserNFTs() can find it
  await saveNFT(nft);

  const chain = getSwarmChain();
  await chain.whenReady();

  const transaction: SwarmTransaction = {
    id: crypto.randomUUID(),
    type: "nft_mint",
    from: userId,
    to: userId,
    amount: 0,
    tokenId,
    nftData: nft,
    timestamp: new Date().toISOString(),
    signature: `sig-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    publicKey: userId,
    nonce: Date.now(),
    fee: 0,
    chainId: activeChain.chainId,
    meta: {
      postId,
      contentPreview: content.slice(0, 100),
      manifestIds: manifestIds || [],
      hasMedia: (manifestIds?.length ?? 0) > 0,
      chainId: activeChain.chainId,
      chainTicker: activeChain.ticker,
      timestamp: new Date().toISOString(),
    },
  };

  chain.addTransaction(transaction);

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("blockchain-transaction", { detail: transaction })
    );
  }

  console.log(`[Blockchain] Post ${postId} minted as NFT ${tokenId} on ${activeChain.chainId}`);
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
