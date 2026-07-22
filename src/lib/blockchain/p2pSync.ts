// P2P Blockchain Synchronization
import { SwarmBlock, SwarmTransaction, ChainState } from "./types";
import { getSwarmChain } from "./chain";
import { resolveFork } from "./chainHealthBridge";

import type { RewardPoolData } from "./storage";
import type { ProfileToken, CreatorVault } from "./types";
import type { ProfileTokenHolding } from "./profileTokenBalance";

export interface BlockchainSyncMessage {
  type: "blockchain_sync";
  action:
    | "request_chain"
    | "send_chain"
    | "new_block"
    | "new_transaction"
    | "reward_pool_update"
    | "request_reward_pool"
    | "request_profile_tokens"
    | "send_profile_tokens";
  data?: {
    chain?: SwarmBlock[];
    pendingTransactions?: SwarmTransaction[];
    block?: SwarmBlock;
    transaction?: SwarmTransaction;
    chainState?: ChainState;
    rewardPool?: RewardPoolData;
    profileTokens?: ProfileToken[];
    creatorVaults?: CreatorVault[];
    profileTokenHoldings?: ProfileTokenHolding[];
  };
  timestamp: number;
}

export class BlockchainP2PSync {
  private syncInterval?: number;
  private readonly SYNC_INTERVAL = 120000; // Sync every 2 minutes

  constructor(
    private broadcast: (type: string, payload: unknown) => void,
    private onBlockReceived?: (block: SwarmBlock) => void,
    private onChainReceived?: (chain: SwarmBlock[]) => void
  ) {
    console.log("[Blockchain P2P] Sync initialized");
  }

  /**
   * Start periodic blockchain synchronization
   */
  start(): void {
    if (this.syncInterval) {
      console.warn("[Blockchain P2P] Already running");
      return;
    }

    console.log("[Blockchain P2P] Starting periodic sync");
    
    // Immediate first sync request
    this.requestChainSync();
    this.requestRewardPoolSync();
    this.requestProfileTokenSync();

    // Then periodic sync
    this.syncInterval = window.setInterval(() => {
      this.requestChainSync();
      this.requestRewardPoolSync();
      this.requestProfileTokenSync();
    }, this.SYNC_INTERVAL);
  }

  /**
   * Stop synchronization
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
      console.log("[Blockchain P2P] Stopped");
    }
  }

  /**
   * Request blockchain state from peers
   */
  private requestChainSync(): void {
    const message: BlockchainSyncMessage = {
      type: "blockchain_sync",
      action: "request_chain",
      timestamp: Date.now(),
    };

    console.log("[Blockchain P2P] 📡 Requesting chain sync from peers");
    this.broadcast("blockchain", message);
  }

  /**
   * Broadcast new block to all peers
   */
  broadcastNewBlock(block: SwarmBlock): void {
    const message: BlockchainSyncMessage = {
      type: "blockchain_sync",
      action: "new_block",
      data: { block },
      timestamp: Date.now(),
    };

    console.log(`[Blockchain P2P] 📢 Broadcasting new block #${block.index} to network`);
    this.broadcast("blockchain", message);
  }

  /**
   * Broadcast new transaction to all peers
   */
  broadcastNewTransaction(transaction: SwarmTransaction): void {
    const message: BlockchainSyncMessage = {
      type: "blockchain_sync",
      action: "new_transaction",
      data: { transaction },
      timestamp: Date.now(),
    };

    console.log(`[Blockchain P2P] 📢 Broadcasting transaction ${transaction.id} to network`);
    this.broadcast("blockchain", message);
  }

  /**
   * Broadcast reward pool update to all peers
   */
  broadcastRewardPoolUpdate(rewardPool: RewardPoolData): void {
    const message: BlockchainSyncMessage = {
      type: "blockchain_sync",
      action: "reward_pool_update",
      data: { rewardPool },
      timestamp: Date.now(),
    };

    console.log(`[Blockchain P2P] 📢 Broadcasting reward pool update (balance: ${rewardPool.balance}) to network`);
    this.broadcast("blockchain", message);
  }

  /**
   * Request reward pool state from peers
   */
  requestRewardPoolSync(): void {
    const message: BlockchainSyncMessage = {
      type: "blockchain_sync",
      action: "request_reward_pool",
      timestamp: Date.now(),
    };

    console.log("[Blockchain P2P] 📡 Requesting reward pool sync from peers");
    this.broadcast("blockchain", message);
  }

  /** Request profile token / creator vault snapshots from peers. */
  requestProfileTokenSync(): void {
    const message: BlockchainSyncMessage = {
      type: "blockchain_sync",
      action: "request_profile_tokens",
      timestamp: Date.now(),
    };
    console.log("[Blockchain P2P] 📡 Requesting profile token sync from peers");
    this.broadcast("blockchain", message);
  }

