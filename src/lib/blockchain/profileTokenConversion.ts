/**
 * Creator Token Conversion System
 * ────────────────────────────────
 * Tokens can be exchanged:
 *   - 1:1 with credits (direct swap)
 *   - 10:1 for SWARM coins (10 tokens = 1 SWARM)
 *
 * Token→SWARM swap rules:
 *   1. Community pool must hold requestedAmount + 1 SWARM
 *   2. Tokens are wrapped inside the extra SWARM coin
 *   3. The wrapping SWARM is returned to the community pool
 *   4. The swap only proceeds if mineHealth validation passes
 */

import { getUserProfileTokenHoldings, saveProfileTokenHolding } from "./profileTokenBalance";
import { generateTransactionId } from "./crypto";
import { getSwarmChain } from "./chain";
import { validateMineHealth } from "./mineHealthValidator";
import type { SwarmTransaction } from "./types";
import { TOKEN_TO_CREDIT_RATIO, TOKEN_TO_SWARM_RATIO, POOL_SURPLUS_REQUIREMENT } from "./types";

type ConversionTarget = "credits" | "swarm";

/**
 * Convert creator tokens to credits (1:1 ratio)
 */
export async function convertTokensToCredits(params: {
  userId: string;
  tokenId: string;
  ticker: string;
  amount: number;
}): Promise<SwarmTransaction> {
  if (params.amount <= 0) {
    throw new Error("Amount must be positive");
  }

  // Get user's holding of this token
  const holdings = await getUserProfileTokenHoldings(params.userId);
  const holding = holdings.find(h => h.tokenId === params.tokenId);

  if (!holding || holding.amount < params.amount) {
    throw new Error(`Insufficient ${params.ticker} tokens. Have: ${holding?.amount || 0}, Need: ${params.amount}`);
  }

  const creditsAwarded = params.amount * TOKEN_TO_CREDIT_RATIO; // 1:1

  // Deduct tokens
  holding.amount -= params.amount;
  holding.lastUpdated = new Date().toISOString();
  await saveProfileTokenHolding(holding);

  // Award credits
  const { put } = await import("../store");
  const creditTx: any = {
    id: crypto.randomUUID(),
    fromUserId: "swarm-protocol",
    toUserId: params.userId,
    amount: creditsAwarded,
    type: "earned_post",
    createdAt: new Date().toISOString(),
    meta: { description: `Converted ${params.amount} ${params.ticker} → ${creditsAwarded} credits (1:1)` }
  };
  await put("creditTransactions", creditTx);

  const { getCreditBalanceRecord } = await import("../credits");
  const balance = await getCreditBalanceRecord(params.userId);
  balance.balance += creditsAwarded;
  balance.totalEarned += creditsAwarded;
  balance.lastUpdated = new Date().toISOString();
  await put("creditBalances", balance);

  // Record on chain
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
      target: "credits" as ConversionTarget,
      profileToken: params.ticker,
      creditsAwarded,
      conversionRate: TOKEN_TO_CREDIT_RATIO,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  console.log(`[Token→Credits] ${params.amount} ${params.ticker} → ${creditsAwarded} credits for ${params.userId}`);
  return transaction;
}

/**
 * Convert creator tokens to SWARM coins (10:1 ratio) via Literal Wrap.
 *
 * Tokens are physically embedded inside a mined SWARM coin — not abstractly
 * burned-and-minted. Coins are ONLY mined; tokens are ONLY minted.
 *
 * Requirements:
 *   - Amount must be a multiple of TOKEN_TO_SWARM_RATIO (10)
 *   - Community pool must hold swarmAmount + 1 coins (surplus requirement)
 *   - MineHealth validation must pass (graveyard throttle)
 *   - The system shuffles pool coins and selects one with capacity
 *   - Checked coins are tagged to avoid re-testing
 */
export async function convertTokensToSwarm(params: {
  userId: string;
  tokenId: string;
  ticker: string;
  amount: number;
}): Promise<SwarmTransaction> {
  // Delegate entirely to the Literal Wrap engine
  const { wrapTokensIntoCoin } = await import("./coinWrap");
  return wrapTokensIntoCoin(params.userId, params.tokenId, params.ticker, params.amount);
}

/**
 * Legacy API — routes to convertTokensToCredits for backward compat.
 * @deprecated Use convertTokensToCredits or convertTokensToSwarm directly.
 */
export async function convertProfileTokensToSwarm(params: {
  userId: string;
  tokenId: string;
  ticker: string;
  amount: number;
}): Promise<SwarmTransaction> {
  return convertTokensToCredits(params);
}

export function getConversionRate(): number {
  return TOKEN_TO_SWARM_RATIO;
}

export function getTokenToCreditRate(): number {
  return TOKEN_TO_CREDIT_RATIO;
}

export function calculateSwarmFromTokens(tokenAmount: number): number {
  return Math.floor(tokenAmount / TOKEN_TO_SWARM_RATIO);
}

export function calculateCreditsFromTokens(tokenAmount: number): number {
  return tokenAmount * TOKEN_TO_CREDIT_RATIO;
}
