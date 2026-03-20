/**
 * Coin Deployment System
 * ──────────────────────
 * Users can deploy their own coin (sub-chain) on the SWARM network.
 * Cost: 10,000 SWARM → sent to the community pool.
 * The coin auto-bridges to SWARM via cross-chain mechanics.
 */

import type { DeployedCoin, SwarmTransaction } from "./types";
import { COIN_DEPLOY_COST } from "./types";
import { getSwarmChain } from "./chain";
import { getSwarmBalance, burnSwarm } from "./token";
import { generateTransactionId, generateTokenId } from "./crypto";
import { get, put, getAll } from "../store";

const COIN_STORE = "deployedCoins";

// ── Deploy a new Coin ──────────────────────────────────────────────────

export async function deployCoin(params: {
  userId: string;
  chainName: string;
  ticker: string;
  projectGoal: string;
  maxSupply?: number;
}): Promise<{ coin: DeployedCoin; transaction: SwarmTransaction }> {
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
  const balance = await getSwarmBalance(params.userId);
  if (balance < COIN_DEPLOY_COST) {
    throw new Error(
      `Insufficient SWARM. Need ${COIN_DEPLOY_COST.toLocaleString()} SWARM to deploy a coin. You have ${balance.toFixed(2)}.`
    );
  }

  // Check if ticker is already taken
  const existing = await getAllCoins();
  if (existing.some(c => c.ticker === params.ticker && c.status === "active")) {
    throw new Error(`Ticker ${params.ticker} is already in use`);
  }

  // Burn SWARM from deployer (funds go to pool)
  await burnSwarm({
    from: params.userId,
    amount: COIN_DEPLOY_COST,
    reason: `Coin deployment: ${params.chainName} (${params.ticker})`,
  });

  // Add burned amount to community pool
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

  pool.balance += COIN_DEPLOY_COST;
  pool.totalContributed += COIN_DEPLOY_COST;
  pool.contributors[params.userId] = (pool.contributors[params.userId] || 0) + COIN_DEPLOY_COST;
  pool.lastUpdated = new Date().toISOString();
  await saveRewardPool(pool);

  // Create the coin record
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
  };

  await put(COIN_STORE, { ...coin, id: coinId });

  // Record on blockchain
  const transaction: SwarmTransaction = {
    id: txId,
    type: "coin_deploy",
    from: params.userId,
    to: "swarm-network",
    amount: COIN_DEPLOY_COST,
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

  console.log(`[CoinDeploy] 🪙 ${params.chainName} (${params.ticker}) deployed by ${params.userId} for ${COIN_DEPLOY_COST} SWARM`);

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
