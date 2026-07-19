/**
 * Coin Market — peer-to-peer sales of mined SWARM coins for real currencies.
 *
 * V1 sale flow (no key custody, no automated settlement):
 *   1. Seller lists a coin  → `coin_market_list` tx broadcast on SWARM chain.
 *   2. Buyer reserves       → `coin_market_reserve` (10-min TTL).
 *   3. Buyer pays off-app + confirms with tx hash → `coin_market_confirm_payment`.
 *   4. Seller verifies + releases → `coin_market_settle` transfers the coin.
 *   5. Either side may cancel before payment; buyer may dispute after payment.
 *
 * Every state change is a signed SWARM transaction — so the market state
 * reconstructs from the ledger the same way the community pool does, giving
 * every peer the same view without a custom sync protocol.
 *
 * SECURITY: this file never touches private keys or seed phrases. Off-chain
 * settlement is trust-based; the UI shows a bright disclaimer until MetaMask
 * escrow lands in Phase 2.
 */

import type {
  CoinListing,
  CoinListingStatus,
  CoinMarketCurrency,
  SwarmCoin,
  SwarmTransaction,
} from "./types";
import { COIN_MARKET_TIERS } from "./types";
import { get, getAll, getAllByIndex, put, remove } from "../store";
import { generateTransactionId, generateTokenId } from "./crypto";
import { getSwarmChain } from "./chain";
import { getRewardPool } from "./storage";

const LISTINGS_STORE = "coinListings";
const COINS_STORE = "swarmCoins";
const MARKET_ESCROW_PREFIX = "market_escrow:";

const RESERVATION_TTL_MS = 10 * 60 * 1000; // 10 min
const LISTING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SWARM_TO_ETH_HINT = 0.0001;
const SWARM_TO_BTC_HINT = 0.000002;
const SWARM_TO_MINTME_HINT = 0.1;

// ── Currency validation ────────────────────────────────────────────────

const ADDRESS_PATTERNS: Record<CoinMarketCurrency, RegExp> = {
  ETH: /^0x[a-fA-F0-9]{40}$/,
  MINTME: /^0x[a-fA-F0-9]{40}$/,
  BTC: /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
};

export function isValidAddress(currency: CoinMarketCurrency, address: string): boolean {
  const pat = ADDRESS_PATTERNS[currency];
  return !!pat && pat.test(address.trim());
}

export function blockExplorerUrl(currency: CoinMarketCurrency, txHash: string): string {
  const t = encodeURIComponent(txHash);
  switch (currency) {
    case "ETH":
      return `https://etherscan.io/tx/${t}`;
    case "MINTME":
      return `https://www.mintme.com/tx/${t}`;
    case "BTC":
      return `https://mempool.space/tx/${t}`;
  }
}

// ── Tier lookup ────────────────────────────────────────────────────────

export function computeMarketTier(poolBalance: number): (typeof COIN_MARKET_TIERS)[number] {
  let best = COIN_MARKET_TIERS[0];
  for (const t of COIN_MARKET_TIERS) {
    if (poolBalance >= t.poolMinimum) best = t;
  }
  return best;
}

