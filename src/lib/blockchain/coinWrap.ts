/**
 * Literal Wrap Engine
 * ───────────────────
 * Coins are ONLY mined — never minted.
 * Tokens are ONLY minted — never mined.
 * Wrapping = embedding minted token metadata inside a mined SWARM coin.
 *
 * Rules:
 *   1. Must pass mineHealth (graveyard throttle — must be actively mining)
 *   2. Pool must hold requestedSwarmAmount + 1 coins (the +1 is the wrapper)
 *   3. The system shuffles pool coins and picks one with capacity
 *   4. Already-checked coins are tagged so the shuffle never re-tests them
 *   5. If no coin has capacity → error (all full)
 *   6. Users may receive coins with wrapped tokens as payment
 *   7. Users can extract tokens from coins they own → tokens go to SWARM chain,
 *      empty coin returns to pool
 *   8. The 5% mining tax mints empty coins into the pool (graveyard throttle)
 */

import { getAll, put } from "../store";
import { validateMineHealth } from "./mineHealthValidator";
import { getUserProfileTokenHoldings, saveProfileTokenHolding } from "./profileTokenBalance";
import { generateTransactionId } from "./crypto";
import { getSwarmChain } from "./chain";
import type { SwarmCoin, WrappedTokenPayload, SwarmTransaction } from "./types";
import {
  TOKEN_TO_SWARM_RATIO,
  POOL_SURPLUS_REQUIREMENT,
  COIN_MAX_WEIGHT,
  TOKEN_WEIGHT_UNIT,
  WRAP_METADATA_OVERHEAD,
} from "./types";

// ── Helpers ────────────────────────────────────────────────────────────

/** Fisher-Yates shuffle (in-place) */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function getPoolCoins(): Promise<SwarmCoin[]> {
  const all = await getAll<SwarmCoin>("swarmCoins");
  return all.filter((c) => c.status === "pool");
}

async function saveCoin(coin: SwarmCoin): Promise<void> {
  await put("swarmCoins", coin);
}

// ── Core: Wrap Tokens Into a Mined Coin ────────────────────────────────

/**
 * Wraps minted tokens inside a mined SWARM coin.
 *
 * @param userId  — the user performing the swap
 * @param tokenId — the Creator Token ID
 * @param ticker  — token ticker
 * @param amount  — number of tokens to wrap (must be multiple of 10)
 * @returns the recorded SwarmTransaction
 */
export async function wrapTokensIntoCoin(
  userId: string,
  tokenId: string,
  ticker: string,
  amount: number
): Promise<SwarmTransaction> {
  if (amount <= 0) throw new Error("Amount must be positive");
  if (amount % TOKEN_TO_SWARM_RATIO !== 0) {
    throw new Error(`Amount must be a multiple of ${TOKEN_TO_SWARM_RATIO} (10 tokens = 1 SWARM coin)`);
  }

  // ── 1. Graveyard Throttle: must be actively mining ───────────────────
  const health = await validateMineHealth(userId);
  if (!health.healthy) {
    throw new Error(`MineHealth check failed: ${health.reason}`);
  }

  // ── 2. Verify token holdings ─────────────────────────────────────────
  const holdings = await getUserProfileTokenHoldings(userId);
  const holding = holdings.find((h) => h.tokenId === tokenId);
  if (!holding || holding.amount < amount) {
    throw new Error(
      `Insufficient ${ticker} tokens. Have: ${holding?.amount || 0}, Need: ${amount}`
    );
  }

  const swarmAmount = amount / TOKEN_TO_SWARM_RATIO;
  const requiredPoolCoins = swarmAmount + POOL_SURPLUS_REQUIREMENT;

  // ── 3. Pool surplus check ────────────────────────────────────────────
  const poolCoins = await getPoolCoins();
  if (poolCoins.length < requiredPoolCoins) {
    throw new Error(
      `Community pool needs ${requiredPoolCoins} coins (${swarmAmount} + ${POOL_SURPLUS_REQUIREMENT} wrapper). ` +
      `Pool has: ${poolCoins.length} coins`
    );
  }

  // ── 4. Calculate payload weight ──────────────────────────────────────
  const payloadWeight = amount * TOKEN_WEIGHT_UNIT + WRAP_METADATA_OVERHEAD;

  // ── 5. Shuffle & find a coin with capacity ───────────────────────────
  const candidates = shuffle([...poolCoins]);
  let selectedCoin: SwarmCoin | null = null;

  for (const coin of candidates) {
    const remaining = coin.maxWeight - coin.weight;
    if (remaining >= payloadWeight) {
      selectedCoin = coin;
      break;
    }
    // Tag as checked so subsequent calls skip it
    coin.checkedForWrap = true;
    await saveCoin(coin);
  }

  if (!selectedCoin) {
    // Reset tags for next attempt
    for (const coin of candidates) {
      if (coin.checkedForWrap) {
        coin.checkedForWrap = false;
        await saveCoin(coin);
      }
    }
    throw new Error(
      `No coin in the pool has sufficient capacity for ${payloadWeight} weight. ` +
      `All ${poolCoins.length} coins checked.`
    );
  }

  // Reset checked tags on all candidates
  for (const coin of candidates) {
    if (coin.checkedForWrap) {
      coin.checkedForWrap = false;
      await saveCoin(coin);
    }
  }

  // ── 6. Deduct tokens from holder ─────────────────────────────────────
  holding.amount -= amount;
  holding.lastUpdated = new Date().toISOString();
  await saveProfileTokenHolding(holding);

  // ── 7. Write payload into selected coin ──────────────────────────────
  const payload: WrappedTokenPayload = {
    tokenId,
    ticker,
    amount,
    wrappedAt: new Date().toISOString(),
    wrappedBy: userId,
  };
  selectedCoin.wrappedTokens.push(payload);
  selectedCoin.weight += payloadWeight;
  selectedCoin.status = "wallet";
  selectedCoin.ownerId = userId;
  await saveCoin(selectedCoin);

  // ── 8. Record on chain ───────────────────────────────────────────────
  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "token_wrap",
    from: userId,
    to: "community-pool",
    amount,
    tokenId,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      ticker,
      swarmCoinsUsed: 1,
      coinId: selectedCoin.coinId,
      payloadWeight,
      coinWeightAfter: selectedCoin.weight,
      mineHealthPassed: true,
      mineHealthPeerCount: health.peerCount,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: transaction }));
  }

  console.log(
    `[LiteralWrap] ${amount} ${ticker} wrapped into coin ${selectedCoin.coinId} ` +
    `(weight: ${selectedCoin.weight}/${selectedCoin.maxWeight}) for ${userId}`
  );

  return transaction;
}

