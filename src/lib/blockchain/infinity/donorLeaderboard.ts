/**
 * Donor leaderboard — who has given to the project, and how much.
 *
 * Source of truth is the shared SWARM ledger, so every peer with the same
 * chain shows the same board:
 *   • `wallet_tip` sent to Infinity's donations vault (any asset: SWARM,
 *     MINTME, creator tokens), signed by the sender.
 *   • `pool_donate` from a member (SWARM given to the Market Vault).
 *     Mining-tax top-ups (`from: "system"`) are not donations and are skipped.
 *   • Credits or a synced MintMe token given through Support the Vault: a
 *     `custom_token_transfer` to the vault with `direction: "donation"`.
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

const NATIVE_TICKERS = new Set(["SWARM", "MINTME", "CREDITS"]);
/** The Market Vault's ledger account. */
const VAULT = "community-pool";

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

/** Fiat codes shown with a currency symbol; a token may never take one as its name. */
const FIAT_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
/** Names a token's own label can never claim. */
const RESERVED_LABELS = new Set([...NATIVE_TICKERS, ...Object.keys(FIAT_SYMBOLS)]);
/** Prefix of the internal key for a token: totals are kept per contract, never per symbol. */
const TOKEN_KEY = "token\u0000";

export interface DonationGift {
  /**
   * What the amount is counted under. Native assets use their ticker
   * ("SWARM", "MINTME", "Credits"); a token uses its contract or asset id,
   * so two tokens that share a symbol are never added together.
   */
  ticker: string;
  amount: number;
  /** A token's self-chosen symbol, used only as a display label. */
  label?: string;
}

const tokenKey = (id: string) => `${TOKEN_KEY}${id}`;
const isTokenKey = (key: string) => key.startsWith(TOKEN_KEY);

/** "0x1234…5678" for a long contract or asset id, else the id as given. */
function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function tokenLabel(raw: unknown): string | undefined {
  const label = typeof raw === "string" ? raw.trim() : "";
  return label && !RESERVED_LABELS.has(label.toUpperCase()) ? label : undefined;
}

/** What `tx` gave to the project, when it is a member donation, else null. */
export function donationFromTx(tx: SwarmTransaction): DonationGift | null {
  const amount = Number(tx.amount);
  if (!Number.isFinite(amount) || amount <= 0 || !tx.from || tx.from === "system") return null;
  if (tx.type === "wallet_tip" && tx.to === INFINITY_GIFT_VAULT) {
    // The settled asset decides the currency, never the sender's display ticker.
    if (isNativeMintMeTip(tx)) return { ticker: "MINTME", amount };
    const assetId = typeof tx.meta?.assetId === "string" ? tx.meta.assetId : "";
    if (assetId === "chain:SWARM") return { ticker: "SWARM", amount };
    if (!assetId) return null;
    return { ticker: tokenKey(assetId), amount, label: tokenLabel(tx.meta?.ticker) };
  }
  if (tx.type === "pool_donate") return { ticker: "SWARM", amount };
  if (tx.type === "custom_token_transfer" && tx.to === VAULT && tx.meta?.marketVault === true && tx.meta?.direction === "donation") {
    const currency = typeof tx.meta.currency === "string" ? tx.meta.currency.trim() : "";
    if (!currency) return null;
    if (currency.toUpperCase() === "CREDITS") return { ticker: "Credits", amount };
    // A synced MintMe token, counted per contract (addresses are case-insensitive).
    const contract = currency.replace(/^MINTME:/i, "").toLowerCase();
    return { ticker: tokenKey(`mintme:${contract}`), amount, label: tokenLabel(tx.meta.ticker) };
  }
  return null;
}

/**
 * The board's name for each token key: its symbol when no other asset on the
 * board goes by that name, else the symbol with its short contract, so a
 * look-alike can never merge with or pass for another asset.
 */
function tokenDisplayNames(labels: Map<string, string | undefined>, otherKeys: Iterable<string>): Map<string, string> {
  const fallback = (key: string) => shortId(key.slice(TOKEN_KEY.length).replace(/^(mintme|token):/i, ""));
  const claims = new Map<string, number>();
  const claim = (name: string) => claims.set(name.toUpperCase(), (claims.get(name.toUpperCase()) ?? 0) + 1);
  for (const k of otherKeys) claim(k);
  for (const [key, label] of labels) claim(label ?? fallback(key));
  const names = new Map<string, string>();
  for (const [key, label] of labels) {
    const name = label ?? fallback(key);
    names.set(key, claims.get(name.toUpperCase()) === 1 ? name : label ? `${label} (${fallback(key)})` : fallback(key));
  }
  return names;
}

function renameKeys(amounts: Record<string, number>, names: Map<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(amounts)) out[names.get(k) ?? k] = v;
  return out;
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
  const labels = new Map<string, string | undefined>();
  let donationCount = 0;
  for (const tx of txs) {
    if (!tx || seen.has(tx.id)) continue;
    const gift = donationFromTx(tx);
    if (!gift) continue;
    seen.add(tx.id);
    donationCount++;
    if (isTokenKey(gift.ticker) && !labels.get(gift.ticker)) labels.set(gift.ticker, gift.label);
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
  if (labels.size > 0) {
    const names = tokenDisplayNames(labels, Object.keys(totals).filter((k) => !isTokenKey(k)));
    for (const entry of byDonor.values()) entry.amounts = renameKeys(entry.amounts, names);
    const renamed = renameKeys(totals, names);
    for (const k of Object.keys(totals)) delete totals[k];
    Object.assign(totals, renamed);
  }
  // SWARM is the network's unit, so it sets the rank; other assets break ties.
  const donors = [...byDonor.values()].sort((a, b) =>
    (b.amounts.SWARM ?? 0) - (a.amounts.SWARM ?? 0)
    || Object.values(b.amounts).reduce((s, n) => s + n, 0) - Object.values(a.amounts).reduce((s, n) => s + n, 0)
    || a.userId.localeCompare(b.userId));
  return { donors, totals, donationCount };
}

/** Read the local copy of the shared ledger (mined blocks + pending mesh txs). */
export async function loadDonorLeaderboard(): Promise<DonorLeaderboard & { ledgerSize: number }> {
  const { getSwarmChain } = await import("../chain");
  const chain = getSwarmChain();
  await chain.whenReady();
  const txs = [
    ...chain.getChain().flatMap((b) => b.transactions ?? []),
    ...chain.getPendingTransactions(),
  ];
  return { ...buildDonorLeaderboard(txs, MANUAL_DONATIONS), ledgerSize: txs.length };
}

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