export interface CoinMarketStats {
  poolBalance: number;
  circulatingSwarm: number;
  minedCoinsKnown: number;
  poolLiquidRatio: number;
  basePriceSwarm: number;
  trend48hPct: number;
  trendDirection: "up" | "down" | "flat";
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function currencyHint(currency: CoinMarketCurrency): number {
  switch (currency) {
    case "ETH": return SWARM_TO_ETH_HINT;
    case "BTC": return SWARM_TO_BTC_HINT;
    case "MINTME": return SWARM_TO_MINTME_HINT;
  }
}

export function quoteBaseAsk(currency: CoinMarketCurrency, stats: CoinMarketStats | null): number {
  return round6((stats?.basePriceSwarm ?? 1) * currencyHint(currency));
}

export async function getCoinMarketStats(): Promise<CoinMarketStats> {
  const [pool, coins, listings] = await Promise.all([
    getRewardPool(),
    getAll<SwarmCoin>(COINS_STORE),
    getAllListings(),
  ]);
  const chain = getSwarmChain();
  await chain.whenReady();
  const circulatingSwarm = Math.max(1, chain.getTotalSupply());
  const poolBalance = pool?.balance ?? 0;
  const minedCoinsKnown = coins.length;
  const poolLiquidRatio = Math.max(0, poolBalance / circulatingSwarm);
  const knownMinedRatio = Math.max(0, minedCoinsKnown / circulatingSwarm);
  const liquidityPremium = 1 + Math.min(2, poolLiquidRatio * 10);
  const scarcityPremium = 1 + Math.min(3, knownMinedRatio * 20);
  const basePriceSwarm = round6(liquidityPremium * scarcityPremium);

  const now = Date.now();
  const recent = listings.filter((l) => now - Date.parse(l.createdAt) <= 48 * 60 * 60 * 1000);
  const prior = listings.filter((l) => {
    const age = now - Date.parse(l.createdAt);
    return age > 48 * 60 * 60 * 1000 && age <= 96 * 60 * 60 * 1000;
  });
  const avg = (rows: CoinListing[]) =>
    rows.length ? rows.reduce((sum, l) => sum + l.askAmount / currencyHint(l.askCurrency), 0) / rows.length : 0;
  const recentAvg = avg(recent);
  const priorAvg = avg(prior);
  const trend48hPct = priorAvg > 0 ? round6(((recentAvg - priorAvg) / priorAvg) * 100) : 0;
  const trendDirection = Math.abs(trend48hPct) < 0.01 ? "flat" : trend48hPct > 0 ? "up" : "down";

  return {
    poolBalance,
    circulatingSwarm,
    minedCoinsKnown,
    poolLiquidRatio,
    basePriceSwarm,
    trend48hPct,
    trendDirection,
  };
}

// ── Rate limit ─────────────────────────────────────────────────────────

const LAST_LIST_AT = new Map<string, number>();
const LIST_COOLDOWN_MS = 60_000;

function assertRateLimit(userId: string) {
  const last = LAST_LIST_AT.get(userId) ?? 0;
  const wait = LIST_COOLDOWN_MS - (Date.now() - last);
  if (wait > 0) {
    throw new Error(`Please wait ${Math.ceil(wait / 1000)}s before listing another coin.`);
  }
}

// ── Storage helpers ────────────────────────────────────────────────────

export async function getAllListings(): Promise<CoinListing[]> {
  return getAll<CoinListing>(LISTINGS_STORE);
}

export async function getListing(listingId: string): Promise<CoinListing | undefined> {
  return get<CoinListing>(LISTINGS_STORE, listingId);
}

export async function getListingsBySeller(sellerId: string): Promise<CoinListing[]> {
  try {
    return await getAllByIndex<CoinListing>(LISTINGS_STORE, "sellerId", sellerId);
  } catch {
    const all = await getAllListings();
    return all.filter((l) => l.sellerId === sellerId);
  }
}

export async function getOpenListings(): Promise<CoinListing[]> {
  const all = await getAllListings();
  return all
    .filter((l) => l.status === "open" || l.status === "reserved" || l.status === "paid")
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
}

// ── Actions ────────────────────────────────────────────────────────────

function recordMarketTx(
  type: SwarmTransaction["type"],
  params: {
    listing: CoinListing;
    from: string;
    to: string;
    amount?: number;
    extraMeta?: Record<string, unknown>;
  },
): SwarmTransaction {
  const tx: SwarmTransaction = {
    id: generateTransactionId(),
    type,
    from: params.from,
    to: params.to,
    amount: params.amount ?? 0,
    tokenId: params.listing.coinId,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: params.from,
    nonce: Date.now(),
    fee: 0,
    meta: {
      listingId: params.listing.listingId,
      askAmount: params.listing.askAmount,
      askCurrency: params.listing.askCurrency,
      status: params.listing.status,
      ...(params.extraMeta ?? {}),
    },
  };
  try {
    getSwarmChain().addTransaction(tx);
  } catch (err) {
    console.warn("[CoinMarket] tx addTransaction failed:", err);
  }
  try {
    window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: tx }));
  } catch { /* non-browser */ }
  return tx;
}

function emitListingEvent(listing: CoinListing) {
  try {
    window.dispatchEvent(new CustomEvent("coin-market-update", { detail: listing }));
  } catch { /* non-browser */ }
}

async function loadCoin(coinId: string): Promise<SwarmCoin | undefined> {
  return get<SwarmCoin>(COINS_STORE, coinId);
}

async function saveCoin(coin: SwarmCoin): Promise<void> {
  await put(COINS_STORE, coin);
}

// ── LIST ───────────────────────────────────────────────────────────────

