// NFT Post Creation - Posts that lock profile tokens and reward hypers
import { put } from "../store";
import type { Post } from "@/types";
import type { ProfileToken } from "./types";
import { getCurrentUser } from "../auth";
import { mintProfileToken } from "./profileToken";
import { wrapAchievementAsNFT } from "./nft";

export interface NFTPostMetadata {
  isNFTPost: true;
  tokenId: string;
  lockedTokens: number;
  profileTokenTicker: string;
  creatorUserId: string;
  rewardedUsers: string[]; // Track who already got rewarded
}

export async function createNFTPost(params: {
  userId: string;
  title: string;
  content: string;
  tokenAmount: number;
  profileToken: ProfileToken;
}): Promise<Post> {
  const user = getCurrentUser();
  if (!user) {
    throw new Error("User not authenticated");
  }

  const tokenId = `nft-post-${crypto.randomUUID()}`;
  
  // Create the NFT metadata
  const { nft, transaction } = await wrapAchievementAsNFT({
    achievement: {
      id: tokenId,
      slug: "nft-post",
      title: params.title,
      description: params.content,
      creditReward: 0,
      qcmImpact: "NFT Post",
      category: "content",
      rarity: "legendary",
    },
    progress: {
      id: crypto.randomUUID(),
      userId: params.userId,
      achievementId: tokenId,
      unlocked: true,
      unlockedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    },
    owner: params.userId,
  });

  // Create post with NFT metadata
  const nftPostMetadata: NFTPostMetadata = {
    isNFTPost: true,
    tokenId,
    lockedTokens: params.tokenAmount,
    profileTokenTicker: params.profileToken.ticker,
    creatorUserId: params.userId,
    rewardedUsers: [],
  };

  const post: Post = {
    id: crypto.randomUUID(),
    author: params.userId,
    authorName: user.username,
    type: "text",
    content: `🎨 **${params.title}**\n\n${params.content}\n\n✨ NFT Post • ${params.tokenAmount} ${params.profileToken.ticker} locked • Hype to earn +1 ${params.profileToken.ticker}`,
    createdAt: new Date().toISOString(),
    reactions: [],
    commentCount: 0,
    tags: ["nft", params.profileToken.ticker.toLowerCase()],
    // Store NFT metadata in the post
    ...({ nftMetadata: nftPostMetadata } as any),
  };

  await put("posts", post);

  // Dispatch event for P2P sync
  window.dispatchEvent(
    new CustomEvent("p2p-posts-updated", {
      detail: { posts: [post] },
    })
  );

  console.log(`[NFT Post] Created with ${params.tokenAmount} tokens locked:`, post.id);
  return post;
}

export async function rewardHyperWithProfileToken(params: {
  postId: string;
  userId: string;
  nftMetadata: NFTPostMetadata;
}): Promise<boolean> {
  // Check if user already got rewarded for this post
  if (params.nftMetadata.rewardedUsers.includes(params.userId)) {
    console.log(`[NFT Post] User ${params.userId} already rewarded for post ${params.postId}`);
    return false;
  }

  // Check if there are tokens left to distribute
  if (params.nftMetadata.rewardedUsers.length >= params.nftMetadata.lockedTokens) {
    console.log(`[NFT Post] All tokens distributed for post ${params.postId}`);
    return false;
  }

  try {
    // Mint 1 profile token to the hyper
    await mintProfileToken({
      userId: params.nftMetadata.creatorUserId,
      amount: 1,
      recipient: params.userId,
    });

    console.log(`[NFT Post] Rewarded ${params.userId} with 1 ${params.nftMetadata.profileTokenTicker}`);
    return true;
  } catch (error) {
    console.error("[NFT Post] Failed to reward hyper:", error);
    return false;
  }
}
