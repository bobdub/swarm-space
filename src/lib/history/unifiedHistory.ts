/**
 * Unified transaction history: one read-only view over the off-chain Credits
 * store and the SWARM chain ledger. Each asset keeps its own records, balances
 * and rules; this module only normalises what already happened into one shape.
 *
 * Nothing here writes, migrates or re-derives balances. Mirrors that would make
 * one movement appear twice (credit_sync, the duplicate wrap debit, the same
 * chain transaction in pending and mined lists) are folded away.
 */
import type { CreditTransaction } from "@/types";
import type { SwarmTransaction } from "@/lib/blockchain/types";
import { NATIVE_MINTME_CUSTODY } from "@/lib/blockchain/wallets/nativeMintmeLedger";

export const CREDITS_ASSET = "CREDITS";

/** Where a movement is settled; shown as a badge so assets never look interchangeable. */
export type HistorySettlement = "off-chain" | "swarm-ledger" | "mintme" | "external";

export type HistoryKind =
  | "tip"
  | "transfer"
  | "deposit"
  | "withdrawal"
  | "reward"
  | "conversion"
  | "exchange"
  | "spend"
  | "other";

export type HistoryDirection = "in" | "out";

export interface HistoryLeg {
  /** Filter key, e.g. CREDITS, SWARM, MINTME, or a sub-chain ticker. */
  asset: string;
  /** Display ticker, e.g. Credits, SWARM. */
  ticker: string;
  amount: number;
  direction: HistoryDirection;
  settlement: HistorySettlement;
}

export interface UnifiedHistoryEntry {
  id: string;
  source: "credits" | "chain";
  kind: HistoryKind;
  label: string;
  timestamp: string;
  /** First leg is the primary movement; a conversion carries both sides. */
  legs: HistoryLeg[];
  counterparty?: string;
  note?: string;
  fee?: number;
  /** Original record type, kept for detail and debugging. */
  rawType: string;
}

export interface HistoryChainInfo {
  chainId: string;
  ticker: string;
}

const SYSTEM_PARTIES = new Set(["system", "community-pool", "genesis"]);
const WRAP_MATCH_WINDOW_MS = 5 * 60_000;

const short = (id: string) => (id.length > 12 ? `${id.slice(0, 8)}…` : id);

function creditLeg(amount: number, direction: HistoryDirection): HistoryLeg {
  return { asset: CREDITS_ASSET, ticker: "Credits", amount, direction, settlement: "off-chain" };
}

function creditKind(tx: CreditTransaction): HistoryKind {
  switch (tx.type) {
    case "tip":
    case "hype":
      return "tip";
    case "earned_post":
      return tx.meta?.description?.startsWith("Converted") ? "conversion" : "reward";
    case "earned_hosting":
    case "earned_achievement":
    case "achievement_reward":
      return "reward";
    case "transfer": {
      if (tx.meta?.wrapRequestId) return "conversion";
      const description = tx.meta?.description ?? "";
      if (description.startsWith("Market Vault")) return "exchange";
      if (SYSTEM_PARTIES.has(tx.toUserId)) return "spend";
      return "transfer";
    }
    default:
      return "other";
  }
}

function creditLabel(tx: CreditTransaction, incoming: boolean): string {
  const description = tx.meta?.description;
  switch (tx.type) {
    case "earned_post":
      if (tx.meta?.commentId) return "Comment reward";
      if (description?.includes("Genesis")) return "Genesis allocation";
      if (description?.startsWith("Converted") || description?.startsWith("Hype using")) return description;
      return "Post reward";
    case "earned_hosting":
      if (tx.meta?.transactions) return "Mining reward: transactions";
      if (tx.meta?.megabytesHosted) return "Mining reward: storage";
      return "Mining reward";
    case "earned_achievement":
    case "achievement_reward":
      return tx.meta?.achievementTitle ? `Achievement: ${tx.meta.achievementTitle}` : "Achievement reward";
    case "hype":
      return incoming ? "Hype received" : "Hyped a post";
    case "tip":
      return incoming ? "Tip received" : "Tip sent";
    case "transfer":
      if (tx.meta?.wrapRequestId) return "Wrapped Credits to SWARM";
      if (description?.includes("NFT")) return incoming ? "NFT sale" : "NFT purchase";
      if (SYSTEM_PARTIES.has(tx.toUserId)) return description ?? "Credits spent";
      return incoming ? "Transfer received" : "Transfer sent";
    default:
      return String(tx.type).replace(/_/g, " ");
  }
}

