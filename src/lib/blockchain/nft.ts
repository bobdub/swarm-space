// NFT Implementation for Achievement/Badge Wrapping
import { NFTMetadata, SwarmTransaction, NFTAttribute } from "./types";
import { getSwarmChain } from "./chain";
import { generateTransactionId, generateTokenId } from "./crypto";
import { getNFT, saveNFT, getNFTsByOwner } from "./storage";
import type { AchievementDefinition, AchievementProgressRecord } from "@/types";

export async function wrapAchievementAsNFT(params: {
  achievement: AchievementDefinition;
  progress: AchievementProgressRecord;
  owner: string;
}): Promise<{ nft: NFTMetadata; transaction: SwarmTransaction }> {
  const tokenId = generateTokenId();

  const attributes: NFTAttribute[] = [
    { trait_type: "Category", value: params.achievement.category },
    { trait_type: "Rarity", value: params.achievement.rarity || "common" },
    { trait_type: "Credit Reward", value: params.achievement.creditReward, display_type: "number" },
    { trait_type: "QCM Impact", value: params.achievement.qcmImpact },
    { trait_type: "Unlocked At", value: params.progress.unlockedAt || "", display_type: "date" },
  ];

  if (params.progress.progress !== undefined) {
    attributes.push({
      trait_type: "Progress",
      value: params.progress.progress * 100,
      display_type: "boost_percentage",
    });
  }

  const nft: NFTMetadata = {
    tokenId,
    name: params.achievement.title,
    description: params.achievement.description,
    attributes,
    achievementId: params.achievement.id,
    rarity: params.achievement.rarity,
    mintedAt: new Date().toISOString(),
    minter: params.owner,
  };

  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "nft_mint",
    from: "system",
    to: params.owner,
    tokenId,
    nftData: nft,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: params.owner,
    nonce: Date.now(),
    fee: 0,
    meta: {
      achievementId: params.achievement.id,
      achievementSlug: params.achievement.slug,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  await saveNFT(nft);

  return { nft, transaction };
}

export async function wrapBadgeAsNFT(params: {
  badgeId: string;
  badgeTitle: string;
  badgeDescription: string;
  badgeCategory: string;
  owner: string;
  rarity?: string;
  imageUrl?: string;
}): Promise<{ nft: NFTMetadata; transaction: SwarmTransaction }> {
  const tokenId = generateTokenId();

  const attributes: NFTAttribute[] = [
    { trait_type: "Category", value: params.badgeCategory },
    { trait_type: "Badge Type", value: "Profile Badge" },
  ];

  if (params.rarity) {
    attributes.push({ trait_type: "Rarity", value: params.rarity });
  }

  const nft: NFTMetadata = {
    tokenId,
    name: params.badgeTitle,
    description: params.badgeDescription,
    image: params.imageUrl,
    attributes,
    badgeId: params.badgeId,
    rarity: params.rarity,
    mintedAt: new Date().toISOString(),
    minter: params.owner,
  };

  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "nft_mint",
    from: "system",
    to: params.owner,
    tokenId,
    nftData: nft,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: params.owner,
    nonce: Date.now(),
    fee: 0,
    meta: {
      badgeId: params.badgeId,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  await saveNFT(nft);

  return { nft, transaction };
}

export async function transferNFT(params: {
  tokenId: string;
  from: string;
  to: string;
  fee?: number;
}): Promise<SwarmTransaction> {
  const nft = await getNFT(params.tokenId);
  if (!nft) {
    throw new Error("NFT not found");
  }

  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "nft_transfer",
    from: params.from,
    to: params.to,
    tokenId: params.tokenId,
    nftData: nft,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: params.from,
    nonce: Date.now(),
    fee: params.fee || 0,
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  return transaction;
}

export async function burnNFT(params: {
  tokenId: string;
  owner: string;
  reason: string;
}): Promise<SwarmTransaction> {
  const nft = await getNFT(params.tokenId);
  if (!nft) {
    throw new Error("NFT not found");
  }

  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "nft_burn",
    from: params.owner,
    to: "0x0",
    tokenId: params.tokenId,
    nftData: nft,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: params.owner,
    nonce: Date.now(),
    fee: 0,
    meta: { reason: params.reason },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  return transaction;
}

export async function getUserNFTs(address: string): Promise<NFTMetadata[]> {
  return getNFTsByOwner(address);
}

export async function getNFTMetadata(tokenId: string): Promise<NFTMetadata | null> {
  return getNFT(tokenId);
}
