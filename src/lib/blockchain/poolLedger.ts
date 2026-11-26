/**
 * Community pool and Market Vault figures, read from the SWARM ledger alone.
 * Pure functions with no storage or network access, so every peer holding the
 * same blocks computes the same numbers.
 */
import type { SwarmBlock, SwarmTransaction } from "./types";
import type { MarketVaultState } from "./marketVaultPricing";

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

/** Community pool balance folded from a list of transactions, in ledger order. */
export function poolFromTransactions(transactions: Iterable<SwarmTransaction>): number {
  let balance = 0;
  for (const tx of transactions) {
    const delta = poolDeltaFromTx(tx);
    if (!Number.isFinite(delta) || delta === 0) continue;
    balance = Math.max(0, balance + delta);
  }
  return round6(balance);
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

/** Mined blocks followed by this device's unmined entries: what this device alone can see. */
export function localTransactions(chain: Pick<VaultLedgerSource, "getChain" | "getPendingTransactions">): SwarmTransaction[] {
  return [...confirmedTransactions(chain), ...chain.getPendingTransactions()];
}

/**
 * SWARM the pool holds according to mined blocks: the smaller of the pool's
 * folded inflows and outflows and its spendable on-chain balance. Unmined
 * entries are left out because each device holds a different set of them
 * (trades are not gossiped and donations reach peers at different times),
 * which made every member see a different vault.
 */
export function sharedPoolBalance(chain: VaultLedgerSource): number {
  const folded = poolFromTransactions(confirmedTransactions(chain));
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
  const local = Math.min(poolFromTransactions(localTransactions(chain)), chain.getBalance(COMMUNITY_POOL));
  return round6(Math.max(0, Math.min(shared, Number.isFinite(local) ? local : 0)));
}

/** Vault (pool), floor, liquid and spot inputs every peer on the same chain tip agrees on. */
export function sharedMarketVaultState(chain: VaultLedgerSource): MarketVaultState {
  const poolBalance = sharedPoolBalance(chain);
  return { poolBalance, knownMined: Math.max(poolBalance, chain.getTotalSupply()) };
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
