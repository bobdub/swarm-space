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
 * Convert creator tokens to SWARM coins (10:1 ratio)
 *
 * Requirements:
 *   - Amount must be a multiple of TOKEN_TO_SWARM_RATIO (10)
 *   - Community pool must hold swarmAmount + 1 (surplus requirement)
 *   - MineHealth validation must pass
 *   - The extra 1 SWARM "wraps" the tokens and is returned to pool
 */
export async function convertTokensToSwarm(params: {
  userId: string;
  tokenId: string;
  ticker: string;
  amount: number;
}): Promise<SwarmTransaction> {
  if (params.amount <= 0) {
    throw new Error("Amount must be positive");
  }

  if (params.amount % TOKEN_TO_SWARM_RATIO !== 0) {
    throw new Error(`Amount must be a multiple of ${TOKEN_TO_SWARM_RATIO} (10 tokens = 1 SWARM)`);
  }

  // ── MineHealth Gate ──────────────────────────────────────────────────
  const health = await validateMineHealth(params.userId);
  if (!health.healthy) {
    throw new Error(`MineHealth check failed: ${health.reason}`);
  }

  // Check token holdings
  const holdings = await getUserProfileTokenHoldings(params.userId);
  const holding = holdings.find(h => h.tokenId === params.tokenId);

  if (!holding || holding.amount < params.amount) {
    throw new Error(`Insufficient ${params.ticker} tokens. Have: ${holding?.amount || 0}, Need: ${params.amount}`);
  }

  const swarmAmount = params.amount / TOKEN_TO_SWARM_RATIO;
  const poolRequired = swarmAmount + POOL_SURPLUS_REQUIREMENT;

  // ── Pool Surplus Check ───────────────────────────────────────────────
  const { getRewardPool, saveRewardPool } = await import("./storage");
  const pool = await getRewardPool();
  if (!pool || pool.balance < poolRequired) {
    throw new Error(
      `Community pool needs ${poolRequired} SWARM (${swarmAmount} + ${POOL_SURPLUS_REQUIREMENT} wrapper). ` +
      `Pool has: ${pool?.balance?.toFixed(2) || 0} SWARM`
    );
  }

  // ── Execute Swap ─────────────────────────────────────────────────────

  // 1. Deduct tokens from holder
  holding.amount -= params.amount;
  holding.lastUpdated = new Date().toISOString();
  await saveProfileTokenHolding(holding);

  // 2. Deduct swarmAmount from pool (the wrapper SWARM goes back to pool)
  pool.balance -= swarmAmount;
  // The +1 wrapper SWARM stays in the pool (it "wraps" the tokens then returns)
  pool.lastUpdated = new Date().toISOString();
  await saveRewardPool(pool);

  // 3. Mint SWARM to user
  const { mintSwarm } = await import("./token");
  await mintSwarm({
    to: params.userId,
    amount: swarmAmount,
    reason: `Token→SWARM swap: ${params.amount} ${params.ticker} → ${swarmAmount} SWARM`,
  });

  // Record on chain
  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "cross_chain_swap",
    from: params.userId,
    to: "community-pool",
    amount: params.amount,
    tokenId: params.tokenId,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: params.userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      conversion: true,
      target: "swarm" as ConversionTarget,
      profileToken: params.ticker,
      swarmAwarded: swarmAmount,
      conversionRate: TOKEN_TO_SWARM_RATIO,
      poolSurplusRequired: POOL_SURPLUS_REQUIREMENT,
      mineHealthPassed: true,
      mineHealthPeerCount: health.peerCount,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("reward-pool-update", { detail: pool }));
    window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: transaction }));
  }

  console.log(
    `[Token→SWARM] ${params.amount} ${params.ticker} → ${swarmAmount} SWARM for ${params.userId} ` +
    `(pool: ${pool.balance.toFixed(2)}, wrapper returned)`
  );

  return transaction;
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
