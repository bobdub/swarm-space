/**
 * Donor leaderboard — who has given to the project, and how much.
 *
 * Source of truth is the shared SWARM ledger, so every peer with the same
 * chain shows the same board:
 *   • `wallet_tip` sent to Infinity's donations vault (any asset: SWARM,
 *     MINTME, creator tokens), signed by the sender.
 *   • `pool_donate` from a member (SWARM given to the Market Vault).
 *     Mining-tax top-ups (`from: "system"`) are not donations and are skipped.
 *
 *   • Hand-recorded off-mesh donations from `manualDonations.ts`: ETH/BTC
 *     sent to the external donation addresses, gift cards, cash, and so on.
 *
 * Not counted: credit gifts to Infinity (credits live in each node's local
 * store, not on the chain, so other peers can't see them).
 */
import type { SwarmTransaction } from "../types";
import { INFINITY_GIFT_VAULT } from "./vaults";
import { isNativeMintMeTip } from "../wallets/nativeMintmeLedger";
import { MANUAL_DONATIONS, type ManualDonation } from "./manualDonations";

const NATIVE_TICKERS = new Set(["SWARM", "MINTME"]);

export interface DonorEntry {
  /** Swarm user id, or `manual:<name>` for a hand-recorded donor with no account. */
  userId: string;
  /** Display name from a hand-recorded donation; peers' profiles name everyone else. */
  name?: string;
  /** Amount given per ticker, e.g. { SWARM: 120, MINTME: 4 }. */
  amounts: Record<string, number>;
  donations: number;
  lastAt: string;
}

export interface DonorLeaderboard {
  donors: DonorEntry[];
  /** Total raised per ticker across every donor. */
  totals: Record<string, number>;
  donationCount: number;
}

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

/** Ticker and amount when `tx` is a member donation to the project, else null. */
export function donationFromTx(tx: SwarmTransaction): { ticker: string; amount: number } | null {
  const amount = Number(tx.amount);
  if (!Number.isFinite(amount) || amount <= 0 || !tx.from || tx.from === "system") return null;
  if (tx.type === "wallet_tip" && tx.to === INFINITY_GIFT_VAULT) {
    // The settled asset decides the currency, never the sender's display ticker.
    if (isNativeMintMeTip(tx)) return { ticker: "MINTME", amount };
    const assetId = typeof tx.meta?.assetId === "string" ? tx.meta.assetId : "";
    if (assetId === "chain:SWARM") return { ticker: "SWARM", amount };
    if (!assetId) return null;
    const label = typeof tx.meta?.ticker === "string" ? tx.meta.ticker.trim() : "";
    // A creator token may not borrow a native ticker.
    const ticker = label && !NATIVE_TICKERS.has(label.toUpperCase()) ? label : assetId;
    return { ticker, amount };
  }
  if (tx.type === "pool_donate") return { ticker: "SWARM", amount };
  return null;
}

const manualKey = (d: ManualDonation) => d.userId?.trim() || `manual:${d.donor.trim().toLowerCase()}`;

function manualTimestamp(date: string): string {
  const t = Date.parse(date);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

/**
 * Fold ledger transactions and hand-recorded donations into a ranked board.
 * Duplicate tx ids count once.
 */
export function buildDonorLeaderboard(
  txs: Iterable<SwarmTransaction>,
  manual: readonly ManualDonation[] = [],
): DonorLeaderboard {
  const seen = new Set<string>();
  const byDonor = new Map<string, DonorEntry>();
  const totals: Record<string, number> = {};
  let donationCount = 0;
  for (const tx of txs) {
    if (!tx || seen.has(tx.id)) continue;
    const gift = donationFromTx(tx);
    if (!gift) continue;
    seen.add(tx.id);
    donationCount++;
    const entry = byDonor.get(tx.from) ?? { userId: tx.from, amounts: {}, donations: 0, lastAt: tx.timestamp };
    entry.amounts[gift.ticker] = round6((entry.amounts[gift.ticker] ?? 0) + gift.amount);
    entry.donations++;
    if (tx.timestamp > entry.lastAt) entry.lastAt = tx.timestamp;
    byDonor.set(tx.from, entry);
    totals[gift.ticker] = round6((totals[gift.ticker] ?? 0) + gift.amount);
  }
  for (const d of manual) {
    const amount = Number(d?.amount);
    const ticker = typeof d?.currency === "string" ? d.currency.trim().toUpperCase() : "";
    const donor = typeof d?.donor === "string" ? d.donor.trim() : "";
    if (!Number.isFinite(amount) || amount <= 0 || !ticker || !donor) continue;
    const key = manualKey(d);
    const at = manualTimestamp(d.date);
    donationCount++;
    const entry = byDonor.get(key) ?? { userId: key, amounts: {}, donations: 0, lastAt: at };
    entry.name ??= donor;
    entry.amounts[ticker] = round6((entry.amounts[ticker] ?? 0) + amount);
    entry.donations++;
    if (at > entry.lastAt) entry.lastAt = at;
    byDonor.set(key, entry);
    totals[ticker] = round6((totals[ticker] ?? 0) + amount);
  }
  // SWARM is the network's unit, so it sets the rank; other assets break ties.
  const donors = [...byDonor.values()].sort((a, b) =>
    (b.amounts.SWARM ?? 0) - (a.amounts.SWARM ?? 0)
    || Object.values(b.amounts).reduce((s, n) => s + n, 0) - Object.values(a.amounts).reduce((s, n) => s + n, 0)
    || a.userId.localeCompare(b.userId));
  return { donors, totals, donationCount };
}

/** Read the local copy of the shared ledger (mined blocks + pending mesh txs). */
export async function loadDonorLeaderboard(): Promise<DonorLeaderboard> {
  const { getSwarmChain } = await import("../chain");
  const chain = getSwarmChain();
  await chain.whenReady();
  return buildDonorLeaderboard([
    ...chain.getChain().flatMap((b) => b.transactions ?? []),
    ...chain.getPendingTransactions(),
  ], MANUAL_DONATIONS);
}

const FIAT_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

/** "120 SWARM · 0.05 ETH · $25" with SWARM first. */
export function formatDonationAmounts(amounts: Record<string, number>): string {
  const keys = Object.keys(amounts).sort((a, b) => (a === "SWARM" ? -1 : b === "SWARM" ? 1 : a.localeCompare(b)));
  if (keys.length === 0) return "0 SWARM";
  return keys.map((k) => {
    const fiat = FIAT_SYMBOLS[k];
    if (fiat) return `${fiat}${amounts[k].toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    return `${amounts[k].toLocaleString(undefined, { maximumFractionDigits: 8 })} ${k}`;
  }).join(" · ");
}