// ── Core: Extract Tokens From a Coin ───────────────────────────────────

/**
 * Extracts all wrapped tokens from a coin the user owns.
 * - Tokens are credited back to the user's holdings on the SWARM blockchain
 * - The now-empty coin is returned to the community pool
 */
export async function extractTokensFromCoin(
  userId: string,
  coinId: string
): Promise<SwarmTransaction> {
  const all = await getAll<SwarmCoin>("swarmCoins");
  const coin = all.find((c) => c.coinId === coinId);

  if (!coin) throw new Error(`Coin ${coinId} not found`);
  if (coin.ownerId !== userId) throw new Error("You do not own this coin");
  if (coin.wrappedTokens.length === 0) throw new Error("Coin contains no wrapped tokens");

  // Credit each token batch back to user
  const extractedPayloads = [...coin.wrappedTokens];
  let totalExtracted = 0;

  for (const payload of extractedPayloads) {
    const holdings = await getUserProfileTokenHoldings(userId);
    let holding = holdings.find((h) => h.tokenId === payload.tokenId);

    if (!holding) {
      // Create a new holding record
      holding = {
        id: `${userId}-${payload.tokenId}`,
        userId,
        tokenId: payload.tokenId,
        ticker: payload.ticker,
        amount: 0,
        lastUpdated: new Date().toISOString(),
      } as any;
    }

    (holding as any).amount += payload.amount;
    (holding as any).lastUpdated = new Date().toISOString();
    await saveProfileTokenHolding(holding as any);
    totalExtracted += payload.amount;
  }

  // Reset the coin and return to pool
  coin.wrappedTokens = [];
  coin.weight = 0;
  coin.status = "pool";
  coin.ownerId = "community-pool";
  coin.checkedForWrap = false;
  await saveCoin(coin);

  // Record on chain
  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "token_extract",
    from: "community-pool",
    to: userId,
    amount: totalExtracted,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      coinId,
      extractedPayloads: extractedPayloads.map((p) => ({
        tokenId: p.tokenId,
        ticker: p.ticker,
        amount: p.amount,
      })),
      coinReturnedToPool: true,
    },
  };

  const chain = getSwarmChain();
  chain.addTransaction(transaction);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: transaction }));
  }

  console.log(
    `[LiteralWrap] Extracted ${totalExtracted} tokens from coin ${coinId}. ` +
    `Empty coin returned to pool. User: ${userId}`
  );

  return transaction;
}

// ── Query Helpers ──────────────────────────────────────────────────────

export async function getCoinWeight(coinId: string): Promise<{ weight: number; maxWeight: number } | null> {
  const all = await getAll<SwarmCoin>("swarmCoins");
  const coin = all.find((c) => c.coinId === coinId);
  return coin ? { weight: coin.weight, maxWeight: coin.maxWeight } : null;
}

export async function getWrappedContents(coinId: string): Promise<WrappedTokenPayload[]> {
  const all = await getAll<SwarmCoin>("swarmCoins");
  const coin = all.find((c) => c.coinId === coinId);
  return coin?.wrappedTokens || [];
}

export async function getUserWalletCoins(userId: string): Promise<SwarmCoin[]> {
  const all = await getAll<SwarmCoin>("swarmCoins");
  return all.filter((c) => c.ownerId === userId && c.status === "wallet");
}

// ── Graveyard Throttle: Mint Empty Coin Into Pool ──────────────────────

/**
 * Called by mining rewards to seed an empty coin into the community pool.
 * This is the "graveyard throttle" — the 5% mining tax always creates
 * an empty coin, guaranteeing the pool never runs out of wrappers.
 */
export function createEmptyPoolCoin(minedInBlock?: number): SwarmCoin {
  return {
    coinId: `swarm-coin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    weight: 0,
    maxWeight: COIN_MAX_WEIGHT,
    wrappedTokens: [],
    ownerId: "community-pool",
    status: "pool",
    checkedForWrap: false,
    minedAt: new Date().toISOString(),
    minedInBlock,
  };
}
