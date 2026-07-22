/**
 * Deploy Pricing — dynamic prices tied to the community pool.
 *
 * Baseline (pool = 100 SWARM):
 *   • Creator Token: 25 credits + 5 SWARM
 *   • Coin (sub-chain): 10 000 SWARM
 *
 * As the pool grows, prices scale linearly. Existing tokens are grandfathered
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

/** Baseline anchor — the pool balance at which cached constants apply. */
const BASELINE_POOL = 100;
/** Baseline anchor for coin deploys (single-multiplier growth). */
const COIN_BASELINE_POOL = 10_000;
const CREATOR_BASE_CREDITS = 25;
const CREATOR_BASE_SWARM = 5;

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

  // Baseline creator token = 25 credits + 5 SWARM at pool ≥ 100 SWARM.
  const creatorTokenCredits = scale(
    Math.min(CREATOR_TOKEN_DEPLOY_COST, CREATOR_BASE_CREDITS),
    poolBalance,
    BASELINE_POOL,
  );
  const creatorTokenSwarm = scale(
    Math.min(CREATOR_TOKEN_SWARM_DEPLOY_COST, CREATOR_BASE_SWARM),
    poolBalance,
    BASELINE_POOL,
  );

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