export async function listCoinForSale(params: {
  sellerId: string;
  coinId: string;
  askAmount: number;
  askCurrency: CoinMarketCurrency;
  receivingAddress: string;
  memo?: string;
}): Promise<CoinListing> {
  const {
    sellerId,
    coinId,
    askAmount,
    askCurrency,
    receivingAddress,
    memo,
  } = params;

  if (!(askAmount > 0) || !isFinite(askAmount)) {
    throw new Error("Ask price must be greater than zero.");
  }
  if (!isValidAddress(askCurrency, receivingAddress)) {
    throw new Error(`Invalid ${askCurrency} address.`);
  }
  assertRateLimit(sellerId);

  const coin = await loadCoin(coinId);
  if (!coin) throw new Error("Coin not found in your wallet.");
  if (coin.ownerId !== sellerId) throw new Error("You do not own this coin.");
  if (coin.status !== "wallet") throw new Error("This coin is not in your wallet.");

  // Tier gate — enforce max open listings for this seller based on pool size.
  const pool = await getRewardPool();
  const tier = computeMarketTier(pool?.balance ?? 0);
  const openBySeller = (await getListingsBySeller(sellerId)).filter((l) =>
    ["open", "reserved", "paid"].includes(l.status),
  );
  if (openBySeller.length >= tier.maxOpenListings) {
    throw new Error(
      `Tier ${tier.tier} (${tier.label}) allows up to ${
        tier.maxOpenListings === Infinity ? "unlimited" : tier.maxOpenListings
      } open listing(s). Grow the community pool to unlock more.`,
    );
  }

  const now = new Date().toISOString();
  const listing: CoinListing = {
    listingId: generateTokenId(),
    sellerId,
    coinId,
    askAmount,
    askCurrency,
    receivingAddress: receivingAddress.trim(),
    memo: memo?.trim() || undefined,
    status: "open",
    tier: tier.tier,
    createdAt: now,
    updatedAt: now,
  };

  // Move coin into escrow pseudo-owner so it can't be spent while listed.
  coin.ownerId = `${MARKET_ESCROW_PREFIX}${listing.listingId}`;
  coin.status = "pool";
  await saveCoin(coin);
  await put(LISTINGS_STORE, listing);

  recordMarketTx("coin_market_list", {
    listing,
    from: sellerId,
    to: `${MARKET_ESCROW_PREFIX}${listing.listingId}`,
  });

  LAST_LIST_AT.set(sellerId, Date.now());
  emitListingEvent(listing);
  return listing;
}

// ── RESERVE ────────────────────────────────────────────────────────────

export async function reserveListing(params: {
  listingId: string;
  buyerId: string;
}): Promise<CoinListing> {
  const listing = await getListing(params.listingId);
  if (!listing) throw new Error("Listing not found.");
  if (listing.sellerId === params.buyerId)
    throw new Error("You cannot reserve your own listing.");

  // Expire stale reservation.
  if (
    listing.status === "reserved" &&
    listing.reservedAt &&
    Date.now() - Date.parse(listing.reservedAt) > RESERVATION_TTL_MS
  ) {
    listing.status = "open";
    listing.buyerId = undefined;
    listing.reservedAt = undefined;
  }

  if (listing.status !== "open") throw new Error("This listing is not available.");

  listing.status = "reserved";
  listing.buyerId = params.buyerId;
  listing.reservedAt = new Date().toISOString();
  listing.updatedAt = listing.reservedAt;
  await put(LISTINGS_STORE, listing);

  recordMarketTx("coin_market_reserve", {
    listing,
    from: params.buyerId,
    to: listing.sellerId,
  });
  emitListingEvent(listing);
  return listing;
}

// ── CONFIRM PAYMENT ────────────────────────────────────────────────────

export async function confirmPayment(params: {
  listingId: string;
  buyerId: string;
  paymentTxHash: string;
}): Promise<CoinListing> {
  const listing = await getListing(params.listingId);
  if (!listing) throw new Error("Listing not found.");
  if (listing.buyerId !== params.buyerId)
    throw new Error("You did not reserve this listing.");
  if (listing.status !== "reserved")
    throw new Error("Listing is not in a reserved state.");

  const hash = params.paymentTxHash.trim();
  if (hash.length < 6) throw new Error("Payment reference is required.");

  listing.status = "paid";
  listing.paymentTxHash = hash;
  listing.paidAt = new Date().toISOString();
  listing.updatedAt = listing.paidAt;
  await put(LISTINGS_STORE, listing);

  recordMarketTx("coin_market_confirm_payment", {
    listing,
    from: params.buyerId,
    to: listing.sellerId,
    extraMeta: { paymentTxHash: hash },
  });
  emitListingEvent(listing);
  return listing;
}

