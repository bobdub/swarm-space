/**
 * Deploy Pricing — fixed Creator launch alternatives; pool-scaled sub-chains.
 *
 * Baseline (pool = 100 SWARM):
 *   • Creator Token: 10,000 Credits OR 100 SWARM
 *   • Coin (sub-chain): 10 000 SWARM
 *
 * Sub-chain prices scale with the pool. Existing tokens are grandfathered
 * by callers that skip the fee when a token/vault already exists.
 */
import { derivePoolFromChain, getRewardPool } from "./storage";
import {
  CREATOR_TOKEN_DEPLOY_COST,
  CREATOR_TOKEN_SWARM_DEPLOY_COST,
  COIN_DEPLOY_COST,
} from "./types";

export interface DeployPricing {
  poolBalance: number;
  creatorTokenCredits: number;
  creatorTokenSwarm: number;
  coinDeploySwarm: number;
  coinLiquidityLock: number;
  coinPoolContribution: number;
}

/** Baseline anchor for coin deploys (single-multiplier growth). */
const COIN_BASELINE_POOL = 10_000;

function scale(base: number, pool: number, anchor: number): number {
  const mult = Math.max(1, pool / anchor);
  return Math.round(base * mult);
}

export async function getDeployPricing(): Promise<DeployPricing> {
  let poolBalance = 0;
  try {
    const pool = await derivePoolFromChain();
    poolBalance = pool?.balance ?? 0;
  } catch {
    try {
      const pool = await getRewardPool();
      poolBalance = pool?.balance ?? 0;
    } catch {
      poolBalance = 0;
    }
  }

  const creatorTokenSwarm = CREATOR_TOKEN_SWARM_DEPLOY_COST;
  const creatorTokenCredits = await creatorCreditsAtMarket(creatorTokenSwarm);

  const coinDeploySwarm = scale(COIN_DEPLOY_COST, poolBalance, COIN_BASELINE_POOL);
  const coinLiquidityLock = Math.floor(coinDeploySwarm / 2);
  const coinPoolContribution = coinDeploySwarm - coinLiquidityLock;

  return {
    poolBalance,
    creatorTokenCredits,
    creatorTokenSwarm,
    coinDeploySwarm,
    coinLiquidityLock,
    coinPoolContribution,
  };
}

/** Credits for the launch's SWARM at the live Market Vault price (never below 100:1). */
export async function creatorCreditsAtMarket(swarm: number): Promise<number> {
  try {
    const [{ getMarketVaultState }, { quoteVaultBuy }] = await Promise.all([import("./marketVault"), import("./marketVaultPricing")]);
    const quote = quoteVaultBuy(await getMarketVaultState(), swarm, Number.MAX_SAFE_INTEGER);
    return Math.max(CREATOR_TOKEN_DEPLOY_COST, quote.credits);
  } catch {
    return CREATOR_TOKEN_DEPLOY_COST;
  }
}
