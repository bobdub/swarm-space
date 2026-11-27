/**
 * Multi-Chain Manager
 * ───────────────────
 * Manages the active blockchain context for the user.
 * Users can switch between SWARM (main chain) and any deployed coin chain
 * without disrupting their SWARM mesh connection.
 *
 * Mining targets ONLY the active chain.
 * Transactions are tagged with chainId.
 */

import type { DeployedCoin, SwarmTransaction } from "./types";
import { getActiveCoins, getCoin } from "./coinDeployment";
import { getSwarmChain } from "./chain";

// ── Active Chain State ────────────────────────────────────────────────

export interface ChainContext {
  /** "SWARM" for main chain, or coinId for a deployed sub-chain */
  chainId: string;
  ticker: string;
  chainName: string;
  isMainChain: boolean;
}

const MAIN_CHAIN: ChainContext = {
  chainId: "SWARM",
  ticker: "SWARM",
  chainName: "Swarm-Space",
  isMainChain: true,
};

let _activeChain: ChainContext = MAIN_CHAIN;

export function getActiveChain(): ChainContext {
  return _activeChain;
}

export function setActiveChain(ctx: ChainContext): void {
  _activeChain = ctx;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("active-chain-changed", { detail: ctx }));
  }
  console.log(`[MultiChain] Switched to ${ctx.chainName} (${ctx.ticker})`);
}

export function switchToMainChain(): void {
  setActiveChain(MAIN_CHAIN);
}

/** Looks up an active sub-chain's context without switching to it; null if gone or inactive. */
export async function resolveCoinChain(coinId: string): Promise<ChainContext | null> {
  const coin = await getCoin(coinId);
  if (!coin || coin.status !== "active") return null;
  return {
    chainId: coin.coinId,
    ticker: coin.ticker,
    chainName: coin.chainName,
    isMainChain: false,
  };
}

export async function switchToCoin(coinId: string): Promise<ChainContext> {
  const ctx = await resolveCoinChain(coinId);
  if (!ctx) {
    throw new Error("Coin not found or inactive");
  }
  setActiveChain(ctx);
  return ctx;
}

// ── Live Chains Registry ──────────────────────────────────────────────

export interface LiveChainInfo {
  chainId: string;
  ticker: string;
  chainName: string;
  isMainChain: boolean;
  deployer: string;
  status: string;
  totalSupply: number;
  maxSupply: number;
  deployedAt: string;
}

export async function getAllLiveChains(): Promise<LiveChainInfo[]> {
  const coins = await getActiveCoins();
  const chains: LiveChainInfo[] = [
    {
      chainId: "SWARM",
      ticker: "SWARM",
      chainName: "Swarm-Space",
      isMainChain: true,
      deployer: "system",
      status: "active",
      totalSupply: getSwarmChain().getTotalSupply(),
      maxSupply: 21_000_000,
      deployedAt: "Genesis",
    },
    ...coins.map((c) => ({
      chainId: c.coinId,
      ticker: c.ticker,
      chainName: c.chainName,
      isMainChain: false,
      deployer: c.deployerUserId,
      status: c.status,
      totalSupply: c.totalSupply,
      maxSupply: c.maxSupply,
      deployedAt: c.deployedAt,
    })),
  ];
  return chains;
}

// ── Per-chain Balance ─────────────────────────────────────────────────

/**
 * Get balance for a specific chain.
 * Main chain uses the SwarmChain ledger.
 * Sub-chains scan for transactions tagged with their chainId.
 */
export async function getChainBalance(address: string, chainId: string): Promise<number> {
  const chain = getSwarmChain();
  await chain.whenReady();
  let balance = 0;

  const scan = (tx: SwarmTransaction) => {
    const txChain = tx.chainId || "SWARM";
    if (txChain !== chainId) return;

    // For sub-chains, mining_reward and token_mint tagged with this chainId
    if (tx.to === address && tx.amount) balance += tx.amount;
    if (tx.from === address && tx.amount) balance -= tx.amount + tx.fee;
  };

  if (chainId === "SWARM") {
    // The shared-chain figure: what peers accept a signed tip against.
    return chain.getSpendableBalance(address);
  }

  // A mined coin keeps its balances on its own chain.
  const { hasCoinChain, openCoinChain } = await import("./coinChainMining");
  if (hasCoinChain(chainId)) {
    const coinChain = await openCoinChain(chainId).catch(() => null);
    return coinChain ? coinChain.getBalance(address) : 0;
  }

  for (const block of chain.getChain()) {
    for (const tx of block.transactions) scan(tx);
  }
  for (const tx of chain.getPendingTransactions()) scan(tx);

  return Math.max(0, balance);
}

// ── Transaction Log Helpers ───────────────────────────────────────────

export interface EnrichedTransaction extends SwarmTransaction {
  chainTicker: string;
  chainName: string;
  direction: "in" | "out" | "system";
  label: string;
}

/**
 * Get all transactions for a user across all chains, enriched with labels.
 */
export async function getEnrichedTransactions(
  userId: string,
  limit = 100
): Promise<EnrichedTransaction[]> {
  const chain = getSwarmChain();
  const liveChains = await getAllLiveChains();
  const chainMap = new Map(liveChains.map((c) => [c.chainId, c]));

  const allTx = chain
    .getChain()
    .flatMap((b) => b.transactions)
    .concat(chain.getPendingTransactions())
    .filter((tx) => tx.from === userId || tx.to === userId);

  const enriched: EnrichedTransaction[] = allTx.map((tx) => {
    const cid = tx.chainId || "SWARM";
    const info = chainMap.get(cid);
    const direction: "in" | "out" | "system" =
      tx.from === "system" || tx.from.startsWith("bridge:")
        ? "in"
        : tx.to === userId
          ? "in"
          : "out";

    return {
      ...tx,
      chainTicker: tx.type === "wallet_tip" ? String(tx.meta?.ticker ?? info?.ticker ?? cid) : info?.ticker ?? cid,
      chainName: info?.chainName ?? cid,
      direction,
      label: tx.type === "wallet_tip" ? (tx.meta?.intent === "transfer" ? "Transfer" : "Tip") : formatTxLabel(tx.type),
    };
  });

  return enriched
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

function formatTxLabel(type: string): string {
  const labels: Record<string, string> = {
    token_transfer: "Transfer",
    token_mint: "Mint",
    token_burn: "Burn",
    mining_reward: "Mining Reward",
    credit_lock: "Credit Lock",
    coin_deploy: "Coin Deployment",
    pool_donate: "Pool Donation",
    cross_chain_swap: "Cross-Chain Swap",
    nft_mint: "NFT Mint",
    nft_transfer: "NFT Transfer",
    achievement_wrap: "Achievement",
    reward_claim: "Reward Claim",
    creator_token_deploy: "Creator Token Deploy",
    credit_sync: "Credit Sync",
  };
  return labels[type] || type.replace(/_/g, " ").toUpperCase();
}
