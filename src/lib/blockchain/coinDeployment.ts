/**
 * Coin Deployment System
 * ──────────────────────
 * Each account can deploy one coin (sub-chain) on the SWARM network.
 * Cost: 10,000 SWARM total:
 *   - 5,000 SWARM locked as liquidity (gives the coin intrinsic floor value)
 *   - 5,000 SWARM sent to the community pool
 * The coin auto-bridges to SWARM via cross-chain mechanics.
 * All deployments must pass mineHealth validation.
 */

import type { DeployedCoin, SwarmTransaction } from "./types";
import { getSwarmChain } from "./chain";
import { getSwarmBalance, burnSwarm } from "./token";
import { generateTransactionId, generateTokenId } from "./crypto";
import { get, put, getAll } from "../store";
import { validateMineHealth } from "./mineHealthValidator";

const COIN_STORE = "deployedCoins";

// ── Deploy a new Coin ──────────────────────────────────────────────────

type DeployParams = {
  userId: string;
  chainName: string;
  ticker: string;
  projectGoal: string;
  maxSupply?: number;
};
type DeployResult = { coin: DeployedCoin; transaction: SwarmTransaction };

const deploying = new Map<string, Promise<unknown>>();

/**
 * Deploy the account's one coin. Check-through-persist runs under an
 * account-scoped lock (cross-tab via Web Locks when available), so two
 * tabs can't both see "no chain yet" and both charge.
 */
export function deployCoin(params: DeployParams): Promise<DeployResult> {
  const task = () => deployCoinNow(params);
  const previous = deploying.get(params.userId) ?? Promise.resolve();
  const work = previous.catch(() => undefined).then(() =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(`coin-deploy:${params.userId}`, task)
      : task(),
  );
  deploying.set(params.userId, work);
  void work.finally(() => { if (deploying.get(params.userId) === work) deploying.delete(params.userId); }).catch(() => undefined);
  return work;
}

async function deployCoinNow(params: DeployParams): Promise<DeployResult> {
  // ── MineHealth Gate ──────────────────────────────────────────────────
  const health = await validateMineHealth(params.userId);
  if (!health.healthy) {
    throw new Error(`MineHealth check failed: ${health.reason}`);
  }

  // One chain per account: a deployer mines and shares the chain they have.
  if ((await getUserCoins(params.userId)).length > 0) {
    throw new Error("You already have a chain. Each account can deploy one coin.");
  }

  // Validate ticker
  if (!/^[A-Z]{3,6}$/.test(params.ticker)) {
    throw new Error("Ticker must be 3-6 uppercase letters");
  }

  if (params.ticker === "SWARM") {
    throw new Error("Cannot use reserved ticker SWARM");
  }

  if (!params.chainName.trim() || params.chainName.length > 32) {
    throw new Error("Chain name must be 1-32 characters");
  }

  if (!params.projectGoal.trim() || params.projectGoal.length < 10) {
    throw new Error("Project goal must be at least 10 characters");
  }

  // Check SWARM balance
  const { getDeployPricing } = await import("./deployPricing");
  const pricing = await getDeployPricing();
  const balance = await getSwarmBalance(params.userId);
  if (balance < pricing.coinDeploySwarm) {
    throw new Error(
      `Insufficient SWARM. Need ${pricing.coinDeploySwarm.toLocaleString()} SWARM to deploy a coin. You have ${balance.toFixed(2)}.`
    );
  }

  // Check if ticker is already taken
  const existing = await getAllCoins();
  if (existing.some(c => c.ticker === params.ticker && c.status === "active")) {
    throw new Error(`Ticker ${params.ticker} is already in use`);
  }

  // ── Split: 50% liquidity lock + 50% to pool ─────────────────────────
  // Burn full amount from deployer
  await burnSwarm({
    from: params.userId,
    amount: pricing.coinDeploySwarm,
    reason: `Coin deployment: ${params.chainName} (${params.ticker})`,
  });

  // Add ONLY the pool portion to community pool (liquidity stays locked on-coin)
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

  pool.balance += pricing.coinPoolContribution;
  pool.totalContributed += pricing.coinPoolContribution;
  pool.contributors[params.userId] = (pool.contributors[params.userId] || 0) + pricing.coinPoolContribution;
  pool.lastUpdated = new Date().toISOString();
  await saveRewardPool(pool);

  // Create the coin record with locked liquidity
  const coinId = generateTokenId();
  const txId = generateTransactionId();

  const coin: DeployedCoin = {
    coinId,
    deployerUserId: params.userId,
    chainName: params.chainName,
    ticker: params.ticker,
    projectGoal: params.projectGoal,
    totalSupply: 0,
    maxSupply: params.maxSupply || 21_000_000,
    deployedAt: new Date().toISOString(),
    deploymentTxId: txId,
    status: "active",
    bridgeAddress: `swarm-bridge://${coinId}`,
    lockedLiquidity: pricing.coinLiquidityLock,
  };

  await put(COIN_STORE, { ...coin, id: coinId });

  // Record on blockchain
  const transaction: SwarmTransaction = {
    id: txId,
    type: "coin_deploy",
    from: params.userId,
    to: "swarm-network",
    amount: pricing.coinDeploySwarm,
    tokenId: coinId,
    timestamp: new Date().toISOString(),
    signature: `sig-${Date.now()}`,
    publicKey: params.userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      chainName: params.chainName,
      ticker: params.ticker,
      projectGoal: params.projectGoal,
      maxSupply: coin.maxSupply,
      bridgeAddress: coin.bridgeAddress,
      liquidityLocked: pricing.coinLiquidityLock,
      poolContribution: pricing.coinPoolContribution,
      pricing,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  // Broadcast events
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: transaction }));
    window.dispatchEvent(new CustomEvent("reward-pool-update", { detail: pool }));
    window.dispatchEvent(new CustomEvent("coin-deployed", { detail: coin }));
  }

  // Sign the coin's own chain genesis now, so "Start Mining my coin" is ready.
  void import("./coinChainMining")
    .then((m) => m.ensureOwnedCoinChain(coin))
    .catch(() => { /* vault locked: signed when mining starts */ });

  console.log(
    `[CoinDeploy] 🪙 ${params.chainName} (${params.ticker}) deployed by ${params.userId} — ` +
    `${pricing.coinLiquidityLock} SWARM locked as liquidity, ${pricing.coinPoolContribution} SWARM to pool`
  );

  return { coin, transaction };
}

// ── Query ──────────────────────────────────────────────────────────────

export async function getCoin(coinId: string): Promise<DeployedCoin | null> {
  return get<DeployedCoin>(COIN_STORE, coinId);
}

export async function getAllCoins(): Promise<DeployedCoin[]> {
  return getAll<DeployedCoin>(COIN_STORE);
}

export async function getUserCoins(userId: string): Promise<DeployedCoin[]> {
  const all = await getAllCoins();
  return all.filter(c => c.deployerUserId === userId);
}

export async function getActiveCoins(): Promise<DeployedCoin[]> {
  const all = await getAllCoins();
  return all.filter(c => c.status === "active");
}
