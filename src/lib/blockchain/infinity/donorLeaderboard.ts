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
import { isNativeEthTip } from "../wallets/nativeEth";
import { MANUAL_DONATIONS, type ManualDonation } from "./manualDonations";
import { loadMarketPrices } from "./donationPrices";
import { parseTokenRef, tokenCurrency, tokenRefFromCurrency } from "../deposits/tokenNetworks";

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
  /** Everything given, at today's market prices, in SWARM. Assets with no price add nothing. */
  value: number;
  donations: number;
  lastAt: string;
}

export interface DonorLeaderboard {
  donors: DonorEntry[];
  /** Total raised per ticker across every donor. */
  totals: Record<string, number>;
  /** Total raised at today's market prices, in SWARM. */
  totalValue: number;
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
  /**
   * What sets this asset's market price: "SWARM", "MINTME", "ETH", "Credits",
   * a token's ledger currency ("MINTME:0x…") or "creator:<tokenId>".
   */
  priceRef: string;
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
    if (isNativeMintMeTip(tx)) return { ticker: "MINTME", amount, priceRef: "MINTME" };
    if (isNativeEthTip(tx)) return { ticker: "ETH", amount, priceRef: "ETH" };
    const assetId = typeof tx.meta?.assetId === "string" ? tx.meta.assetId : "";
    if (assetId === "chain:SWARM") return { ticker: "SWARM", amount, priceRef: "SWARM" };
    if (!assetId) return null;
    return { ticker: tokenKey(assetId), amount, label: tokenLabel(tx.meta?.ticker), priceRef: tipPriceRef(assetId) };
  }
  if (tx.type === "pool_donate") return { ticker: "SWARM", amount, priceRef: "SWARM" };
  if (tx.type === "custom_token_transfer" && tx.to === VAULT && tx.meta?.marketVault === true && tx.meta?.direction === "donation") {
    const currency = typeof tx.meta.currency === "string" ? tx.meta.currency.trim() : "";
    if (!currency) return null;
    if (currency.toUpperCase() === "CREDITS") return { ticker: "Credits", amount, priceRef: "Credits" };
    // A synced MintMe or Ethereum token, counted per chain + contract (addresses are case-insensitive).
    const ref = tokenRefFromCurrency(currency);
    const token = parseTokenRef(ref ?? "");
    if (!ref || !token) return null;
    return { ticker: tokenKey(`${token.network}:${token.contract}`), amount, label: tokenLabel(tx.meta.ticker), priceRef: tokenCurrency(ref) };
  }
  return null;
}

/** The price source of a tipped asset: its creator market, or the vault's market for a synced token. */
function tipPriceRef(assetId: string): string {
  if (assetId.startsWith("creator:")) return assetId;
  if (assetId.startsWith("custom:")) return tokenCurrency(assetId.slice("custom:".length));
  return assetId;
}

/** SWARM a gift is worth at `prices` (SWARM per unit); 0 when the asset has no price. */
function swarmValue(priceRef: string, amount: number, prices: Readonly<Record<string, number>>): number {
  const price = priceRef === "SWARM" ? 1 : prices[priceRef];
  return Number.isFinite(price) && price > 0 ? amount * price : 0;
}

/**
 * The board's name for each token key: its symbol when no other asset on the
 * board goes by that name, else the symbol with its short contract, so a
 * look-alike can never merge with or pass for another asset.
 */
