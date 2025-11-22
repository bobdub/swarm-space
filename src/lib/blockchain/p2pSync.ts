// P2P Blockchain Synchronization
import { SwarmBlock, SwarmTransaction, ChainState } from "./types";
import { getSwarmChain } from "./chain";

export interface BlockchainSyncMessage {
  type: "blockchain_sync";
  action: "request_chain" | "send_chain" | "new_block" | "new_transaction";
  data?: {
    chain?: SwarmBlock[];
    block?: SwarmBlock;
    transaction?: SwarmTransaction;
    chainState?: ChainState;
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

    // Then periodic sync
    this.syncInterval = window.setInterval(() => {
      this.requestChainSync();
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
        const response: BlockchainSyncMessage = {
          type: "blockchain_sync",
          action: "send_chain",
          data: { chain: localChain },
          timestamp: Date.now(),
        };
        console.log(`[Blockchain P2P] 📤 Sending chain (${localChain.length} blocks) to ${fromPeer}`);
        this.broadcast("blockchain", response);
        break;
      }

      case "send_chain": {
        if (!message.data?.chain) break;
        console.log(`[Blockchain P2P] 📥 Received chain from ${fromPeer}: ${message.data.chain.length} blocks`);
        
        const localChain = chain.getChain();
        const receivedChain = message.data.chain;

        // If received chain is longer and valid, consider replacing
        if (receivedChain.length > localChain.length) {
          console.log(`[Blockchain P2P] Received longer chain (${receivedChain.length} vs ${localChain.length})`);
          if (this.onChainReceived) {
            this.onChainReceived(receivedChain);
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
          chain.addTransaction(tx);
        } catch (error) {
          console.warn("[Blockchain P2P] Invalid transaction received:", error);
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