export function fromCreditTransaction(tx: CreditTransaction, userId: string): UnifiedHistoryEntry | null {
  const incoming = tx.toUserId === userId;
  if (!incoming && tx.fromUserId !== userId) return null;
  const direction: HistoryDirection = incoming ? "in" : "out";
  const otherParty = incoming ? tx.fromUserId : tx.toUserId;
  const notes: string[] = [];
  if (tx.meta?.burn) notes.push(`${tx.meta.burn} burned`);
  if (typeof tx.meta?.postLoad === "number" && tx.meta.postLoad > 0) notes.push(`${tx.meta.postLoad} loaded on post`);
  if ((tx.type === "tip" || tx.type === "transfer") && tx.meta?.description && !SYSTEM_PARTIES.has(tx.toUserId)
    && !tx.meta.wrapRequestId) notes.push(`“${tx.meta.description}”`);
  return {
    id: `credits:${tx.id}`,
    source: "credits",
    kind: creditKind(tx),
    label: creditLabel(tx, incoming),
    timestamp: tx.createdAt,
    legs: [creditLeg(tx.amount, direction)],
    counterparty: otherParty && !SYSTEM_PARTIES.has(otherParty) && otherParty !== userId ? otherParty : undefined,
    note: notes.length ? notes.join(" · ") : undefined,
    rawType: tx.type,
  };
}

function chainKind(tx: SwarmTransaction): HistoryKind {
  switch (tx.type) {
    case "wallet_tip":
      return tx.meta?.intent === "transfer" ? "transfer" : "tip";
    case "external_deposit":
      return "deposit";
    case "external_withdraw":
      return "withdrawal";
    case "mining_reward":
    case "reward_claim":
    case "mintme_community_payout":
      return "reward";
    case "credit_lock":
      return tx.meta?.marketVault ? "exchange" : "conversion";
    case "token_transfer":
    case "coin_transfer":
    case "nft_transfer":
      return "transfer";
    case "custom_token_transfer":
      return tx.meta?.marketVault ? "exchange" : "transfer";
    case "cross_chain_swap":
    case "creator_token_buy":
    case "creator_token_sell":
    case "coin_market_confirm_payment":
    case "coin_market_settle":
      return "exchange";
    case "pool_donate":
    case "coin_deploy":
    case "creator_token_deploy":
    case "profile_token_deploy":
    case "token_burn":
      return "spend";
    default:
      return "other";
  }
}

const CHAIN_LABELS: Record<string, string> = {
  external_deposit: "Deposit",
  external_withdraw: "Withdrawal",
  mining_reward: "Mining reward",
  reward_claim: "Reward claim",
  mintme_community_payout: "Community mining payout",
  token_transfer: "Transfer",
  coin_transfer: "Coin transfer",
  custom_token_transfer: "Token transfer",
  token_mint: "Mint",
  token_burn: "Burn",
  coin_deploy: "Coin deployment",
  pool_donate: "Pool donation",
  cross_chain_swap: "Cross-chain swap",
  nft_mint: "NFT mint",
  nft_transfer: "NFT transfer",
  achievement_wrap: "Achievement",
  creator_token_deploy: "Creator token deploy",
  profile_token_deploy: "Creator token deploy",
  creator_token_buy: "Creator token buy",
  creator_token_sell: "Creator token sell",
};

function chainLabel(tx: SwarmTransaction, direction: HistoryDirection): string {
  if (tx.type === "wallet_tip") {
    const transfer = tx.meta?.intent === "transfer";
    if (direction === "in") return transfer ? "Transfer received" : "Tip received";
    return transfer ? "Transfer sent" : "Tip sent";
  }
  if (tx.type === "credit_lock") {
    if (tx.meta?.marketVault) return tx.meta?.direction === "vault-sell" ? "Market Vault sale" : "Market Vault purchase";
    return "Wrapped Credits to SWARM";
  }
  if (tx.type === "external_deposit" && tx.meta?.mode === "sync") return "Deposit (balance sync)";
  return CHAIN_LABELS[tx.type] ?? tx.type.replace(/_/g, " ");
}

const metaString = (tx: SwarmTransaction, key: string) =>
  typeof tx.meta?.[key] === "string" && tx.meta[key] ? (tx.meta[key] as string) : undefined;

/** Creator-market records carry the SWARM paid in `amount` and the token quantity in `meta.tokens`. */
const isCreatorTrade = (tx: SwarmTransaction) => tx.type === "creator_token_buy" || tx.type === "creator_token_sell";

