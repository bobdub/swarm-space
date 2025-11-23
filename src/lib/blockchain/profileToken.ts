// Profile Token Deployment on SWARM blockchain
import { ProfileToken, SwarmTransaction } from "./types";
import { getSwarmChain } from "./chain";
import { generateTransactionId, generateTokenId } from "./crypto";
import { getProfileToken, saveProfileToken } from "./storage";

const MAX_PROFILE_TOKEN_SUPPLY = 10000;

const PROFILE_TOKEN_DEPLOYMENT_COST = 100;

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
  
  if (balance < PROFILE_TOKEN_DEPLOYMENT_COST) {
    throw new Error(`Insufficient credits. Need ${PROFILE_TOKEN_DEPLOYMENT_COST} credits to deploy a profile token.`);
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
  await deductCredits(params.userId, PROFILE_TOKEN_DEPLOYMENT_COST, "Profile Token Deployment");

  // Validate ticker (3-5 uppercase letters)
  if (!/^[A-Z]{3,5}$/.test(params.ticker)) {
    throw new Error("Ticker must be 3-5 uppercase letters");
  }

  const initialSupply = 1000; // Creator gets 1000 tokens initially
  const tokenId = existing ? existing.tokenId : generateTokenId();

  const profileToken: ProfileToken = {
    tokenId,
    userId: params.userId,
    name: params.name,
    ticker: params.ticker,
    supply: initialSupply,
    maxSupply: MAX_PROFILE_TOKEN_SUPPLY,
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
    fee: 100, // 100 SWARM deployment fee
    meta: {
      tokenName: params.name,
      ticker: params.ticker,
      maxSupply: MAX_PROFILE_TOKEN_SUPPLY,
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

  console.log(`[Profile Token] Deployed ${params.ticker} with ${initialSupply} initial tokens to creator`);

  return { token: profileToken, transaction };
}

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

export async function getUserProfileToken(userId: string): Promise<ProfileToken | null> {
  return getProfileToken(userId);
}

export function getMaxProfileTokenSupply(): number {
  return MAX_PROFILE_TOKEN_SUPPLY;
}
