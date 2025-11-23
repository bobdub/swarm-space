// Profile Token NFT Image System - Lock images as collectible NFTs
import { generateTransactionId, generateTokenId } from "./crypto";
import { getSwarmChain } from "./chain";
import type { SwarmTransaction, NFTMetadata } from "./types";
import { saveNFT } from "./storage";
import { getUserProfileTokenHoldings, saveProfileTokenHolding } from "./profileTokenBalance";
import { getProfileToken } from "./storage";

export interface ProfileTokenNFTImage {
  tokenId: string;
  minter: string;
  name: string;
  description?: string;
  image: string;
  attributes?: Array<{ trait_type: string; value: string | number }>;
  mintedAt?: string;
  profileTokenId: string;
  profileTokenTicker: string;
  tokensLocked: number;
  unlockedBy: string[];
  imageData?: string;
  downloadUrl?: string;
}

export async function createProfileTokenNFTImage(params: {
  userId: string;
  title: string;
  description?: string;
  imageData: string; // Base64 or URL
  tokensToLock: number;
}): Promise<{ nft: ProfileTokenNFTImage; transaction: SwarmTransaction }> {
  if (params.tokensToLock <= 0) {
    throw new Error("Must lock at least 1 token");
  }

  // Get user's profile token
  const profileToken = await getProfileToken(params.userId);
  if (!profileToken) {
    throw new Error("No profile token deployed");
  }

  // Verify user has enough tokens
  const holdings = await getUserProfileTokenHoldings(params.userId);
  const holding = holdings.find(h => h.tokenId === profileToken.tokenId);

  if (!holding || holding.amount < params.tokensToLock) {
    throw new Error(`Insufficient ${profileToken.ticker} tokens. Have: ${holding?.amount || 0}, Need: ${params.tokensToLock}`);
  }

  // Deduct tokens from user
  holding.amount -= params.tokensToLock;
  holding.lastUpdated = new Date().toISOString();
  await saveProfileTokenHolding(holding);

  // Create NFT
  const nftId = generateTokenId();
  const nft: ProfileTokenNFTImage = {
    tokenId: nftId,
    minter: params.userId,
    name: params.title,
    description: params.description,
    image: params.imageData,
    profileTokenId: profileToken.tokenId,
    profileTokenTicker: profileToken.ticker,
    tokensLocked: params.tokensToLock,
    unlockedBy: [params.userId], // Creator automatically has access
    imageData: params.imageData,
  };

  await saveNFT(nft);

  // Create blockchain transaction
  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "nft_mint",
    from: params.userId,
    to: params.userId,
    amount: params.tokensToLock,
    tokenId: nftId,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: params.userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      nftType: "profile-token-image",
      profileTokenId: profileToken.tokenId,
      profileTokenTicker: profileToken.ticker,
      tokensLocked: params.tokensToLock,
      title: params.title,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  console.log(`[NFT Image] Created ${params.title} with ${params.tokensToLock} ${profileToken.ticker} locked`);

  return { nft, transaction };
}

export async function unlockProfileTokenNFTImage(params: {
  nftId: string;
  userId: string;
  profileTokenId: string;
  tokensRequired: number;
}): Promise<void> {
  const { getNFT } = await import("./storage");
  const nft = await getNFT(params.nftId) as ProfileTokenNFTImage | null;

  if (!nft) {
    throw new Error("NFT not found");
  }

  if (nft.unlockedBy?.includes(params.userId)) {
    throw new Error("Already unlocked by this user");
  }

  // Verify user has required tokens
  const holdings = await getUserProfileTokenHoldings(params.userId);
  const holding = holdings.find(h => h.tokenId === params.profileTokenId);

  if (!holding || holding.amount < params.tokensRequired) {
    throw new Error(`Insufficient tokens. Need: ${params.tokensRequired}, Have: ${holding?.amount || 0}`);
  }

  // Deduct tokens
  holding.amount -= params.tokensRequired;
  holding.lastUpdated = new Date().toISOString();
  await saveProfileTokenHolding(holding);

  // Add user to unlocked list
  if (!nft.unlockedBy) {
    nft.unlockedBy = [];
  }
  nft.unlockedBy.push(params.userId);

  await saveNFT(nft);

  console.log(`[NFT Image] User ${params.userId} unlocked NFT ${params.nftId}`);
}

export async function getUserUnlockedNFTImages(userId: string): Promise<ProfileTokenNFTImage[]> {
  const { getNFTsByOwner } = await import("./storage");
  const allNFTs = await getNFTsByOwner(userId);
  
  // Also get NFTs unlocked by this user (not just owned)
  const { openDB } = await import("../store");
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction("nfts", "readonly");
    const request = tx.objectStore("nfts").getAll();
    
    request.onsuccess = () => {
      const all = request.result as ProfileTokenNFTImage[];
      const unlocked = all.filter(nft => 
        nft.profileTokenId && nft.unlockedBy?.includes(userId)
      );
      resolve(unlocked);
    };
    request.onerror = () => reject(request.error);
  });
}
