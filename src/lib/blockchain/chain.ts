// Swarm-Space Blockchain Implementation
import { SwarmBlock, SwarmTransaction, ChainState, SWARM_CONFIG } from "./types";
import { calculateHash, calculateMerkleRoot } from "./crypto";
import { getChainState, saveChainState, saveBlock } from "./storage";
import { recordBlockAccepted, bootstrapChainBridge } from "./chainHealthBridge";

export class SwarmChain {
  private chain: SwarmBlock[] = [];
  private pendingTransactions: SwarmTransaction[] = [];
  private difficulty: number = SWARM_CONFIG.difficulty;
  private miningReward: number = SWARM_CONFIG.miningReward;
  private _ready: Promise<void>;
  private _dirty = false;
  private _flushScheduled = false;

  constructor() {
    this._ready = this.loadChain();
    this._setupUnloadFlush();
  }

  /** Wait for the chain to finish loading from IndexedDB */
  whenReady(): Promise<void> {
    return this._ready;
  }

  private _setupUnloadFlush(): void {
    // Flush on page hide (works on mobile & desktop)
    const flush = () => {
      if (this._dirty) {
        this._syncFlush();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
      });
      window.addEventListener("beforeunload", flush);
      // HMR support: Vite fires this before module replacement
      if (import.meta.hot) {
        import.meta.hot.dispose(() => {
          flush();
        });
      }
    }
  }

  /**
   * Synchronous best-effort flush using navigator.sendBeacon trick:
   * We serialize state into localStorage as a "dirty snapshot" that
   * gets picked up on next load if the async write didn't complete.
   */
  private _syncFlush(): void {
    try {
      const state: ChainState = this._buildState();
      localStorage.setItem(
        "__swarm_chain_snapshot",
        JSON.stringify(state)
      );
      this._dirty = false;
    } catch {
      // localStorage might be full or unavailable — best effort
    }
  }

  private async loadChain(): Promise<void> {
    // First, try to recover from sync snapshot (written on unload)
    let snapshot: ChainState | null = null;
    try {
      const raw = localStorage.getItem("__swarm_chain_snapshot");
      if (raw) {
        snapshot = JSON.parse(raw) as ChainState;
        localStorage.removeItem("__swarm_chain_snapshot");
      }
    } catch {
      // ignore parse errors
    }

    const state = await getChainState();

    // Pick whichever has more blocks (the snapshot may be newer)
    const best =
      snapshot && state
        ? snapshot.chain.length >= state.chain.length
          ? snapshot
          : state
        : snapshot || state;

    if (best) {
      this.chain = best.chain;
      this.pendingTransactions = best.pendingTransactions;
      this.difficulty = best.difficulty;
      this.miningReward = best.miningReward;
      // If we recovered from snapshot, persist it properly to IndexedDB
      if (best === snapshot) {
        await this.persistState();
      }
    } else {
      // Create genesis block
      this.chain = [await this.createGenesisBlock()];
      await this.persistState();
    }

    // Pin the current tip into the UQRC field as a smoothed reward-axis anchor.
    try { bootstrapChainBridge(this.getLatestBlock() ?? null); } catch { /* non-fatal */ }
  }

  private async createGenesisBlock(): Promise<SwarmBlock> {
    const genesisTransactions: SwarmTransaction[] = [];
    const block: SwarmBlock = {
      index: 0,
      timestamp: SWARM_CONFIG.genesisTimestamp, // deterministic hardcoded genesis
      transactions: genesisTransactions,
      previousHash: "0",
      hash: "",
      nonce: 0,
      difficulty: this.difficulty,
      merkleRoot: await calculateMerkleRoot(genesisTransactions),
    };
    block.hash = await calculateHash(block);
    return block;
  }

  getLatestBlock(): SwarmBlock {
    return this.chain[this.chain.length - 1];
  }

  addTransaction(transaction: SwarmTransaction): void {
    if (!this.isValidTransaction(transaction)) {
      throw new Error("Invalid transaction");
    }
    this.pendingTransactions.push(transaction);
    this._markDirtyAndScheduleFlush();
  }

  /** Mark state dirty and schedule an async flush (debounced) */
  private _markDirtyAndScheduleFlush(): void {
    this._dirty = true;
    if (this._flushScheduled) return;
    this._flushScheduled = true;
    // Microtask flush — runs before paint but after current sync code
    Promise.resolve().then(async () => {
      this._flushScheduled = false;
      if (this._dirty) {
        await this.persistState();
      }
    });
  }

  async minePendingTransactions(minerAddress: string, chainId?: string): Promise<SwarmBlock | null> {
    if (this.pendingTransactions.length === 0) {
      return null;
    }

    const resolvedChainId = chainId || "SWARM";

    // Add mining reward transaction tagged with chain
    const rewardTransaction: SwarmTransaction = {
      id: `reward-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: "mining_reward",
      from: "system",
      to: minerAddress,
      amount: this.miningReward,
      timestamp: new Date().toISOString(),
      signature: "",
      publicKey: "",
      nonce: 0,
      fee: 0,
      chainId: resolvedChainId,
      meta: { reward: true, chainId: resolvedChainId },
    };

    const transactions = [...this.pendingTransactions, rewardTransaction];
    const block: SwarmBlock = {
      index: this.chain.length,
      timestamp: new Date().toISOString(),
      transactions,
      previousHash: this.getLatestBlock().hash,
      hash: "",
      nonce: 0,
      difficulty: this.difficulty,
      miner: minerAddress,
      merkleRoot: await calculateMerkleRoot(transactions),
    };

    const minedBlock = await this.mineBlock(block);
    this.chain.push(minedBlock);
    await saveBlock(minedBlock);

    // Notify the UQRC bridge so the smoothed tip pin advances.
    try { recordBlockAccepted(minedBlock); } catch { /* non-fatal */ }

    // Clear pending transactions
    this.pendingTransactions = [];
    
    // Check for halving
    if (this.chain.length % SWARM_CONFIG.halvingInterval === 0) {
      this.miningReward = this.miningReward / 2;
    }

    await this.persistState();
    return minedBlock;
  }

  private async mineBlock(block: SwarmBlock): Promise<SwarmBlock> {
    const target = "0".repeat(block.difficulty);
    
    while (true) {
      block.hash = await calculateHash(block);
      if (block.hash.substring(0, block.difficulty) === target) {
        break;
      }
      block.nonce++;
      
      // Allow async breathing room
      if (block.nonce % 1000 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    return block;
  }

  isValidTransaction(transaction: SwarmTransaction): boolean {
    // Basic validation
    if (!transaction.id || !transaction.type || !transaction.from || !transaction.to) {
      return false;
    }
    if (transaction.amount !== undefined && transaction.amount < 0) {
      return false;
    }
    // Additional validation would include signature verification
    return true;
  }

  async isChainValid(): Promise<boolean> {
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      const recalculatedHash = await calculateHash(currentBlock);
      if (currentBlock.hash !== recalculatedHash) {
        return false;
      }

      if (currentBlock.previousHash !== previousBlock.hash) {
        return false;
      }

      const target = "0".repeat(currentBlock.difficulty);
      if (currentBlock.hash.substring(0, currentBlock.difficulty) !== target) {
        return false;
      }
    }
    return true;
  }

  /**
   * Types that actually move SWARM tokens and affect balance.
   */
  private static readonly BALANCE_AFFECTING_TYPES = new Set([
    "token_transfer",
    "token_mint",
    "token_burn",
    "mining_reward",
    "credit_lock",
    "coin_deploy",
    "pool_donate",
    "creator_token_deploy",
    "profile_token_deploy",
    "cross_chain_swap",
  ]);

  private applyTransactionToBalance(tx: SwarmTransaction, address: string): number {
    if (!SwarmChain.BALANCE_AFFECTING_TYPES.has(tx.type)) return 0;
    let delta = 0;
    if (tx.from === address && tx.amount) {
      delta -= tx.amount + tx.fee;
    }
    if (tx.to === address && tx.amount) {
      delta += tx.amount;
    }
    return delta;
  }

  getBalance(address: string): number {
    let balance = 0;

    for (const block of this.chain) {
      for (const tx of block.transactions) {
        balance += this.applyTransactionToBalance(tx, address);
      }
    }

    for (const tx of this.pendingTransactions) {
      balance += this.applyTransactionToBalance(tx, address);
    }

    return Math.max(0, balance);
  }

  getTotalSupply(): number {
    let supply = 0;
    for (const block of this.chain) {
      for (const transaction of block.transactions) {
        if (transaction.type === "token_mint" || transaction.type === "mining_reward") {
          supply += transaction.amount || 0;
        }
        if (transaction.type === "token_burn") {
          supply -= transaction.amount || 0;
        }
      }
    }
    return supply;
  }

  private _buildState(): ChainState {
    return {
      chain: this.chain,
      pendingTransactions: this.pendingTransactions,
      difficulty: this.difficulty,
      miningReward: this.miningReward,
      totalSupply: this.getTotalSupply(),
      circulatingSupply: this.getTotalSupply(),
      lastBlockTime: this.getLatestBlock().timestamp,
    };
  }

  private async persistState(): Promise<void> {
    const state = this._buildState();
    await saveChainState(state);
    this._dirty = false;
  }

  getChain(): SwarmBlock[] {
    return this.chain;
  }

  getPendingTransactions(): SwarmTransaction[] {
    return this.pendingTransactions;
  }

  /**
   * Replace the entire local chain (used by fork resolution).
   * Caller is expected to have validated `incoming` and decided via
   * `resolveFork()` that adoption is correct.
   */
  async replaceChain(incoming: SwarmBlock[]): Promise<void> {
    if (incoming.length === 0) return;
    this.chain = incoming;
    await this.persistState();
    try { recordBlockAccepted(this.getLatestBlock()); } catch { /* non-fatal */ }
  }

  /**
   * Append a single peer-supplied block if it extends our tip.
   * Returns true on append, false otherwise (caller may then trigger fork
   * resolution against a full chain).
   */
  async appendPeerBlock(block: SwarmBlock): Promise<boolean> {
    const tip = this.getLatestBlock();
    if (!tip) return false;
    if (block.index !== tip.index + 1) return false;
    if (block.previousHash !== tip.hash) return false;
    const recalculated = await calculateHash(block);
    if (recalculated !== block.hash) return false;
    const target = "0".repeat(block.difficulty);
    if (block.hash.substring(0, block.difficulty) !== target) return false;

    this.chain.push(block);
    await saveBlock(block);
    await this.persistState();
    try { recordBlockAccepted(block); } catch { /* non-fatal */ }
    return true;
  }
}

let chainInstance: SwarmChain | null = null;

export function getSwarmChain(): SwarmChain {
  if (!chainInstance) {
    chainInstance = new SwarmChain();
  }
  return chainInstance;
}
