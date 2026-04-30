// Swarm-Space Blockchain Core Types

export interface SwarmBlock {
  index: number;
  timestamp: string;
  transactions: SwarmTransaction[];
  previousHash: string;
  hash: string;
  nonce: number;
  difficulty: number;
  miner?: string;
  merkleRoot: string;
}

export type TransactionType = 
  | "token_transfer"
  | "token_mint"
  | "token_burn"
  | "nft_mint"
  | "nft_transfer"
  | "nft_burn"
  | "achievement_wrap"
  | "badge_wrap"
  | "reward_claim"
  | "mining_reward"
  | "profile_token_deploy"
  | "creator_token_deploy"
  | "coin_deploy"
  | "pool_donate"
  | "credit_lock"
  | "credit_sync"
  | "cross_chain_swap"
  | "token_wrap"
  | "token_extract"
  | "post_lock"
  | "post_unlock"
  | "post_extract_payments";

export interface SwarmTransaction {
  id: string;
  type: TransactionType;
  from: string;
  to: string;
  amount?: number;
  tokenId?: string;
  nftData?: NFTMetadata;
  timestamp: string;
  signature: string;
  publicKey: string;
  nonce: number;
  fee: number;
  meta?: Record<string, unknown>;
  /** Which blockchain this transaction belongs to. Defaults to "SWARM" (main chain). */
  chainId?: string;
}

export interface NFTMetadata {
  tokenId: string;
  name: string;
  description: string;
  image?: string;
  mediaManifestId?: string;
  mediaMime?: string;
  mediaName?: string;
  attributes: NFTAttribute[];
  achievementId?: string;
  badgeId?: string;
  rarity?: string;
  mintedAt: string;
  minter: string;
}

export interface NFTAttribute {
  trait_type: string;
  value: string | number;
  display_type?: "number" | "boost_number" | "boost_percentage" | "date";
}

export interface SwarmTokenBalance {
  address: string;
  balance: number;
  locked: number;
  available: number;
  nfts: string[];
  lastUpdated: string;
}

export interface MiningSession {
  id: string;
  userId: string;
  startedAt: string;
  endedAt?: string;
  blocksFound: number;
  totalReward: number;
  hashRate: number;
  status: "active" | "paused" | "completed";
}

/**
 * Creator Token — one per account, max 10,000 supply.
 * Tied to the user's identity on the SWARM blockchain.
 */
export interface CreatorToken {
  tokenId: string;
  userId: string;
  name: string;
  ticker: string;
  supply: number;
  maxSupply: number;
  deployedAt: string;
  contractAddress?: string;
  description?: string;
  image?: string;
}

/** @deprecated Use CreatorToken — kept for backward compatibility */
export type ProfileToken = CreatorToken;

/**
 * Deployed Coin — a user-created sub-chain cross-linked to SWARM.
 * Costs 10,000 SWARM to deploy:
 *   - 5,000 locked as liquidity (gives the coin intrinsic floor value)
 *   - 5,000 sent to the community pool
 */
export interface DeployedCoin {
  coinId: string;
  deployerUserId: string;
  chainName: string;
  ticker: string;
  projectGoal: string;
  totalSupply: number;
  maxSupply: number;
  deployedAt: string;
  deploymentTxId: string;
  status: "active" | "paused" | "retired";
  /** Cross-chain bridge back to SWARM */
  bridgeAddress: string;
  /** SWARM locked as liquidity backing — gives the coin floor value */
  lockedLiquidity: number;
}

export interface CrossChainBridge {
  id: string;
  sourceChain: "swarm-space" | "ethereum" | "polygon" | "bsc" | "custom" | string;
  targetChain: "swarm-space" | "ethereum" | "polygon" | "bsc" | "custom" | string;
  tokenAddress?: string;
  bridgeContract?: string;
  status: "active" | "pending" | "completed" | "failed";
  amount: number;
  fee: number;
  timestamp: string;
}

export interface BlockchainConfig {
  name: "Swarm-Space";
  ticker: "SWARM";
  decimals: 18;
  blockTime: number;
  difficulty: number;
  miningReward: number;
  halvingInterval: number;
  maxSupply: number;
  genesisTimestamp: string;
}

export interface ChainState {
  chain: SwarmBlock[];
  pendingTransactions: SwarmTransaction[];
  difficulty: number;
  miningReward: number;
  totalSupply: number;
  circulatingSupply: number;
  lastBlockTime: string;
}

// ── Economics Constants ────────────────────────────────────────────────

/** 100 credits lock into 1 SWARM token via the community pool */
export const CREDIT_TO_SWARM_RATIO = 100;

/** Creator token max supply per account */
export const CREATOR_TOKEN_MAX_SUPPLY = 10_000;

/** Creator token deployment cost in credits */
export const CREATOR_TOKEN_DEPLOY_COST = 1_000;

/** Coin deployment cost in SWARM */
export const COIN_DEPLOY_COST = 10_000;