function tokenDisplayNames(labels: Map<string, string | undefined>, otherKeys: Iterable<string>): Map<string, string> {
  // Ethereum tokens name their chain, so the same contract on MintMe and Ethereum never shares a name.
  const fallback = (key: string) => {
    const id = key.slice(TOKEN_KEY.length);
    const eth = /^(ethereum:|custom:eth:)/i.exec(id);
    if (eth) return `Ethereum ${shortId(id.slice(eth[0].length))}`;
    return shortId(id.replace(/^(mintme|token|custom):/i, ""));
  };
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
  /** Symbols for MintMe contracts this viewer has imported, by lower-case address: a label for gifts that named none. */
  knownSymbols: Readonly<Record<string, string>> = {},
  /** Market prices in SWARM per unit, keyed by `DonationGift.priceRef` (see `loadMarketPrices`). */
  prices: Readonly<Record<string, number>> = {},
): DonorLeaderboard {
  const seen = new Set<string>();
  const byDonor = new Map<string, DonorEntry>();
  const totals: Record<string, number> = {};
  const labels = new Map<string, string | undefined>();
  let donationCount = 0;
  let totalValue = 0;
  for (const tx of txs) {
    if (!tx || seen.has(tx.id)) continue;
    const gift = donationFromTx(tx);
    if (!gift) continue;
    seen.add(tx.id);
    donationCount++;
    if (isTokenKey(gift.ticker) && !labels.get(gift.ticker)) {
      labels.set(gift.ticker, gift.label ?? tokenLabel(knownSymbols[gift.ticker.slice(TOKEN_KEY.length).replace(/^mintme:/, "")]));
    }
    const entry = byDonor.get(tx.from) ?? { userId: tx.from, amounts: {}, value: 0, donations: 0, lastAt: tx.timestamp };
    entry.amounts[gift.ticker] = round6((entry.amounts[gift.ticker] ?? 0) + gift.amount);
    const value = swarmValue(gift.priceRef, gift.amount, prices);
    entry.value = round6(entry.value + value);
    totalValue += value;
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
    const entry = byDonor.get(key) ?? { userId: key, amounts: {}, value: 0, donations: 0, lastAt: at };
    entry.name ??= donor;
    entry.amounts[ticker] = round6((entry.amounts[ticker] ?? 0) + amount);
    // A hand-recorded gift may carry its SWARM value as recorded; otherwise its coin's market price.
    const recorded = Number(d.swarmValue);
    const value = Number.isFinite(recorded) && recorded > 0 ? recorded : swarmValue(ticker, amount, prices);
    entry.value = round6(entry.value + value);
    totalValue += value;
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
  // Rank by what everything given is worth at market prices; SWARM given, then raw amounts, break ties.
  const donors = [...byDonor.values()].sort((a, b) =>
    b.value - a.value
    || (b.amounts.SWARM ?? 0) - (a.amounts.SWARM ?? 0)
    || Object.values(b.amounts).reduce((s, n) => s + n, 0) - Object.values(a.amounts).reduce((s, n) => s + n, 0)
    || a.userId.localeCompare(b.userId));
  return { donors, totals, totalValue: round6(totalValue), donationCount };
}

/** Read the local copy of the shared ledger (mined blocks + pending mesh txs). */
export async function loadDonorLeaderboard(): Promise<DonorLeaderboard & { ledgerSize: number; tipHeight: number; tipHash: string }> {
  const { getSwarmChain } = await import("../chain");
  const chain = getSwarmChain();
  await chain.whenReady();
  const txs = [
    ...chain.getChain().flatMap((b) => b.transactions ?? []),
    ...chain.getPendingTransactions(),
  ];
  const refs = new Set<string>(MANUAL_DONATIONS.map((d) => String(d.currency ?? "").trim().toUpperCase()));
  for (const tx of txs) {
    const gift = tx ? donationFromTx(tx) : null;
    if (gift) refs.add(gift.priceRef);
  }
  const [symbols, prices] = await Promise.all([importedTokenSymbols(), loadMarketPrices(refs).catch(() => ({}))]);
  // The chain tip lets two members compare boards: the same block means the same ledger.
  const tip = chain.getLatestBlock();
  return { ...buildDonorLeaderboard(txs, MANUAL_DONATIONS, symbols, prices), ledgerSize: txs.length, tipHeight: tip?.index ?? 0, tipHash: tip?.hash ?? "" };
}

/** Symbols of the MintMe-network tokens the signed-in member has imported, by lower-case contract. */
async function importedTokenSymbols(): Promise<Record<string, string>> {
  try {
    const [{ getCurrentUser }, { listCustomTokens, customTokenNetwork }] = await Promise.all([import("@/lib/auth"), import("../deposits/customTokens")]);
    const me = getCurrentUser();
    const out: Record<string, string> = {};
    for (const t of me ? listCustomTokens(me.id) : []) {
      // Only MintMe tokens: an Ethereum token at the same address is a different coin.
      if (typeof t?.address === "string" && typeof t.symbol === "string" && customTokenNetwork(t) === "mintme") out[t.address.toLowerCase()] = t.symbol;
    }
    return out;
  } catch {
    return {};
  }
}

/** "≈ 2,315 SWARM": a market value, rounded for the board. */
export function formatSwarmValue(value: number): string {
  const digits = value >= 100 ? 0 : value >= 1 ? 2 : 4;
  return `≈ ${value.toLocaleString(undefined, { maximumFractionDigits: digits })} SWARM`;
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
