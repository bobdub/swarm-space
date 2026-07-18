// Creator Vault — Profile User Markets economy.
// Splits every purchase 40/40/15/5, enforces the Buyback Ladder,
// and lets the creator withdraw earnings.
import { get, put, getAll } from "../store";
// `get` is used by getCreatorVault below.
import {
  CreatorVault,
  SwarmTransaction,
  CREATOR_VAULT_BUYBACK_SHARE,
  CREATOR_VAULT_STABILITY_SHARE,
  CREATOR_VAULT_CREATOR_SHARE,
  CREATOR_VAULT_COMMUNITY_SHARE,
  CREATOR_TOKEN_BASE_PRICE,
  CREATOR_TOKEN_PRICE_SLOPE,
  CREATOR_VAULT_HARD_FLOOR,
  CREATOR_BUYBACK_LADDER,
} from "./types";
import { getSwarmChain } from "./chain";
import { generateTransactionId } from "./crypto";
import { getProfileToken } from "./storage";
import {
  addProfileTokens,
  getProfileTokenHolding,
  saveProfileTokenHolding,
} from "./profileTokenBalance";

const VAULT_STORE = "creatorVaults";

function nowIso() {
  return new Date().toISOString();
}

function round6(n: number) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export async function getCreatorVault(tokenId: string): Promise<CreatorVault | null> {
  return (await get<CreatorVault>(VAULT_STORE, tokenId)) ?? null;
}

export async function saveCreatorVault(vault: CreatorVault): Promise<void> {
  await put(VAULT_STORE, { ...vault, updatedAt: nowIso() });
}

export async function getVaultForUser(userId: string): Promise<CreatorVault | null> {
  const all = await getAll<CreatorVault>(VAULT_STORE);
  return all.find((v) => v.creatorUserId === userId) ?? null;
}

/** Initialize a vault when a Creator Token is deployed. Idempotent. */
export async function ensureCreatorVault(
  tokenId: string,
  creatorUserId: string,
): Promise<CreatorVault> {
  const existing = await getCreatorVault(tokenId);
  if (existing) return existing;
  const vault: CreatorVault = {
    tokenId,
    creatorUserId,
    buybackReserve: 0,
    stabilityFloor: 0,
    creatorEarnings: 0,
    communityContributed: 0,
    totalDeposited: 0,
    lifetimeBuybacks: 0,
    circulatingSupply: 0,
    currentTier: 0,
    updatedAt: nowIso(),
  };
  await saveCreatorVault(vault);
  return vault;
}

// ── Pricing ──────────────────────────────────────────────────────────

/** Instantaneous per-token price given a circulating supply. */
export function priceAtSupply(circulating: number): number {
  return CREATOR_TOKEN_BASE_PRICE + CREATOR_TOKEN_PRICE_SLOPE * Math.max(0, circulating);
}

/** Integrated buy cost for `n` tokens starting at supply `s0`. Closed form. */
export function integratedBuyCost(s0: number, n: number): number {
  if (n <= 0) return 0;
  // ∫[s0..s0+n] (base + slope*x) dx
  const a = CREATOR_TOKEN_BASE_PRICE;
  const k = CREATOR_TOKEN_PRICE_SLOPE;
  return round6(a * n + k * (n * s0 + (n * n) / 2));
}

/** Preview cost/price for a buy without side effects. */
export function quoteBuy(vault: CreatorVault | null, tokens: number) {
  const s0 = vault?.circulatingSupply ?? 0;
  const cost = integratedBuyCost(s0, tokens);
  const perToken = tokens > 0 ? cost / tokens : priceAtSupply(s0);
  return { cost, perToken, newSupply: s0 + tokens };
}

// ── Ladder ───────────────────────────────────────────────────────────

export function computeTier(vault: CreatorVault): number {
  if (vault.totalDeposited <= 0) return 0;
  const ratio = vault.buybackReserve / vault.totalDeposited;
  let tier = 0;
  for (const step of CREATOR_BUYBACK_LADDER) {
    if (ratio >= step.threshold) tier = step.tier;
  }
  return tier;
}

function tierUnlockShare(tier: number): number {
  const step = CREATOR_BUYBACK_LADDER.find((s) => s.tier === tier);
  return step?.unlockShare ?? 0;
}

