// Creator Token Deployment on SWARM blockchain
// One per account, max 10,000 supply, costs 1,000 credits
import {
  CreatorToken,
  SwarmTransaction,
  CREATOR_TOKEN_MAX_SUPPLY,
  CREATOR_TOKEN_DEPLOY_COST,
  CREATOR_TOKEN_SWARM_DEPLOY_COST,
} from "./types";
// Keep ProfileToken alias for backward compat
import type { ProfileToken } from "./types";
import { getSwarmChain } from "./chain";
import { generateTransactionId, generateTokenId } from "./crypto";
import { getProfileToken, saveProfileToken } from "./storage";

export async function deployProfileToken(params: {
  userId: string;
  name: string;
  ticker: string;
  description?: string;
  image?: string;
}): Promise<{ token: ProfileToken; transaction: SwarmTransaction }> {
  // Check credit balance
  const { getCreditBalance, deductCredits } = await import("../credits");
  const balance = await getCreditBalance(params.userId);
  
  if (balance < CREATOR_TOKEN_DEPLOY_COST) {
    throw new Error(`Insufficient credits. Need ${CREATOR_TOKEN_DEPLOY_COST} credits to deploy a Creator Token.`);
  }

  // Check SWARM balance for the market-launch fee
  const { getSwarmBalance, burnSwarm } = await import("./token");
  const swarmBalance = await getSwarmBalance(params.userId);
  if (swarmBalance < CREATOR_TOKEN_SWARM_DEPLOY_COST) {
    throw new Error(
      `Insufficient SWARM. Need ${CREATOR_TOKEN_SWARM_DEPLOY_COST} SWARM to launch the token market.`,
    );
  }

  // Check if user already has a profile token
  const existing = await getProfileToken(params.userId);

  if (existing) {
    const { hasProfileTokenBeenUsed } = await import("./profileTokenUsage");
    const used = await hasProfileTokenBeenUsed(existing.userId, existing.tokenId);

    if (used) {
      throw new Error("Profile token already in use and cannot be redeployed");
    }
  }

  // Deduct deployment cost
  await deductCredits(params.userId, CREATOR_TOKEN_DEPLOY_COST, "Creator Token Deployment");
  // Burn 50 SWARM to launch the market — routed to the community pool below.
  await burnSwarm({
    from: params.userId,
    amount: CREATOR_TOKEN_SWARM_DEPLOY_COST,
    reason: "Creator Token market launch fee",
  });
  try {
    const { getRewardPool, saveRewardPool } = await import("./storage");
    let pool = await getRewardPool();
    if (!pool) {
      pool = {
        id: "global",
        balance: 0,
        totalContributed: 0,
        lastUpdated: new Date().toISOString(),
        contributors: {},
      };
    }
    if (!pool.contributors) pool.contributors = {};
    pool.balance += CREATOR_TOKEN_SWARM_DEPLOY_COST;
    pool.totalContributed += CREATOR_TOKEN_SWARM_DEPLOY_COST;
    pool.contributors[params.userId] =
      (pool.contributors[params.userId] || 0) + CREATOR_TOKEN_SWARM_DEPLOY_COST;
    pool.lastUpdated = new Date().toISOString();
    await saveRewardPool(pool);
  } catch (err) {
    console.warn("[CreatorToken] Pool contribution failed:", err);
  }

  // Validate ticker (3-5 uppercase letters)
  if (!/^[A-Z]{3,5}$/.test(params.ticker)) {
    throw new Error("Ticker must be 3-5 uppercase letters");
  }

  const initialSupply = 1000; // Creator gets 1000 tokens initially
  const tokenId = existing ? existing.tokenId : generateTokenId();

  const profileToken: CreatorToken = {
    tokenId,
    userId: params.userId,
    name: params.name,
    ticker: params.ticker,
    supply: initialSupply,
    maxSupply: CREATOR_TOKEN_MAX_SUPPLY,
    deployedAt: new Date().toISOString(),
    contractAddress: `swarm://${tokenId}`,
    description: params.description,
    image: params.image,
  };

  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "profile_token_deploy",
    from: params.userId,
    to: params.userId,
    tokenId,
    amount: initialSupply,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: params.userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      tokenName: params.name,
      ticker: params.ticker,
      maxSupply: CREATOR_TOKEN_MAX_SUPPLY,
      initialSupply,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  await saveProfileToken(profileToken);

  // Give creator initial tokens in their holdings
  const { addProfileTokens } = await import("./profileTokenBalance");
  await addProfileTokens({
    userId: params.userId,
    tokenId,
    ticker: params.ticker,
    creatorUserId: params.userId,
    amount: initialSupply,
  });

  // Record deployment state for gradual unlock
  const { recordTokenDeploymentCredits } = await import("./profileTokenUnlock");
  await recordTokenDeploymentCredits(params.userId, tokenId);

  // Initialize the Creator Vault so the market page has a backing store
  const { ensureCreatorVault } = await import("./creatorVault");
  await ensureCreatorVault(tokenId, params.userId);

  console.log(`[CreatorToken] Deployed ${params.ticker} with ${initialSupply} initial tokens to creator`);

  return { token: profileToken, transaction };
}

/** @deprecated Use deployProfileToken — Creator Tokens are one-per-account */
export async function mintProfileToken(params: {
  userId: string;
  amount: number;
  recipient: string;
}): Promise<SwarmTransaction> {
  const token = await getProfileToken(params.userId);
  if (!token) {
    throw new Error("Profile token not deployed");
  }

  if (token.supply + params.amount > token.maxSupply) {
    throw new Error(`Cannot exceed max supply of ${token.maxSupply}`);
  }

  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "token_mint",
    from: params.userId,
    to: params.recipient,
    amount: params.amount,
    tokenId: token.tokenId,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: params.userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      profileToken: true,
      ticker: token.ticker,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  // Update supply
  token.supply += params.amount;
  await saveProfileToken(token);

  // Track recipient's balance
  const { addProfileTokens } = await import("./profileTokenBalance");
  await addProfileTokens({
    userId: params.recipient,
    tokenId: token.tokenId,
    ticker: token.ticker,
    creatorUserId: params.userId,
    amount: params.amount,
  });

  return transaction;
}

export async function getUserProfileToken(userId: string): Promise<CreatorToken | null> {
  return getProfileToken(userId);
}

/** Alias for getUserProfileToken */
export const getUserCreatorToken = getUserProfileToken;

export function getMaxProfileTokenSupply(): number {
  return CREATOR_TOKEN_MAX_SUPPLY;
}
