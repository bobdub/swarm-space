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
 * Not counted: credit gifts to Infinity (credits live in each node's local
 * store, not on the chain, so other peers can't see them) and direct
 * ETH/BTC gifts to the external donation addresses (off-mesh).
 */
import type { SwarmTransaction } from "../types";
import { INFINITY_GIFT_VAULT } from "./vaults";

export interface DonorEntry {
  userId: string;
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
    const ticker = typeof tx.meta?.ticker === "string" && tx.meta.ticker.trim() ? tx.meta.ticker.trim() : "SWARM";
    return { ticker, amount };
  }
  if (tx.type === "pool_donate") return { ticker: "SWARM", amount };
  return null;
}

/** Fold ledger transactions into a ranked board. Duplicate tx ids count once. */
export function buildDonorLeaderboard(txs: Iterable<SwarmTransaction>): DonorLeaderboard {
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
  ]);
}

/** "120 SWARM · 4 MINTME" with SWARM first. */
export function formatDonationAmounts(amounts: Record<string, number>): string {
  const keys = Object.keys(amounts).sort((a, b) => (a === "SWARM" ? -1 : b === "SWARM" ? 1 : a.localeCompare(b)));
  if (keys.length === 0) return "0 SWARM";
  return keys.map((k) => `${amounts[k].toLocaleString(undefined, { maximumFractionDigits: 4 })} ${k}`).join(" · ");
}