/** Preview sell-back proceeds for `tokens`. */
export function quoteSell(vault: CreatorVault | null, tokens: number) {
  if (!vault || tokens <= 0) return { proceeds: 0, tier: 0, capped: false };
  const tier = computeTier(vault);
  if (tier === 0) return { proceeds: 0, tier, capped: true };
  const bondingPerToken = priceAtSupply(Math.max(0, vault.circulatingSupply - tokens));
  const bondingProceeds = bondingPerToken * tokens;
  const unlocked = vault.buybackReserve * tierUnlockShare(tier);
  const floor = vault.totalDeposited * CREATOR_VAULT_HARD_FLOOR;
  const spendable = Math.max(0, Math.min(unlocked, vault.buybackReserve - floor));
  const proceeds = round6(Math.min(bondingProceeds, spendable));
  return { proceeds, tier, capped: proceeds < bondingProceeds };
}

// ── Buy / Sell ───────────────────────────────────────────────────────

function recordVaultTx(
  type: SwarmTransaction["type"],
  from: string,
  to: string,
  amount: number,
  meta: Record<string, unknown>,
) {
  const chain = getSwarmChain();
  chain.addTransaction({
    id: generateTransactionId(),
    type,
    from,
    to,
    amount,
    timestamp: nowIso(),
    signature: "",
    publicKey: from,
    nonce: Date.now(),
    fee: 0,
    meta,
  });
}

/** Buy tokens from a creator's market. Deducts SWARM, mints tokens, splits deposit. */
export async function buyCreatorTokens(params: {
  buyerId: string;
  tokenId: string;
  tokens: number;
}): Promise<{ vault: CreatorVault; cost: number }> {
  const { buyerId, tokenId, tokens } = params;
  if (tokens <= 0 || !Number.isFinite(tokens)) {
    throw new Error("Token amount must be positive");
  }
  // profileTokens store is keyed by userId, so scan by tokenId.
  const allTokens = await getAll<{ tokenId: string; userId: string; ticker: string; name: string }>(
    "profileTokens",
  );
  const record = allTokens.find((t) => t.tokenId === tokenId);
  if (!record) throw new Error("Creator Token not found");

  const creatorId = record.userId;
  const vault = await ensureCreatorVault(tokenId, creatorId);

  const cost = integratedBuyCost(vault.circulatingSupply, tokens);

  // Debit buyer SWARM
  const { getSwarmBalance, burnSwarm } = await import("./token");
  const balance = await getSwarmBalance(buyerId);
  if (balance < cost) {
    throw new Error(
      `Insufficient SWARM. Need ${cost.toFixed(4)} SWARM, have ${balance.toFixed(4)}.`,
    );
  }
  await burnSwarm({ from: buyerId, amount: cost, reason: `Buy ${tokens} ${record.ticker}` });

  // Split deposit 40/40/15/5
  const buyback = round6(cost * CREATOR_VAULT_BUYBACK_SHARE);
  const stability = round6(cost * CREATOR_VAULT_STABILITY_SHARE);
  const creator = round6(cost * CREATOR_VAULT_CREATOR_SHARE);
  const community = round6(cost - buyback - stability - creator); // absorbs FP drift

  vault.buybackReserve = round6(vault.buybackReserve + buyback);
  vault.stabilityFloor = round6(vault.stabilityFloor + stability);
  vault.creatorEarnings = round6(vault.creatorEarnings + creator);
  vault.communityContributed = round6(vault.communityContributed + community);
  vault.totalDeposited = round6(vault.totalDeposited + cost);
  vault.circulatingSupply = round6(vault.circulatingSupply + tokens);
  vault.currentTier = computeTier(vault);
  await saveCreatorVault(vault);

  // Forward community share to the SWARM community pool
  if (community > 0) {
    try {
      const { getRewardPool, saveRewardPool } = await import("./storage");
      let pool = await getRewardPool();
      if (!pool) {
        pool = {
          id: "global",
          balance: 0,
          totalContributed: 0,
          lastUpdated: nowIso(),
          contributors: {},
        };
      }
      if (!pool.contributors) pool.contributors = {};
      pool.balance = round6(pool.balance + community);
      pool.totalContributed = round6(pool.totalContributed + community);
      pool.contributors[buyerId] = round6((pool.contributors[buyerId] || 0) + community);
      pool.lastUpdated = nowIso();
      await saveRewardPool(pool);
    } catch (err) {
      console.warn("[CreatorVault] Community pool update failed:", err);
    }
  }

  // Credit buyer's Creator Token holdings
  await addProfileTokens({
    userId: buyerId,
    tokenId,
    ticker: record.ticker,
    creatorUserId: creatorId,
    amount: tokens,
  });

  recordVaultTx("creator_token_buy", buyerId, creatorId, cost, {
    tokenId,
    ticker: record.ticker,
    tokens,
    split: { buyback, stability, creator, community },
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("creator-vault-update", { detail: { tokenId } }));
  }

  return { vault, cost };
}

