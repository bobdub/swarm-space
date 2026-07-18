// Blockchain Storage Layer using IndexedDB
import { openDB } from "../store";
import type {
  ChainState,
  SwarmBlock,
  SwarmTokenBalance,
  NFTMetadata,
  CrossChainBridge,
  MiningSession,
  ProfileToken,
} from "./types";

const BLOCKCHAIN_STORE = "blockchain";
const TOKEN_BALANCE_STORE = "tokenBalances";
const NFT_STORE = "nfts";
const BRIDGE_STORE = "bridges";
const MINING_SESSION_STORE = "miningSessions";
const PROFILE_TOKEN_STORE = "profileTokens";
const REWARD_POOL_STORE = "rewardPool";

// Chain State
export async function getChainState(): Promise<ChainState | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOCKCHAIN_STORE, "readonly");
    const request = tx.objectStore(BLOCKCHAIN_STORE).get("chain-state");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveChainState(state: ChainState): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOCKCHAIN_STORE, "readwrite");
    const request = tx.objectStore(BLOCKCHAIN_STORE).put({ ...state, id: "chain-state" });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function saveBlock(block: SwarmBlock): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOCKCHAIN_STORE, "readwrite");
    const request = tx.objectStore(BLOCKCHAIN_STORE).put({ ...block, id: `block-${block.index}` });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Token Balances
export async function getTokenBalance(address: string): Promise<SwarmTokenBalance | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TOKEN_BALANCE_STORE, "readonly");
    const request = tx.objectStore(TOKEN_BALANCE_STORE).get(address);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveTokenBalance(balance: SwarmTokenBalance): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TOKEN_BALANCE_STORE, "readwrite");
    const request = tx.objectStore(TOKEN_BALANCE_STORE).put({ ...balance, id: balance.address });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// NFTs
export async function getNFT(tokenId: string): Promise<NFTMetadata | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NFT_STORE, "readonly");
    const request = tx.objectStore(NFT_STORE).get(tokenId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveNFT(nft: NFTMetadata): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NFT_STORE, "readwrite");
    const request = tx.objectStore(NFT_STORE).put({ ...nft, id: nft.tokenId });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getNFTsByOwner(owner: string): Promise<NFTMetadata[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NFT_STORE, "readonly");
    const store = tx.objectStore(NFT_STORE);
    const request = store.getAll();
    
    request.onsuccess = () => {
      const allNFTs = request.result as NFTMetadata[];
      // Would use an index in production
      const ownerNFTs = allNFTs.filter(nft => nft.minter === owner);
      resolve(ownerNFTs);
    };
    request.onerror = () => reject(request.error);
  });
}

// Bridges
export async function getBridge(bridgeId: string): Promise<CrossChainBridge | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BRIDGE_STORE, "readonly");
    const request = tx.objectStore(BRIDGE_STORE).get(bridgeId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveBridge(bridge: CrossChainBridge): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BRIDGE_STORE, "readwrite");
    const request = tx.objectStore(BRIDGE_STORE).put({ ...bridge, id: bridge.id });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getAllBridges(): Promise<CrossChainBridge[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BRIDGE_STORE, "readonly");
    const request = tx.objectStore(BRIDGE_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// Mining Sessions
export async function getMiningSession(userId: string): Promise<MiningSession | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MINING_SESSION_STORE, "readonly");
    const request = tx.objectStore(MINING_SESSION_STORE).get(userId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveMiningSession(session: MiningSession): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MINING_SESSION_STORE, "readwrite");
    const request = tx.objectStore(MINING_SESSION_STORE).put({ ...session, id: session.userId });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Profile Token Storage
export async function saveProfileToken(token: ProfileToken): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILE_TOKEN_STORE, "readwrite");
    const request = tx.objectStore(PROFILE_TOKEN_STORE).put({ ...token, id: token.userId });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getProfileToken(userId: string): Promise<ProfileToken | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILE_TOKEN_STORE, "readonly");
    const request = tx.objectStore(PROFILE_TOKEN_STORE).get(userId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllProfileTokens(): Promise<ProfileToken[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILE_TOKEN_STORE, "readonly");
    const request = tx.objectStore(PROFILE_TOKEN_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// Reward Pool Storage
export interface RewardPoolData {
  id: string;
  balance: number;
  totalContributed: number;
  lastUpdated: string;
  contributors: Record<string, number>; // userId -> total donated
  /** ISO timestamp of the last chain-derived recompute or peer sync. */
  lastSyncedAt?: string;
  /** Height of the last block folded into this snapshot. */
  lastTxHeight?: number;
}

export async function getRewardPool(): Promise<RewardPoolData | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REWARD_POOL_STORE, "readonly");
    const request = tx.objectStore(REWARD_POOL_STORE).get("global");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveRewardPool(pool: RewardPoolData): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REWARD_POOL_STORE, "readwrite");
    const request = tx.objectStore(REWARD_POOL_STORE).put(pool);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Derive the community pool from the SWARM ledger. This is the authoritative
 * computation — all peers with the same ledger produce the same pool.
 *
 * Included flows (all increment):
 *   • coin_deploy — 5 000 SWARM to the pool (meta.poolContribution)
 *   • pool_donate — full amount
 *   • credit_lock — full amount (credits wrapped into SWARM)
 *   • post_lock — walled-post fee minus content coin (meta.poolContribution)
 *   • creator_vault_split — 5% community share (meta.communityShare)
 *   • mining_reward — 5% tax (meta.poolTax) if present
 */
export async function derivePoolFromChain(): Promise<RewardPoolData> {
  // Local import to avoid a cycle at module init.
  const { getSwarmChain } = await import("./chain");
  const chain = getSwarmChain();
  const blocks = chain.getChain();

  const contributors: Record<string, number> = {};
  let balance = 0;
  let totalContributed = 0;
  let lastTxHeight = 0;

  for (const block of blocks) {
    lastTxHeight = Math.max(lastTxHeight, block.index);
    for (const tx of block.transactions ?? []) {
      const meta = (tx.meta ?? {}) as Record<string, unknown>;
      let delta = 0;
      switch (tx.type) {
        case "coin_deploy":
          delta = Number(meta.poolContribution ?? 0);
          break;
        case "pool_donate":
          delta = Number(tx.amount ?? 0);
          break;
        case "credit_lock":
          delta = Number(tx.amount ?? 0);
          break;
        case "post_lock":
          delta = Number(meta.poolContribution ?? 0);
          break;
        case "creator_vault_split":
          delta = Number(meta.communityShare ?? 0);
          break;
        case "mining_reward":
          delta = Number(meta.poolTax ?? 0);
          break;
        default:
          delta = 0;
      }
      if (!isFinite(delta) || delta <= 0) continue;
      balance += delta;
      totalContributed += delta;
      if (tx.from && tx.from !== "system") {
        contributors[tx.from] = (contributors[tx.from] ?? 0) + delta;
      }
    }
  }

  const now = new Date().toISOString();
  const pool: RewardPoolData = {
    id: "global",
    balance: Math.round(balance * 1e6) / 1e6,
    totalContributed: Math.round(totalContributed * 1e6) / 1e6,
    contributors,
    lastUpdated: now,
    lastSyncedAt: now,
    lastTxHeight,
  };
  await saveRewardPool(pool);
  try {
    window.dispatchEvent(new CustomEvent("reward-pool-update", { detail: pool }));
  } catch {
    /* non-browser */
  }
  return pool;
}