function chainAsset(tx: SwarmTransaction, chains: Map<string, HistoryChainInfo>): { asset: string; ticker: string } {
  // Only a wallet tip's ticker names the asset in `amount`; elsewhere it may describe another leg.
  const metaTicker = tx.type === "wallet_tip" ? metaString(tx, "ticker") : undefined;
  const currency = isCreatorTrade(tx) ? undefined : metaString(tx, "currency");
  if (metaTicker) return { asset: metaTicker.toUpperCase(), ticker: metaTicker };
  if (currency) {
    if (currency.startsWith("CREATOR:")) return { asset: currency.toUpperCase(), ticker: "Creator token" };
    const symbol = metaString(tx, "symbol") ?? currency;
    return { asset: currency.toUpperCase(), ticker: symbol };
  }
  const chainId = tx.chainId || "SWARM";
  const ticker = chains.get(chainId)?.ticker ?? chainId;
  return { asset: ticker.toUpperCase(), ticker };
}

/**
 * Settlement follows the record's own currency and custody, not just its type:
 * legacy SWARM↔MetaMask records move native SWARM, MintMe custody and MintMe
 * token withdrawals settle on MintMe, and anything else external (e.g. ETH) is
 * only an external record.
 */
function chainSettlement(tx: SwarmTransaction): HistorySettlement {
  if (tx.type !== "external_deposit" && tx.type !== "external_withdraw" && tx.type !== "external_reconcile") return "swarm-ledger";
  const currency = metaString(tx, "currency")?.toUpperCase();
  if (currency === "SWARM") return "swarm-ledger";
  if (tx.meta?.custody === NATIVE_MINTME_CUSTODY || currency === "MINTME" || metaString(tx, "contract")) return "mintme";
  return "external";
}

export function fromChainTransaction(
  tx: SwarmTransaction,
  userId: string,
  chains: Map<string, HistoryChainInfo> = new Map(),
): UnifiedHistoryEntry | null {
  // credit_sync only mirrors a Credits reward onto the chain; the Credits record is the movement.
  if (tx.type === "credit_sync") return null;
  if (tx.from !== userId && tx.to !== userId) return null;
  const direction: HistoryDirection =
    tx.to === userId || tx.from === "system" || tx.from.startsWith("bridge:") ? "in" : "out";
  const { asset, ticker } = chainAsset(tx, chains);
  const otherParty = direction === "in" ? tx.from : tx.to;
  const message = typeof tx.meta?.message === "string" && tx.meta.message ? `“${tx.meta.message}”` : undefined;
  return {
    id: `chain:${tx.id}`,
    source: "chain",
    kind: chainKind(tx),
    label: chainLabel(tx, direction),
    timestamp: tx.timestamp,
    legs: chainLegs(tx, { asset, ticker, amount: tx.amount ?? 0, direction, settlement: chainSettlement(tx) }),
    counterparty: otherParty && otherParty !== userId && !SYSTEM_PARTIES.has(otherParty) && !otherParty.startsWith("bridge:")
      ? otherParty : undefined,
    note: message,
    fee: tx.fee > 0 ? tx.fee : undefined,
    rawType: tx.type,
  };
}

function chainLegs(tx: SwarmTransaction, primary: HistoryLeg): HistoryLeg[] {
  const tokens = Number(tx.meta?.tokens);
  if (!isCreatorTrade(tx) || !(tokens > 0)) return [primary];
  const ticker = metaString(tx, "ticker") ?? "Creator token";
  const tokenId = metaString(tx, "tokenId");
  return [primary, {
    asset: tokenId ? `CREATOR:${tokenId}`.toUpperCase() : ticker.toUpperCase(),
    ticker,
    amount: tokens,
    direction: primary.direction === "in" ? "out" : "in",
    settlement: "swarm-ledger",
  }];
}

const isWrapRelease = (tx: SwarmTransaction) =>
  tx.type === "credit_lock" && !tx.meta?.marketVault && Number(tx.meta?.creditsLocked) > 0;

/**
 * Wrapping writes a `deductCredits` debit to "system" and a second debit carrying
 * `wrapRequestId` with the same description, while the balance moves once.
 * Keep the linked record and drop its unlinked twin.
 */
