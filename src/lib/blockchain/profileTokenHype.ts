// Profile Token Hype System - Use profile tokens to hype posts
import { getUserProfileTokenHoldings, saveProfileTokenHolding } from "./profileTokenBalance";
import { generateTransactionId } from "./crypto";
import { getSwarmChain } from "./chain";
import type { SwarmTransaction } from "./types";

const HYPE_RATE = 10; // 10 profile tokens = 1 credit worth of hype

export async function hypePostWithProfileTokens(params: {
  userId: string;
  postId: string;
  postAuthor: string;
  tokenId: string;
  ticker: string;
  amount: number;
}): Promise<SwarmTransaction> {
  if (params.amount <= 0) {
    throw new Error("Amount must be positive");
  }

  if (params.amount % HYPE_RATE !== 0) {
    throw new Error(`Amount must be a multiple of ${HYPE_RATE}`);
  }

  // Get user's holding of this token
  const holdings = await getUserProfileTokenHoldings(params.userId);
  const holding = holdings.find(h => h.tokenId === params.tokenId);

  if (!holding || holding.amount < params.amount) {
    throw new Error(`Insufficient ${params.ticker} tokens. Have: ${holding?.amount || 0}, Need: ${params.amount}`);
  }

  // Calculate hype credits
  const hypeCredits = params.amount / HYPE_RATE;

  // Deduct profile tokens from user
  holding.amount -= params.amount;
  holding.lastUpdated = new Date().toISOString();
  await saveProfileTokenHolding(holding);

  // Award credits to post author
  const { put } = await import("../store");
  const creditTx: any = {
    id: crypto.randomUUID(),
    fromUserId: params.userId,
    toUserId: params.postAuthor,
    amount: hypeCredits,
    type: "earned_post",
    createdAt: new Date().toISOString(),
    meta: { description: `Hype using ${params.ticker}`, postId: params.postId }
  };
  await put("creditTransactions", creditTx);
  
  const { getCreditBalanceRecord } = await import("../credits");
  const balance = await getCreditBalanceRecord(params.postAuthor);
  balance.balance += hypeCredits;
  balance.totalEarned += hypeCredits;
  balance.lastUpdated = new Date().toISOString();
  await put("creditBalances", balance);

  // Create blockchain transaction
  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "token_burn",
    from: params.userId,
    to: params.postAuthor,
    amount: params.amount,
    tokenId: params.tokenId,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: params.userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      hype: true,
      postId: params.postId,
      profileToken: params.ticker,
      creditsAwarded: hypeCredits,
      hypeRate: HYPE_RATE,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  console.log(`[Token Hype] ${params.userId} hyped post ${params.postId} with ${params.amount} ${params.ticker} (${hypeCredits} credits to author)`);

  return transaction;
}

export function getHypeRate(): number {
  return HYPE_RATE;
}

export function calculateHypeCredits(profileTokenAmount: number): number {
  return Math.floor(profileTokenAmount / HYPE_RATE);
}
