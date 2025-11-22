// Profile Token Deployment on SWARM blockchain
import { ProfileToken, SwarmTransaction } from "./types";
import { getSwarmChain } from "./chain";
import { generateTransactionId, generateTokenId } from "./crypto";
import { getProfileToken, saveProfileToken } from "./storage";

const MAX_PROFILE_TOKEN_SUPPLY = 10000;

export async function deployProfileToken(params: {
  userId: string;
  name: string;
  ticker: string;
  description?: string;
  image?: string;
}): Promise<{ token: ProfileToken; transaction: SwarmTransaction }> {
  // Check if user already has a profile token
  const existing = await getProfileToken(params.userId);
  if (existing) {
    throw new Error("Profile token already deployed for this user");
  }

  // Validate ticker (3-5 uppercase letters)
  if (!/^[A-Z]{3,5}$/.test(params.ticker)) {
    throw new Error("Ticker must be 3-5 uppercase letters");
  }

  const tokenId = generateTokenId();

  const profileToken: ProfileToken = {
    tokenId,
    userId: params.userId,
    name: params.name,
    ticker: params.ticker,
    supply: 0,
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
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: params.userId,
    nonce: Date.now(),
    fee: 100, // 100 SWARM deployment fee
    meta: {
      tokenName: params.name,
      ticker: params.ticker,
      maxSupply: MAX_PROFILE_TOKEN_SUPPLY,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  await saveProfileToken(profileToken);

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

  return transaction;
}

export async function getUserProfileToken(userId: string): Promise<ProfileToken | null> {
  return getProfileToken(userId);
}

export function getMaxProfileTokenSupply(): number {
  return MAX_PROFILE_TOKEN_SUPPLY;
}
