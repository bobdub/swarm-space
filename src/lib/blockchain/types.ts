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
  | "cross_chain_swap";

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
 * Costs 10,000 SWARM to deploy (funds go to community pool).
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

/** Coin deployment cost in SWARM (reduced for testing — restore to 10_000 for production) */
export const COIN_DEPLOY_COST = 10;

/** Swap ratio: sub-chain coins swap 1:1, but swapping TO SWARM costs 2:1 */
export const SWAP_RATIO_DEFAULT = 1;
export const SWAP_RATIO_TO_SWARM = 2;

/** Network pool mining tax (5%) */
export const POOL_MINING_TAX = 0.05;

export const SWARM_CONFIG: BlockchainConfig = {
  name: "Swarm-Space",
  ticker: "SWARM",
  decimals: 18,
  blockTime: 30000, // 30 seconds
  difficulty: 1, // TEMP: reduced for testing (restore to 4 for production)
  miningReward: 50,
  halvingInterval: 210000,
  maxSupply: 21000000,
  genesisTimestamp: new Date().toISOString(),
};