/** Half of coin deployment cost is locked as liquidity backing */
export const COIN_LIQUIDITY_LOCK = 5_000;

/** Half of coin deployment cost goes to the community pool */
export const COIN_POOL_CONTRIBUTION = 5_000;

/** Swap ratio: sub-chain coins swap 1:1, but swapping TO SWARM costs 2:1 */
export const SWAP_RATIO_DEFAULT = 1;
export const SWAP_RATIO_TO_SWARM = 2;

/** Creator tokens swap 1:1 with credits, 10:1 for SWARM */
export const TOKEN_TO_CREDIT_RATIO = 1;
export const TOKEN_TO_SWARM_RATIO = 10;

/** Pool must hold requestedAmount + 1 SWARM for token→SWARM swaps */
export const POOL_SURPLUS_REQUIREMENT = 1;

/** Network pool mining tax (5%) — also seeds empty coins into pool */
export const POOL_MINING_TAX = 0.05;

// ── Literal Wrap Constants ─────────────────────────────────────────────

/** Maximum metadata weight a single SWARM coin can carry */
export const COIN_MAX_WEIGHT = 100;

/** Weight cost per token unit wrapped */
export const TOKEN_WEIGHT_UNIT = 1;

/** Fixed metadata overhead per wrap operation */
export const WRAP_METADATA_OVERHEAD = 5;

// ── Walled Post Constants ──────────────────────────────────────────────

/** SWARM coins required to lock a post behind an encrypted wall */
export const WALLED_POST_SWARM_FEE = 5;

/** Number of coins used to wrap the post content metadata */
export const WALLED_POST_CONTENT_COIN_COUNT = 1;

/** Remaining coins sent to the community pool */
export const WALLED_POST_POOL_COINS = 4;

/**
 * Walled Post Lock — represents a post locked behind an encrypted paywall.
 * The content metadata is wrapped inside a SWARM coin; viewers pay tokens to unlock.
 */
export interface WalledPostLock {
  postId: string;
  coinId: string;
  creatorId: string;
  unlockCostTokenId: string;
  unlockCostTicker: string;
  unlockCostAmount: number;
  lockedManifestIds: string[];
  lockedContentHash: string;
  extractionNeeded: boolean;
  createdAt: string;
}

// ── SwarmCoin — Mined-Only Coin Model ──────────────────────────────────

/**
 * Represents a SWARM coin that exists ONLY through mining.
 * Coins are never minted — only mined via CREATOR Proof.
 * Tokens (minted items) can be wrapped inside coins as metadata payloads.
 */
export interface SwarmCoin {
  coinId: string;
  /** Current wrapped payload weight (0 = empty coin) */
  weight: number;
  /** Maximum payload capacity */
  maxWeight: number;
  /** Token payloads currently wrapped inside this coin */
  wrappedTokens: WrappedTokenPayload[];
  /** Who currently holds this coin */
  ownerId: string;
  /** Whether the coin is in the community pool or a user's wallet */
  status: "pool" | "wallet";
  /** Temporarily tagged during shuffle selection to avoid re-checking */
  checkedForWrap?: boolean;
  /** When this coin was mined */
  minedAt: string;
  /** The block in which this coin was mined */
  minedInBlock?: number;
  // ── Weighted-Coin UQRC Lifecycle (scaffold) ──────────────────────────
  // SCAFFOLD STAGE — fields are optional so existing coins remain valid.
  // The 4 Hz fill scheduler and seal pipeline land in a follow-up patch;
  // for now these fields are read by UI and written by the binding API
  // only. See docs/WEIGHTED_COINS_UQRC.md for the full state machine.
  /** UQRC lifecycle phase. Absent ⇒ legacy coin (treat as `pool`/`sealed`). */
  fillState?: "pool" | "bound" | "filling" | "sealed" | "spent";
  /** Normalized fill progress in [0,1] driven by accrued field stress. */
  fill?: number;
  /** First-artifact NFT bound to this coin — the immutable seed. */
  firstArtifactNftId?: string;
  /** Cumulative ‖[D_μ,D_ν]‖ + entropy gradient sampled into this coin. */
  stressAccrued?: number;
  /** ISO timestamp at which the coin crystallized (fill ≥ 1, immutable). */
  sealedAt?: string;
}

/**
 * Token payload embedded inside a SWARM coin via Literal Wrap.
 * Tokens are always minted items — never coins.
 */
export interface WrappedTokenPayload {
  tokenId: string;
  ticker: string;
  amount: number;
  wrappedAt: string;
  wrappedBy: string;
  /** Original creator of the token — used for attribution on extraction */
  creatorUserId?: string;
}

export const SWARM_CONFIG: BlockchainConfig = {
  name: "Swarm-Space",
  ticker: "SWARM",
  decimals: 18,
  blockTime: 30000, // 30 seconds
  difficulty: 4,
  miningReward: 50,
  halvingInterval: 210000,
  maxSupply: 21000000,
  genesisTimestamp: '2025-01-01T00:00:00.000Z',
};