function dropDuplicateWrapDebits(credits: CreditTransaction[]): CreditTransaction[] {
  const linked = credits.filter(tx => tx.meta?.wrapRequestId);
  if (!linked.length) return credits;
  const used = new Set<string>();
  return credits.filter(tx => {
    if (tx.meta?.wrapRequestId || tx.toUserId !== "system" || tx.type !== "transfer") return true;
    const twin = linked.find(l => !used.has(l.id) && l.fromUserId === tx.fromUserId && l.amount === tx.amount
      && l.meta?.description === tx.meta?.description
      && Math.abs(Date.parse(l.createdAt) - Date.parse(tx.createdAt)) <= WRAP_MATCH_WINDOW_MS);
    if (!twin) return true;
    used.add(twin.id);
    return false;
  });
}

export interface BuildUnifiedHistoryInput {
  userId: string;
  credits: CreditTransaction[];
  chain: SwarmTransaction[];
  chains?: HistoryChainInfo[];
}

export function buildUnifiedHistory({ userId, credits, chain, chains = [] }: BuildUnifiedHistoryInput): UnifiedHistoryEntry[] {
  const chainMap = new Map(chains.map(c => [c.chainId, c]));
  const seenChain = new Set<string>();
  const chainTxs = chain.filter(tx => (seenChain.has(tx.id) ? false : (seenChain.add(tx.id), true)));
  const seenCredits = new Set<string>();
  const creditTxs = dropDuplicateWrapDebits(
    credits.filter(tx => (seenCredits.has(tx.id) ? false : (seenCredits.add(tx.id), true))),
  );

  // Pair each wrap's Credits debit with its SWARM pool release so it reads as one conversion.
  const releases = chainTxs.filter(tx => isWrapRelease(tx) && tx.to === userId);
  const pairedReleases = new Set<string>();
  const entries: UnifiedHistoryEntry[] = [];

  for (const tx of creditTxs) {
    const entry = fromCreditTransaction(tx, userId);
    if (!entry) continue;
    if (tx.meta?.wrapRequestId && entry.legs[0].direction === "out") {
      const at = Date.parse(tx.createdAt);
      const release = releases
        .filter(r => !pairedReleases.has(r.id) && Number(r.meta?.creditsLocked) === tx.amount
          && Math.abs(Date.parse(r.timestamp) - at) <= WRAP_MATCH_WINDOW_MS)
        .sort((a, b) => Math.abs(Date.parse(a.timestamp) - at) - Math.abs(Date.parse(b.timestamp) - at))[0];
      if (release) {
        pairedReleases.add(release.id);
        const swarm = fromChainTransaction(release, userId, chainMap);
        if (swarm) entry.legs.push(swarm.legs[0]);
      }
    }
    entries.push(entry);
  }

  for (const tx of chainTxs) {
    if (pairedReleases.has(tx.id)) continue;
    const entry = fromChainTransaction(tx, userId, chainMap);
    if (entry) entries.push(entry);
  }

  return entries.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export interface HistoryFilter {
  asset?: string;
  kind?: HistoryKind;
}

export function filterHistory(entries: UnifiedHistoryEntry[], { asset, kind }: HistoryFilter): UnifiedHistoryEntry[] {
  return entries.filter(e => (!asset || e.legs.some(l => l.asset === asset)) && (!kind || e.kind === kind));
}

/** Assets that appear in the history, Credits and SWARM first. */
export function historyAssets(entries: UnifiedHistoryEntry[]): { asset: string; ticker: string }[] {
  const map = new Map<string, string>();
  for (const e of entries) for (const l of e.legs) if (!map.has(l.asset)) map.set(l.asset, l.ticker);
  const rank = (a: string) => (a === CREDITS_ASSET ? 0 : a === "SWARM" ? 1 : 2);
  return [...map.entries()]
    .map(([asset, ticker]) => ({ asset, ticker }))
    .sort((a, b) => rank(a.asset) - rank(b.asset) || a.ticker.localeCompare(b.ticker));
}

export const HISTORY_KIND_LABELS: Record<HistoryKind, string> = {
  tip: "Tips",
  transfer: "Transfers",
  deposit: "Deposits",
  withdrawal: "Withdrawals",
  reward: "Rewards",
  conversion: "Conversions",
  exchange: "Trades",
  spend: "Spending",
  other: "Other",
};

export const SETTLEMENT_LABELS: Record<HistorySettlement, string> = {
  "off-chain": "Off-chain",
  "swarm-ledger": "SWARM ledger",
  mintme: "MintMe network",
  external: "External record",
};

export { short as shortParty };