  /**
   * Handle incoming blockchain sync message
   */
  async handleMessage(message: BlockchainSyncMessage, fromPeer: string): Promise<void> {
    if (message.type !== "blockchain_sync") {
      console.warn("[Blockchain P2P] Unknown message type:", message.type);
      return;
    }

    const chain = getSwarmChain();

    switch (message.action) {
      case "request_chain": {
        // Send our chain to requesting peer
        const localChain = chain.getChain();
        const pendingTransactions = chain.getPendingTransactions();
        const response: BlockchainSyncMessage = {
          type: "blockchain_sync",
          action: "send_chain",
          data: { chain: localChain, pendingTransactions },
          timestamp: Date.now(),
        };
        console.log(`[Blockchain P2P] 📤 Sending chain (${localChain.length} blocks, ${pendingTransactions.length} pending) to ${fromPeer}`);
        this.broadcast("blockchain", response);
        break;
      }

      case "send_chain": {
        if (!message.data?.chain) break;
        console.log(`[Blockchain P2P] 📥 Received chain from ${fromPeer}: ${message.data.chain.length} blocks`);
        
        const localChain = chain.getChain();
        const receivedChain = message.data.chain;

        // UQRC fork resolution — curvature-scored, NOT longest-chain.
        // The bridge falls back to longest-chain during cold-start (ticks<50).
        const decision = resolveFork(localChain, receivedChain);
        if (decision === 'replace') {
          console.log(
            `[Blockchain P2P] 🌀 Adopting peer chain (curvature geodesic): ${receivedChain.length} blocks vs local ${localChain.length}`,
          );
          if (this.onChainReceived) {
            this.onChainReceived(receivedChain);
          }
        } else {
          console.log(`[Blockchain P2P] 🛡 Rejected peer fork (curvature geodesic) — keeping local tip`);
        }

        if (message.data.pendingTransactions?.length) {
          const { applyMarketTransaction } = await import("./coinMarket");
          let acceptedPending = 0;
          for (const tx of message.data.pendingTransactions) {
            if (chain.hasTransaction(tx.id)) continue;
            try {
              chain.addTransaction(tx);
              await applyMarketTransaction(tx);
              acceptedPending++;
            } catch (error) {
              console.warn("[Blockchain P2P] Invalid pending transaction received:", error);
            }
          }
          if (acceptedPending > 0) {
            const { derivePoolFromChain } = await import("./storage");
            await derivePoolFromChain();
            console.log(`[Blockchain P2P] ✅ Accepted ${acceptedPending} peer pending transaction(s)`);
          }
        }
        break;
      }

      case "new_block": {
        if (!message.data?.block) break;
        const block = message.data.block;
        console.log(`[Blockchain P2P] 📥 Received new block #${block.index} from ${fromPeer}`);
        
        if (this.onBlockReceived) {
          this.onBlockReceived(block);
        }
        break;
      }

      case "new_transaction": {
        if (!message.data?.transaction) break;
        const tx = message.data.transaction;
        console.log(`[Blockchain P2P] 📥 Received new transaction ${tx.id} from ${fromPeer}`);
        
        // Add to pending transactions if valid
        try {
          if (!chain.hasTransaction(tx.id)) chain.addTransaction(tx);
          const { applyMarketTransaction } = await import("./coinMarket");
          await applyMarketTransaction(tx);
          const { derivePoolFromChain } = await import("./storage");
          await derivePoolFromChain();
        } catch (error) {
          console.warn("[Blockchain P2P] Invalid transaction received:", error);
        }
        break;
      }

      case "request_reward_pool": {
        // Send our reward pool state
        const { derivePoolFromChain } = await import("./storage");
        const pool = await derivePoolFromChain();
        if (pool) {
          const response: BlockchainSyncMessage = {
            type: "blockchain_sync",
            action: "reward_pool_update",
            data: { rewardPool: pool },
            timestamp: Date.now(),
          };
          console.log(`[Blockchain P2P] 📤 Sending reward pool (balance: ${pool.balance}) to ${fromPeer}`);
          this.broadcast("blockchain", response);
        }
        break;
      }

      case "reward_pool_update": {
        if (!message.data?.rewardPool) break;
        const receivedPool = message.data.rewardPool;
        console.log(`[Blockchain P2P] 📥 Received reward pool snapshot from ${fromPeer} (balance: ${receivedPool.balance}, height: ${receivedPool.lastTxHeight ?? '?'})`);

        // Consensus rule: the ledger is authoritative. Peer snapshots are only
        // useful when the peer has folded MORE blocks than we have — otherwise
        // ignore. Even when accepted, we immediately re-derive to guarantee
        // convergence.
        const { getRewardPool, saveRewardPool, derivePoolFromChain } = await import("./storage");
        const local = await getRewardPool();
        const localHeight = local?.lastTxHeight ?? -1;
        const receivedHeight = receivedPool.lastTxHeight ?? -1;
        const localPending = local?.pendingPoolTxCount ?? 0;
        const receivedPending = receivedPool.pendingPoolTxCount ?? 0;
        const sameHeightNewPending = receivedHeight === localHeight && receivedPending > localPending;

        if (!local) {
          if (!receivedPool.contributors) receivedPool.contributors = {};
          receivedPool.lastSyncedAt = new Date().toISOString();
          await saveRewardPool(receivedPool);
          console.log(`[Blockchain P2P] ✅ Adopted peer pool snapshot as cache (balance: ${receivedPool.balance})`);
        } else if (receivedHeight > localHeight || sameHeightNewPending) {
          if (!receivedPool.contributors) receivedPool.contributors = {};
          receivedPool.lastSyncedAt = new Date().toISOString();
          await saveRewardPool(receivedPool);
          console.log(`[Blockchain P2P] ✅ Warmed pool cache from peer (height ${localHeight} → ${receivedHeight}, pending ${localPending} → ${receivedPending})`);
          if (sameHeightNewPending) this.requestChainSync();
        } else {
          console.log(`[Blockchain P2P] ⇢ Peer snapshot older than ours (${receivedHeight} ≤ ${localHeight}) — ignoring`);
        }

        // Re-derive from ledger so the visible pool always matches the chain.
        try {
          await derivePoolFromChain();
        } catch (err) {
          console.warn("[Blockchain P2P] derivePoolFromChain failed:", err);
        }
        break;
      }

      case "request_profile_tokens": {
        const { getAllProfileTokens } = await import("./storage");
        const { getAll } = await import("../store");
        const [profileTokens, creatorVaults, profileTokenHoldings] = await Promise.all([
          getAllProfileTokens(),
          getAll<CreatorVault>("creatorVaults"),
          getAll<ProfileTokenHolding>("profileTokenHoldings"),
        ]);
        const response: BlockchainSyncMessage = {
          type: "blockchain_sync",
          action: "send_profile_tokens",
          data: { profileTokens, creatorVaults, profileTokenHoldings },
          timestamp: Date.now(),
        };
        console.log(
          `[Blockchain P2P] 📤 Sending ${profileTokens.length} tokens / ${creatorVaults.length} vaults / ${profileTokenHoldings.length} holdings to ${fromPeer}`,
        );
        this.broadcast("blockchain", response);
        break;
      }

      case "send_profile_tokens": {
        const data = message.data;
        if (!data) break;
        const { saveProfileToken, getProfileToken } = await import("./storage");
        const { saveCreatorVault, getCreatorVault } = await import("./creatorVault");
        const { saveProfileTokenHolding, getProfileTokenHolding } = await import(
          "./profileTokenBalance"
        );
        let addedTokens = 0;
        let addedVaults = 0;
        let addedHoldings = 0;
        for (const t of data.profileTokens ?? []) {
          if (!t?.userId) continue;
          const existing = await getProfileToken(t.userId);
          if (existing) continue; // never overwrite local
          await saveProfileToken(t);
          addedTokens++;
        }
        for (const v of data.creatorVaults ?? []) {
          if (!v?.tokenId) continue;
          const existing = await getCreatorVault(v.tokenId);
          if (existing) continue;
          await saveCreatorVault(v);
          addedVaults++;
        }
        for (const h of data.profileTokenHoldings ?? []) {
          if (!h?.userId || !h?.tokenId) continue;
          const existing = await getProfileTokenHolding(h.userId, h.tokenId);
          if (existing) continue;
          await saveProfileTokenHolding(h);
          addedHoldings++;
        }
        if (addedTokens || addedVaults || addedHoldings) {
          console.log(
            `[Blockchain P2P] ✅ Replicated ${addedTokens} tokens / ${addedVaults} vaults / ${addedHoldings} holdings from ${fromPeer}`,
          );
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("creator-vault-update", { detail: { source: "p2p" } }));
          }
        }
        break;
      }
    }
  }

  /**
   * Manual trigger sync
   */
  triggerSync(): void {
    console.log("[Blockchain P2P] Manual sync trigger");
    this.requestChainSync();
  }

  /**
   * Get sync statistics
   */
  getStats() {
    return {
      isRunning: this.syncInterval !== undefined,
      interval: this.SYNC_INTERVAL,
    };
  }
}
