/**
 * Community pool and Market Vault figures, read from the SWARM ledger alone.
 * Pure functions with no storage or network access, so every peer holding the
 * same blocks computes the same numbers.
 */
import type { SwarmBlock, SwarmTransaction } from "./types";
import { MARKET_VAULT_FLOOR_SHARE, type MarketVaultState } from "./marketVaultPricing";
import { isCustomTokenTip } from "./deposits/customTokenTips";

export const COMMUNITY_POOL = "community-pool";

function numberFrom(value: unknown, fallback = 0): number {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

export function poolDeltaFromTx(tx: SwarmTransaction): number {
  const meta = (tx.meta ?? {}) as Record<string, unknown>;
  switch (tx.type) {
    case "coin_deploy":
      return numberFrom(meta.poolContribution);
    case "pool_donate":
      return numberFrom(tx.amount);
    case "credit_lock":
      // Credit wrapping spends SWARM liquidity from the pool to the user.
      return -numberFrom(meta.swarmMinted, numberFrom(tx.amount));
    case "post_lock":
      return numberFrom(meta.poolContribution, numberFrom(meta.coinsToPool));
    case "creator_vault_split":
      return numberFrom(meta.communityShare);
    case "creator_token_buy": {
      const split = (meta.split ?? {}) as Record<string, unknown>;
      if (meta.liquidityTopUp === true && meta.communityForwarded !== undefined) return numberFrom(meta.communityForwarded);
      return numberFrom(split.community, numberFrom(meta.communityShare));
    }
    case "token_transfer":
      return meta.marketVault === true && meta.direction === "vault-sell" && tx.to === "community-pool" ? numberFrom(tx.amount) : 0;
    case "profile_token_deploy":
    case "creator_token_deploy":
      return numberFrom(meta.communityShare);
    case "creator_token_earnings_withdraw":
      return meta.closed === true ? numberFrom(meta.dissolved) : 0;
    case "mining_reward":
      // The pool's share of a block reward is the output paid to the pool.
      return tx.to === "community-pool" ? numberFrom(tx.amount) : numberFrom(meta.poolTax);
    default:
      return 0;
  }
}

export function isPoolAffectingTransaction(tx: SwarmTransaction): boolean {
  return poolDeltaFromTx(tx) !== 0;
}


function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}


/** The parts of the shared chain the vault figures read. */
export interface VaultLedgerSource {
  getChain(): SwarmBlock[];
  getPendingTransactions(): SwarmTransaction[];
  /** SWARM held in mined blocks only (matured rewards), leaving out this device's unmined entries. */
  getConfirmedBalance(address: string): number;
  /** Mined-block balance plus this device's unmined entries. */
  getBalance(address: string): number;
  getTotalSupply(): number;
}

/** Transactions in mined blocks: the ledger every peer on the same chain tip shares. */
export function confirmedTransactions(chain: Pick<VaultLedgerSource, "getChain">): SwarmTransaction[] {
  return chain.getChain().flatMap((block) => block.transactions ?? []);
}

// ── Vault totals ─────────────────────────────────────────────────────

/** Running vault figures over a ledger: pool SWARM, Credits reserve and token holdings. */
export interface VaultTotals {
  pool: number;
  credits: number;
  creditIds: Set<string>;
  /** Recorded holdings of the pool per ledger currency (for example MINTME:0x…). */
  tokens: Map<string, number>;
}

export const VAULT_CREDITS_CURRENCY = "CREDITS";

function emptyTotals(): VaultTotals {
  return { pool: 0, credits: 0, creditIds: new Set(), tokens: new Map() };
}

function cloneTotals(t: VaultTotals): VaultTotals {
  return { pool: t.pool, credits: t.credits, creditIds: new Set(t.creditIds), tokens: new Map(t.tokens) };
}

/** Fold one ledger entry into the vault totals. */
export function stepVaultTotals(t: VaultTotals, tx: SwarmTransaction): void {
  const delta = poolDeltaFromTx(tx);
  if (Number.isFinite(delta) && delta !== 0) t.pool = Math.max(0, t.pool + delta);

  const m = (tx.meta ?? {}) as Record<string, unknown>;
  // Credits reserve: Credits paid for vault buys and donated, minus Credits paid out.
  if (m.marketVault && !t.creditIds.has(tx.id)) {
    t.creditIds.add(tx.id);
    if (tx.type === "credit_lock" && tx.from === COMMUNITY_POOL && m.direction === "vault-buy" && m.paidAsset === "Credits") {
      t.credits += Math.max(0, Number(m.paidAmount ?? m.creditsLocked) || 0);
    } else if (tx.type === "custom_token_transfer" && m.currency === VAULT_CREDITS_CURRENCY) {
      const n = Math.max(0, Number(tx.amount) || 0);
      if (tx.to === COMMUNITY_POOL) t.credits += n;
      if (tx.from === COMMUNITY_POOL) t.credits -= n;
    }
  }

  // Token holdings recorded for the pool, the way a member's recorded token balance is read.
  if (typeof m.currency !== "string" || (tx.from !== COMMUNITY_POOL && tx.to !== COMMUNITY_POOL)) return;
  const amount = Number(tx.amount ?? 0);
  let change = 0;
  if (tx.type === "external_deposit" && tx.to === COMMUNITY_POOL) change = amount;
  else if (tx.type === "external_withdraw" && tx.from === COMMUNITY_POOL) change = -amount;
  else if (tx.type === "custom_token_transfer" || (tx.type === "wallet_tip" && isCustomTokenTip(tx))) {
    if (tx.from === COMMUNITY_POOL) change -= amount;
    if (tx.to === COMMUNITY_POOL) change += amount;
  }
  if (change !== 0 && Number.isFinite(change)) t.tokens.set(m.currency, (t.tokens.get(m.currency) ?? 0) + change);
}

