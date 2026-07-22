// Participant Listings — user↔user Creator Token trades.
// One active sell + one active buy per user per token. First-listed-first-served
// matching. Completed trades split 95% to the Open Market bucket / 5% to the
// community pool per the SWARM Economy spec.

import { get, getAll, put, remove } from "../store";
import type {
  ParticipantListing,
  ParticipantListingSide,
  CreatorVault,
} from "./types";
import {
  PARTICIPANT_TRADE_MARKET_SHARE,
  PARTICIPANT_TRADE_COMMUNITY_SHARE,
} from "./types";
import { generateTokenId, generateTransactionId } from "./crypto";
import { getSwarmChain } from "./chain";
import {
  addProfileTokens,
  getProfileTokenHolding,
  saveProfileTokenHolding,
} from "./profileTokenBalance";
import { getCreatorVault, saveCreatorVault } from "./creatorVault";

const STORE = "participantListings";

function nowIso() {
  return new Date().toISOString();
}

function round6(n: number) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export async function getListingsForToken(tokenId: string): Promise<ParticipantListing[]> {
  const all = await getAll<ParticipantListing>(STORE);
  return all
    .filter((l) => l.tokenId === tokenId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function getUserListing(
  userId: string,
  tokenId: string,
  side: ParticipantListingSide,
): Promise<ParticipantListing | null> {
  const all = await getAll<ParticipantListing>(STORE);
  return (
    all.find(
      (l) =>
        l.userId === userId &&
        l.tokenId === tokenId &&
        l.side === side &&
        l.status === "open",
    ) ?? null
  );
}

export async function cancelListing(listingId: string, userId: string): Promise<void> {
  const l = await get<ParticipantListing>(STORE, listingId);
  if (!l) return;
  if (l.userId !== userId) throw new Error("Only the owner can cancel");
  if (l.status !== "open") return;

  // Refund escrow
  if (l.side === "sell") {
    await addProfileTokens({
      userId,
      tokenId: l.tokenId,
      ticker: "",
      creatorUserId: "",
      amount: l.tokens,
    });
  } else {
    const { mintSwarm } = await import("./token");
    await mintSwarm({
      to: userId,
      amount: l.tokens * l.pricePerToken,
      reason: "Cancel buy listing escrow",
    });
  }
  l.status = "cancelled";
  l.updatedAt = nowIso();
  await put(STORE, l);
  emitUpdate(l);
}

function emitUpdate(l: ParticipantListing) {
  try {
    window.dispatchEvent(new CustomEvent("participant-listing-update", { detail: l }));
  } catch { /* non-browser */ }
}

/** Create a sell listing. Escrows tokens from the seller. */
export async function createSellListing(params: {
  userId: string;
  tokenId: string;
  ticker: string;
  tokens: number;
  pricePerToken: number;
}): Promise<ParticipantListing> {
  const { userId, tokenId, ticker, tokens, pricePerToken } = params;
  if (!(tokens > 0) || !(pricePerToken > 0)) throw new Error("Invalid amount/price");

  const existing = await getUserListing(userId, tokenId, "sell");
  if (existing) throw new Error("You already have an active sell listing. Cancel it first.");

  const holding = await getProfileTokenHolding(userId, tokenId);
  if (!holding || holding.amount < tokens) throw new Error("Insufficient tokens");

  // Escrow: deduct tokens from seller
  holding.amount = round6(holding.amount - tokens);
  holding.lastUpdated = nowIso();
  await saveProfileTokenHolding(holding);

  const listing: ParticipantListing = {
    listingId: generateTokenId(),
    tokenId,
    userId,
    side: "sell",
    tokens,
    pricePerToken,
    status: "open",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await put(STORE, listing);
  await tryMatch(tokenId, ticker);
  emitUpdate(listing);
  return listing;
}

/** Create a buy listing. Escrows SWARM from the buyer. */
export async function createBuyListing(params: {
  userId: string;
  tokenId: string;
  ticker: string;
  tokens: number;
  pricePerToken: number;
}): Promise<ParticipantListing> {
  const { userId, tokenId, ticker, tokens, pricePerToken } = params;
  if (!(tokens > 0) || !(pricePerToken > 0)) throw new Error("Invalid amount/price");

  const existing = await getUserListing(userId, tokenId, "buy");
  if (existing) throw new Error("You already have an active buy listing. Cancel it first.");

  const cost = round6(tokens * pricePerToken);
  const { getSwarmBalance, burnSwarm } = await import("./token");
  const bal = await getSwarmBalance(userId);
  if (bal < cost) throw new Error(`Insufficient SWARM. Need ${cost.toFixed(4)}`);
  await burnSwarm({ from: userId, amount: cost, reason: "Escrow buy listing" });

  const listing: ParticipantListing = {
    listingId: generateTokenId(),
    tokenId,
    userId,
    side: "buy",
    tokens,
    pricePerToken,
    status: "open",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await put(STORE, listing);
  await tryMatch(tokenId, ticker);
  emitUpdate(listing);
  return listing;
}

/**
 * First-listed-first-served matching. Matches oldest open buy with oldest open
 * sell where buy.price >= sell.price. Trade price = sell.price. Trade tokens =
 * min(buy.tokens, sell.tokens). Handles partial fills by re-listing the remainder.
 */
async function tryMatch(tokenId: string, ticker: string): Promise<void> {
  const listings = await getListingsForToken(tokenId);
  const opens = listings.filter((l) => l.status === "open");
  const buys = opens.filter((l) => l.side === "buy");
  const sells = opens.filter((l) => l.side === "sell");
  if (!buys.length || !sells.length) return;

  const buy = buys[0];
  const sell = sells[0];
  if (buy.pricePerToken < sell.pricePerToken) return;
  if (buy.userId === sell.userId) return;

  const tokens = Math.min(buy.tokens, sell.tokens);
  const price = sell.pricePerToken;
  const gross = round6(tokens * price);

  // Route funds: 95% Open Market bucket (creator vault buyback reserve),
  // 5% community pool. Seller receives 100% × sell price back — the split
  // applies to the *creator take* (the difference between the buy price the
  // buyer paid and the sell price the seller received is retained by the
  // vault). Since we escrowed the buyer at their bid price, refund the
  // buyer the price gap; then split the remainder.
  const buyerPaid = round6(tokens * buy.pricePerToken);
  const sellerProceeds = gross;
  const surplus = round6(buyerPaid - sellerProceeds);

  const { mintSwarm } = await import("./token");
  // Seller receives full sell-price proceeds
  await mintSwarm({ to: sell.userId, amount: sellerProceeds, reason: "Participant trade" });

  // Split surplus 95/5
  if (surplus > 0) {
    const toMarket = round6(surplus * PARTICIPANT_TRADE_MARKET_SHARE);
    const toCommunity = round6(surplus - toMarket);

    const vault = await getCreatorVault(tokenId);
    if (vault && toMarket > 0) {
      vault.buybackReserve = round6(vault.buybackReserve + toMarket);
      vault.totalDeposited = round6(vault.totalDeposited + toMarket);
      await saveCreatorVault(vault);
    }

    if (toCommunity > 0) {
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
        pool.balance = round6(pool.balance + toCommunity);
        pool.totalContributed = round6(pool.totalContributed + toCommunity);
        pool.contributors[buy.userId] = round6(
          (pool.contributors[buy.userId] || 0) + toCommunity,
        );
        pool.lastUpdated = nowIso();
        await saveRewardPool(pool);
      } catch (err) {
        console.warn("[ParticipantListings] pool update failed:", err);
      }
    }
  }

  // Move tokens: buyer gains, seller already had them deducted at escrow
  await addProfileTokens({
    userId: buy.userId,
    tokenId,
    ticker,
    creatorUserId: sell.userId,
    amount: tokens,
  });

  // Update or close listings
  const now = nowIso();
  const closeOrShrink = async (l: ParticipantListing, filled: number) => {
    if (filled >= l.tokens - 1e-9) {
      l.status = "filled";
      l.filledAt = now;
      l.filledBy = l.side === "sell" ? buy.userId : sell.userId;
    } else {
      l.tokens = round6(l.tokens - filled);
    }
    l.updatedAt = now;
    await put(STORE, l);
    emitUpdate(l);
  };
  await closeOrShrink(sell, tokens);
  await closeOrShrink(buy, tokens);

  // Record trade on chain (best-effort — no dedicated tx type, uses meta)
  try {
    getSwarmChain().addTransaction({
      id: generateTransactionId(),
      type: "creator_token_buy",
      from: buy.userId,
      to: sell.userId,
      amount: gross,
      tokenId,
      timestamp: now,
      signature: "",
      publicKey: buy.userId,
      nonce: Date.now(),
      fee: 0,
      meta: {
        participantTrade: true,
        tokens,
        price,
        surplus,
      },
    });
  } catch { /* ignore */ }
}

/** Redeem listings when a market is closed — refund escrows. */
export async function refundAllListings(tokenId: string): Promise<void> {
  const listings = await getListingsForToken(tokenId);
  for (const l of listings) {
    if (l.status !== "open") continue;
    try {
      await cancelListing(l.listingId, l.userId);
    } catch (err) {
      console.warn("[ParticipantListings] refund failed:", err);
    }
  }
}