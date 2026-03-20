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
import { generateTransactionId } from "./crypto";
import { SWAP_RATIO_DEFAULT, SWAP_RATIO_TO_SWARM } from "./types";

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

export async function switchToCoin(coinId: string): Promise<ChainContext> {
  const coin = await getCoin(coinId);
  if (!coin || coin.status !== "active") {
    throw new Error("Coin not found or inactive");
  }
  const ctx: ChainContext = {
    chainId: coin.coinId,
    ticker: coin.ticker,
    chainName: coin.chainName,
    isMainChain: false,
  };
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
    return chain.getBalance(address);
  }

  for (const block of chain.getChain()) {
    for (const tx of block.transactions) scan(tx);
  }
  for (const tx of chain.getPendingTransactions()) scan(tx);

  return Math.max(0, balance);
}

// ── Cross-Chain Swap ──────────────────────────────────────────────────

export interface SwapParams {
  userId: string;
  fromChainId: string;
  fromTicker: string;
  toChainId: string;
  toTicker: string;
  amount: number;
}

export interface SwapResult {
  debitTx: SwarmTransaction;
  creditTx: SwarmTransaction;
  amountSent: number;
  amountReceived: number;
  ratio: number;
}

/**
 * Swap coins between blockchains.
 * - Sub-chain ↔ Sub-chain: 1:1
 * - Sub-chain → SWARM: 2:1 (pay 2 sub-chain coins to get 1 SWARM)
 * - SWARM → Sub-chain: 1:1 (1 SWARM = 1 sub-chain coin)
 */
export async function swapCrossChain(params: SwapParams): Promise<SwapResult> {
  const { userId, fromChainId, fromTicker, toChainId, toTicker, amount } = params;

  if (fromChainId === toChainId) throw new Error("Cannot swap to the same chain");
  if (amount <= 0) throw new Error("Amount must be positive");

  // Determine ratio
  const toSwarm = toChainId === "SWARM";
  const ratio = toSwarm ? SWAP_RATIO_TO_SWARM : SWAP_RATIO_DEFAULT;
  const amountReceived = amount / ratio;

  if (amountReceived < 0.01) throw new Error("Amount too small to swap");

  // Check source balance
  const srcBalance = await getChainBalance(userId, fromChainId);
  if (srcBalance < amount) {
    throw new Error(
      `Insufficient ${fromTicker} balance. Have ${srcBalance.toFixed(2)}, need ${amount}`
    );
  }

  const chain = getSwarmChain();
  const now = new Date().toISOString();

  // Debit on source chain
  const debitTx: SwarmTransaction = {
    id: generateTransactionId(),
    type: "cross_chain_swap",
    from: userId,
    to: `bridge:${toChainId}`,
    amount,
    timestamp: now,
    signature: `sig-${Date.now()}`,
    publicKey: userId,
    nonce: Date.now(),
    fee: 0,
    chainId: fromChainId,
    meta: {
      swapDirection: "debit",
      fromChain: fromTicker,
      toChain: toTicker,
      ratio,
      amountReceived,
    },
  };

  // Credit on destination chain
  const creditTx: SwarmTransaction = {
    id: generateTransactionId(),
    type: "cross_chain_swap",
    from: `bridge:${fromChainId}`,
    to: userId,
    amount: amountReceived,
    timestamp: now,
    signature: `sig-${Date.now()}`,
    publicKey: userId,
    nonce: Date.now() + 1,
    fee: 0,
    chainId: toChainId,
    meta: {
      swapDirection: "credit",
      fromChain: fromTicker,
      toChain: toTicker,
      ratio,
      amountSent: amount,
    },
  };

  chain.addTransaction(debitTx);
  chain.addTransaction(creditTx);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: debitTx }));
    window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: creditTx }));
    window.dispatchEvent(new CustomEvent("cross-chain-swap", { detail: { debitTx, creditTx } }));
  }

  console.log(
    `[Swap] ${amount} ${fromTicker} → ${amountReceived} ${toTicker} (${ratio}:1)`
  );

  return { debitTx, creditTx, amountSent: amount, amountReceived, ratio };
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
      chainTicker: info?.ticker ?? cid,
      chainName: info?.chainName ?? cid,
      direction,
      label: formatTxLabel(tx.type),
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
