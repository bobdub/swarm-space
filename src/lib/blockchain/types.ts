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
  | "post_extract_payments"
  | "creator_token_buy"
  | "creator_token_sell"
  | "creator_token_earnings_withdraw"
  | "creator_vault_split"
  | "coin_market_list"
  | "coin_market_reserve"
  | "coin_market_confirm_payment"
  | "coin_market_settle"
  | "coin_market_cancel"
  | "coin_market_dispute";

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
  /** When the creator market was permanently closed. Redeployment is blocked. */
  closedAt?: string;
  /** Reason for closure (creator-provided or "market_dissolved"). */
  closureReason?: string;
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

/** Creator token deployment baseline in credits at 100 SWARM community liquidity */
export const CREATOR_TOKEN_DEPLOY_COST = 25;

/** Creator token deployment baseline SWARM at 100 SWARM community liquidity */
export const CREATOR_TOKEN_SWARM_DEPLOY_COST = 5;

/**
 * Fraction of a Creator Token's max supply that is unlocked and marketable at
 * deployment. The remaining share unlocks gradually as the creator earns credits
 * (see `profileTokenUnlock.ts`). Used to align market availability with supply.
 */
export const CREATOR_TOKEN_INITIAL_UNLOCK_FRACTION = 0.4;

/**
 * Number of tokens the vault seeds to the creator on deployment as the first
 * "sale", backed by the 50 SWARM deployment fee.
 */
export const CREATOR_TOKEN_INITIAL_CREATOR_SEED = 100;

// ── Creator Vault Constants ────────────────────────────────────────────
/** Fraction of each purchase routed to the buyback reserve (liquid) */
export const CREATOR_VAULT_BUYBACK_SHARE = 0.40;
/** Preferred alias for the 40% bucket (Open Market / liquid liquidity). */
export const CREATOR_VAULT_OPEN_MARKET_SHARE = CREATOR_VAULT_BUYBACK_SHARE;
/** Fraction routed to the protected stability floor */
export const CREATOR_VAULT_STABILITY_SHARE = 0.40;
/** Fraction routed to withdrawable creator earnings */
export const CREATOR_VAULT_CREATOR_SHARE = 0.15;
/** Fraction routed to the SWARM community pool */
export const CREATOR_VAULT_COMMUNITY_SHARE = 0.05;

/** Bonding-curve base price (SWARM per token) */
export const CREATOR_TOKEN_BASE_PRICE = 0.1;
/** Bonding-curve slope */
export const CREATOR_TOKEN_PRICE_SLOPE = 0.001;

/** Fraction of totalDeposited that must remain in buyback reserve at all times */
export const CREATOR_VAULT_HARD_FLOOR = 0.05;

/**
 * Buyback ladder tiers. Each unlocks a share of the buyback reserve.
 * A tier is "active" when buybackReserve / max(totalDeposited, ε) crosses its threshold.
 */
export const CREATOR_BUYBACK_LADDER: Array<{
  tier: number;
  label: string;
  threshold: number; // reserve/totalDeposited ratio required
  unlockShare: number; // portion of reserve spendable per sell
}> = [
  { tier: 1, label: "Baseline", threshold: 0.05, unlockShare: 0.10 },
  { tier: 2, label: "Rising", threshold: 0.15, unlockShare: 0.25 },
  { tier: 3, label: "Strong", threshold: 0.25, unlockShare: 0.45 },
  { tier: 4, label: "High", threshold: 0.35, unlockShare: 0.70 },
  { tier: 5, label: "Maximum", threshold: 0.45, unlockShare: 0.90 },
];

/**
 * Creator Vault — backs a Creator Token's marketplace.
 * Every purchase splits 40/40/15/5 into these buckets.
 */
export interface CreatorVault {
  tokenId: string;
  creatorUserId: string;
  buybackReserve: number;      // 40% — liquid, funds buybacks
  stabilityFloor: number;      // 40% — protected, never spent
  creatorEarnings: number;     // 15% — withdrawable by creator
  communityContributed: number;// 5% — forwarded to community pool (display only)
  totalDeposited: number;      // lifetime SWARM in
  lifetimeBuybacks: number;    // lifetime SWARM paid out via sell-back
  circulatingSupply: number;   // tokens purchased − tokens sold back
  currentTier: number;         // 0 (none) … 5
  updatedAt: string;
  /** Marked true when the market is closed; blocks buy/sell/list. */
  closed?: boolean;
  /** ISO closure timestamp. */
  closedAt?: string;
}
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

// ── Coin Market — real-currency P2P sales of mined SWARM coins ─────────

export type CoinMarketCurrency = "ETH" | "BTC" | "MINTME";

export type CoinListingStatus =
  | "open"
  | "reserved"
  | "paid"
  | "settled"
  | "cancelled"
  | "disputed";

export interface CoinListing {
  listingId: string;
  sellerId: string;
  coinId: string;
  /** Market asset being sold. Undefined means legacy mined-coin listing. */
  assetType?: "swarm" | "coin";
  /** Amount of wallet SWARM held in market escrow for amount-based listings. */
  swarmAmount?: number;
  askAmount: number;
  askCurrency: CoinMarketCurrency;
  /**
   * Legacy external payout address. Optional in the app-wallet flow — proceeds
   * now credit the seller's in-app wallet and only leave via the MetaMask bridge.
   */
  receivingAddress?: string;
  memo?: string;
  status: CoinListingStatus;
  buyerId?: string;
  paymentTxHash?: string;
  reservedAt?: string;
  paidAt?: string;
  settledAt?: string;
  tier: number;
  createdAt: string;
  updatedAt: string;
}

/** Coin Market tier gates keyed on synced community-pool balance. */
export const COIN_MARKET_TIERS: Array<{
  tier: number;
  label: string;
  poolMinimum: number;
  maxOpenListings: number;
}> = [
  { tier: 1, label: "Seed",     poolMinimum: 0,      maxOpenListings: 1 },
  { tier: 2, label: "Growing",  poolMinimum: 100,    maxOpenListings: 5 },
  { tier: 3, label: "Active",   poolMinimum: 500,    maxOpenListings: 25 },
  { tier: 4, label: "Vibrant",  poolMinimum: 2_500,  maxOpenListings: 100 },
  { tier: 5, label: "Open",     poolMinimum: 10_000, maxOpenListings: Infinity },
];

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
  /** Crafted chemical payload — atoms condensed into the coin via the Forge. */
  wrappedChemicals?: { symbol: string; count: number }[];
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

// ── Participant Listings — user↔user Creator Token trades ─────────────

/** Portion of a participant trade routed to the Open Market bucket (95%). */
export const PARTICIPANT_TRADE_MARKET_SHARE = 0.95;
/** Portion of a participant trade routed to the community pool (5%). */
export const PARTICIPANT_TRADE_COMMUNITY_SHARE = 0.05;

export type ParticipantListingSide = "sell" | "buy";
export type ParticipantListingStatus = "open" | "filled" | "cancelled";

export interface ParticipantListing {
  listingId: string;
  tokenId: string;
  userId: string;
  side: ParticipantListingSide;
  /** Amount of Creator Tokens offered (sell) or requested (buy). */
  tokens: number;
  /** Price per token in SWARM. */
  pricePerToken: number;
  status: ParticipantListingStatus;
  createdAt: string;
  updatedAt: string;
  filledBy?: string;
  filledAt?: string;
}
