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
  | "mining_reward";

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

export interface CrossChainBridge {
  id: string;
  sourceChain: "swarm-space" | "ethereum" | "polygon" | "bsc" | "custom";
  targetChain: "swarm-space" | "ethereum" | "polygon" | "bsc" | "custom";
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

export const SWARM_CONFIG: BlockchainConfig = {
  name: "Swarm-Space",
  ticker: "SWARM",
  decimals: 18,
  blockTime: 30000, // 30 seconds
  difficulty: 4,
  miningReward: 50,
  halvingInterval: 210000,
  maxSupply: 21000000,
  genesisTimestamp: new Date().toISOString(),
};