/** Vault totals folded over any list of transactions, in ledger order. */
export function vaultTotalsOf(transactions: Iterable<SwarmTransaction>): VaultTotals {
  const totals = emptyTotals();
  for (const tx of transactions) stepVaultTotals(totals, tx);
  return totals;
}

export const vaultPool = (t: VaultTotals) => round6(t.pool);
export const vaultCredits = (t: VaultTotals) => Math.max(0, Math.floor(t.credits));
export const vaultTokenHeld = (t: VaultTotals, currency: string) => Math.max(0, Math.round((t.tokens.get(currency) ?? 0) * 1e8) / 1e8);

/**
 * Vault totals over mined blocks, kept per chain keyed by the tip's hash and
 * resumed from there as blocks are appended, rather than re-walked from genesis
 * on every refresh. A fork (the cached tip no longer in place) walks again.
 * The result is shared: callers must not change it.
 */
const confirmedCache = new WeakMap<object, { length: number; tipHash: string; totals: VaultTotals }>();

export function confirmedVaultTotals(chain: Pick<VaultLedgerSource, "getChain">): VaultTotals {
  const blocks = chain.getChain();
  const cached = confirmedCache.get(chain);
  let start = 0;
  let totals: VaultTotals;
  if (cached && blocks.length >= cached.length && cached.length > 0 && blocks[cached.length - 1]?.hash === cached.tipHash) {
    if (blocks.length === cached.length) return cached.totals;
    totals = cloneTotals(cached.totals);
    start = cached.length;
  } else {
    totals = emptyTotals();
  }
  for (let b = start; b < blocks.length; b++) for (const tx of blocks[b].transactions ?? []) stepVaultTotals(totals, tx);
  const tipHash = blocks[blocks.length - 1]?.hash;
  if (tipHash) confirmedCache.set(chain, { length: blocks.length, tipHash, totals });
  return totals;
}

/** Mined-block totals plus this device's unmined entries: what this device alone can see. */
export function localVaultTotals(chain: Pick<VaultLedgerSource, "getChain" | "getPendingTransactions">): VaultTotals {
  const totals = cloneTotals(confirmedVaultTotals(chain));
  for (const tx of chain.getPendingTransactions()) stepVaultTotals(totals, tx);
  return totals;
}

/**
 * SWARM the pool holds according to mined blocks: the smaller of the pool's
 * folded inflows and outflows and its spendable on-chain balance. Unmined
 * entries are left out because each device holds a different set of them
 * (trades are not gossiped and donations reach peers at different times),
 * which made every member see a different vault.
 */
export function sharedPoolBalance(chain: VaultLedgerSource): number {
  const folded = vaultPool(confirmedVaultTotals(chain));
  const onChain = chain.getConfirmedBalance(COMMUNITY_POOL);
  return round6(Math.max(0, Math.min(folded, Number.isFinite(onChain) ? onChain : 0)));
}

/**
 * SWARM the pool can release from this device right now: the shared balance,
 * lowered (never raised) by trades and wraps this device has made that are
 * not mined yet, so a member can't spend the same pool twice before a block.
 */
export function spendablePoolBalance(chain: VaultLedgerSource): number {
  const shared = sharedPoolBalance(chain);
  const local = Math.min(vaultPool(localVaultTotals(chain)), chain.getBalance(COMMUNITY_POOL));
  return round6(Math.max(0, Math.min(shared, Number.isFinite(local) ? local : 0)));
}

/** Vault (pool), floor, liquid and spot inputs every peer on the same chain tip agrees on. */
export function sharedMarketVaultState(chain: VaultLedgerSource): MarketVaultState {
  const poolBalance = sharedPoolBalance(chain);
  return { poolBalance, knownMined: Math.max(poolBalance, chain.getTotalSupply()) };
}

/**
 * Refuse a vault release this device can't make, before any payment is taken.
 * Prices come from the shared figures, but the SWARM paid out must sit above the
 * protected floor after this device's own unmined releases.
 */
export function assertVaultCanRelease(chain: VaultLedgerSource, state: MarketVaultState, swarm: number): void {
  const floor = Math.max(0, state.poolBalance) * MARKET_VAULT_FLOOR_SHARE;
  const free = Math.max(0, spendablePoolBalance(chain) - floor);
  if (swarm > free + 1e-9) {
    throw new Error(`The vault can release at most ${Math.floor(free * 1e4) / 1e4} SWARM from this device until your earlier trades are mined. Nothing was charged.`);
  }
}

/** This device's unmined Market Vault entries, which other members can't see until they are mined. */
export function unminedVaultTransactions(chain: Pick<VaultLedgerSource, "getPendingTransactions">): SwarmTransaction[] {
  return chain.getPendingTransactions().filter((tx) => {
    // A "system" entry is a local-only top-up that is never mined; it isn't a member's trade.
    if (tx.from === "system") return false;
    const meta = (tx.meta ?? {}) as Record<string, unknown>;
    return meta.marketVault === true || tx.to === COMMUNITY_POOL || tx.from === COMMUNITY_POOL;
  });
}