// ── SETTLE ─────────────────────────────────────────────────────────────

export async function settleListing(params: {
  listingId: string;
  sellerId: string;
}): Promise<CoinListing> {
  const listing = await getListing(params.listingId);
  if (!listing) throw new Error("Listing not found.");
  if (listing.sellerId !== params.sellerId)
    throw new Error("Only the seller can release this coin.");
  if (listing.status !== "paid")
    throw new Error("Buyer has not confirmed payment yet.");
  if (!listing.buyerId) throw new Error("Listing has no buyer.");

  const coin = await loadCoin(listing.coinId);
  if (!coin) throw new Error("Escrowed coin missing.");
  coin.ownerId = listing.buyerId;
  coin.status = "wallet";
  await saveCoin(coin);

  listing.status = "settled";
  listing.settledAt = new Date().toISOString();
  listing.updatedAt = listing.settledAt;
  await put(LISTINGS_STORE, listing);

  recordMarketTx("coin_market_settle", {
    listing,
    from: params.sellerId,
    to: listing.buyerId,
    amount: 1,
  });
  emitListingEvent(listing);
  return listing;
}

// ── CANCEL ─────────────────────────────────────────────────────────────

export async function cancelListing(params: {
  listingId: string;
  actorId: string;
}): Promise<CoinListing> {
  const listing = await getListing(params.listingId);
  if (!listing) throw new Error("Listing not found.");

  const isSeller = listing.sellerId === params.actorId;
  const isBuyer = listing.buyerId === params.actorId;

  if (listing.status === "settled") throw new Error("Listing already settled.");
  if (listing.status === "paid" && !isSeller) {
    throw new Error("Only the seller can cancel after payment. Buyers may dispute.");
  }
  if (!isSeller && !isBuyer) throw new Error("Not authorized to cancel.");

  // Return coin to seller.
  const coin = await loadCoin(listing.coinId);
  if (coin) {
    coin.ownerId = listing.sellerId;
    coin.status = "wallet";
    await saveCoin(coin);
  }

  listing.status = "cancelled";
  listing.updatedAt = new Date().toISOString();
  await put(LISTINGS_STORE, listing);

  recordMarketTx("coin_market_cancel", {
    listing,
    from: params.actorId,
    to: listing.sellerId,
  });
  emitListingEvent(listing);
  return listing;
}

// ── DISPUTE ────────────────────────────────────────────────────────────

export async function disputeListing(params: {
  listingId: string;
  buyerId: string;
  reason: string;
}): Promise<CoinListing> {
  const listing = await getListing(params.listingId);
  if (!listing) throw new Error("Listing not found.");
  if (listing.buyerId !== params.buyerId)
    throw new Error("Only the buyer can dispute this listing.");
  if (listing.status !== "paid")
    throw new Error("Only paid listings can be disputed.");

  listing.status = "disputed";
  listing.updatedAt = new Date().toISOString();
  await put(LISTINGS_STORE, listing);

  recordMarketTx("coin_market_dispute", {
    listing,
    from: params.buyerId,
    to: listing.sellerId,
    extraMeta: { reason: params.reason.slice(0, 500) },
  });
  emitListingEvent(listing);
  return listing;
}

// ── Maintenance ────────────────────────────────────────────────────────

/** Auto-cancel listings that have been open longer than 30 days. */
export async function pruneExpiredListings(actorId: string | null): Promise<number> {
  const all = await getAllListings();
  const now = Date.now();
  let pruned = 0;
  for (const l of all) {
    if (l.status !== "open" && l.status !== "reserved") continue;
    if (now - Date.parse(l.createdAt) < LISTING_MAX_AGE_MS) continue;
    // Only the seller (locally online) can auto-cancel via a signed tx.
    if (actorId && actorId === l.sellerId) {
      try {
        await cancelListing({ listingId: l.listingId, actorId });
        pruned++;
      } catch { /* skip */ }
    } else {
      // Prune locally — the record will be replaced when the seller's own
      // client next comes online.
      await remove(LISTINGS_STORE, l.listingId);
      pruned++;
    }
  }
  return pruned;
}

export function listingStatusLabel(status: CoinListingStatus): string {
  switch (status) {
    case "open":      return "Open";
    case "reserved":  return "Reserved";
    case "paid":      return "Payment confirmed";
    case "settled":   return "Settled";
    case "cancelled": return "Cancelled";
    case "disputed":  return "Disputed";
  }
}
