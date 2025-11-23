// Profile Token to SWARM Conversion System
import { getUserProfileTokenHoldings, saveProfileTokenHolding } from "./profileTokenBalance";
import { generateTransactionId } from "./crypto";
import { getSwarmChain } from "./chain";
import type { SwarmTransaction } from "./types";

const CONVERSION_RATE = 10; // 10 profile tokens = 1 SWARM credit

export async function convertProfileTokensToSwarm(params: {
  userId: string;
  tokenId: string;
  ticker: string;
  amount: number;
}): Promise<SwarmTransaction> {
  if (params.amount <= 0) {
    throw new Error("Amount must be positive");
  }

  if (params.amount % CONVERSION_RATE !== 0) {
    throw new Error(`Amount must be a multiple of ${CONVERSION_RATE}`);
  }

  // Get user's holding of this token
  const holdings = await getUserProfileTokenHoldings(params.userId);
  const holding = holdings.find(h => h.tokenId === params.tokenId);

  if (!holding || holding.amount < params.amount) {
    throw new Error(`Insufficient ${params.ticker} tokens. Have: ${holding?.amount || 0}, Need: ${params.amount}`);
  }

  // Calculate SWARM credits to award
  const swarmCredits = params.amount / CONVERSION_RATE;

  // Deduct profile tokens
  holding.amount -= params.amount;
  holding.lastUpdated = new Date().toISOString();
  await saveProfileTokenHolding(holding);

  // Award SWARM credits via manual transaction
  const { put } = await import("../store");
  const creditTx: any = {
    id: crypto.randomUUID(),
    fromUserId: "swarm-protocol",
    toUserId: params.userId,
    amount: swarmCredits,
    type: "earned_post",
    createdAt: new Date().toISOString(),
    meta: { description: `Converted ${params.amount} ${params.ticker} to SWARM` }
  };
  await put("creditTransactions", creditTx);
  
  const { getCreditBalanceRecord } = await import("../credits");
  const balance = await getCreditBalanceRecord(params.userId);
  balance.balance += swarmCredits;
  balance.totalEarned += swarmCredits;
  balance.lastUpdated = new Date().toISOString();
  await put("creditBalances", balance);

  // Create blockchain transaction
  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "token_burn",
    from: params.userId,
    to: "swarm-protocol",
    amount: params.amount,
    tokenId: params.tokenId,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: params.userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      conversion: true,
      profileToken: params.ticker,
      swarmCreditsAwarded: swarmCredits,
      conversionRate: CONVERSION_RATE,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  console.log(`[Token Conversion] Converted ${params.amount} ${params.ticker} → ${swarmCredits} SWARM for ${params.userId}`);

  return transaction;
}

export function getConversionRate(): number {
  return CONVERSION_RATE;
}

export function calculateSwarmCredits(profileTokenAmount: number): number {
  return Math.floor(profileTokenAmount / CONVERSION_RATE);
}