/** Sell tokens back to the vault. Uses only the Buyback Reserve within the active tier. */
export async function sellCreatorTokens(params: {
  sellerId: string;
  tokenId: string;
  tokens: number;
}): Promise<{ vault: CreatorVault; proceeds: number }> {
  const { sellerId, tokenId, tokens } = params;
  if (tokens <= 0) throw new Error("Token amount must be positive");

  const vault = await getCreatorVault(tokenId);
  if (!vault) throw new Error("Vault not initialized");

  const holding = await getProfileTokenHolding(sellerId, tokenId);
  if (!holding || holding.amount < tokens) {
    throw new Error("Insufficient tokens to sell");
  }

  const { proceeds, tier } = quoteSell(vault, tokens);
  if (tier === 0 || proceeds <= 0) {
    throw new Error("Buyback tier is inactive — no buyback available right now");
  }

  // Deduct from reserve, respect hard floor
  const floor = vault.totalDeposited * CREATOR_VAULT_HARD_FLOOR;
  if (vault.buybackReserve - proceeds < floor) {
    throw new Error("Buyback would breach reserve floor");
  }

  vault.buybackReserve = round6(vault.buybackReserve - proceeds);
  vault.lifetimeBuybacks = round6(vault.lifetimeBuybacks + proceeds);
  vault.circulatingSupply = round6(Math.max(0, vault.circulatingSupply - tokens));
  vault.currentTier = computeTier(vault);
  await saveCreatorVault(vault);

  // Burn tokens from seller
  holding.amount = round6(holding.amount - tokens);
  holding.lastUpdated = nowIso();
  await saveProfileTokenHolding(holding);

  // Credit SWARM to seller
  const { mintSwarm } = await import("./token");
  await mintSwarm({ to: sellerId, amount: proceeds, reason: `Buyback ${tokens} ${holding.ticker}` });

  recordVaultTx("creator_token_sell", vault.creatorUserId, sellerId, proceeds, {
    tokenId,
    ticker: holding.ticker,
    tokens,
    tier,
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("creator-vault-update", { detail: { tokenId } }));
  }

  return { vault, proceeds };
}

/** Creator withdraws accumulated earnings to their SWARM wallet. */
export async function withdrawCreatorEarnings(params: {
  creatorId: string;
  tokenId: string;
  amount: number;
}): Promise<CreatorVault> {
  const { creatorId, tokenId, amount } = params;
  const vault = await getCreatorVault(tokenId);
  if (!vault) throw new Error("Vault not initialized");
  if (vault.creatorUserId !== creatorId) throw new Error("Only the creator can withdraw");
  if (amount <= 0) throw new Error("Amount must be positive");
  if (amount > vault.creatorEarnings) throw new Error("Insufficient earnings");

  vault.creatorEarnings = round6(vault.creatorEarnings - amount);
  await saveCreatorVault(vault);

  const { mintSwarm } = await import("./token");
  await mintSwarm({ to: creatorId, amount, reason: `Creator earnings withdraw (${tokenId})` });

  recordVaultTx("creator_token_earnings_withdraw", creatorId, creatorId, amount, { tokenId });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("creator-vault-update", { detail: { tokenId } }));
  }

  return vault;
}

export function ladderState(vault: CreatorVault | null) {
  const ratio = vault && vault.totalDeposited > 0
    ? vault.buybackReserve / vault.totalDeposited
    : 0;
  const active = vault ? computeTier(vault) : 0;
  return { ratio, active, tiers: CREATOR_BUYBACK_LADDER };
}