// Swarm-Space Blockchain Implementation
import { SwarmBlock, SwarmTransaction, ChainState, SWARM_CONFIG } from "./types";
import { calculateHash, calculateMerkleRoot } from "./crypto";
import { getChainState, saveChainState, saveBlock } from "./storage";

export class SwarmChain {
  private chain: SwarmBlock[] = [];
  private pendingTransactions: SwarmTransaction[] = [];
  private difficulty: number = SWARM_CONFIG.difficulty;
  private miningReward: number = SWARM_CONFIG.miningReward;

  constructor() {
    this.loadChain();
  }

  private async loadChain(): Promise<void> {
    const state = await getChainState();
    if (state) {
      this.chain = state.chain;
      this.pendingTransactions = state.pendingTransactions;
      this.difficulty = state.difficulty;
      this.miningReward = state.miningReward;
    } else {
      // Create genesis block
      this.chain = [await this.createGenesisBlock()];
      await this.persistState();
    }
  }

  private async createGenesisBlock(): Promise<SwarmBlock> {
    const genesisTransactions: SwarmTransaction[] = [];
    const block: SwarmBlock = {
      index: 0,
      timestamp: SWARM_CONFIG.genesisTimestamp,
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
    this.persistState();
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
   * Ledger-only entries (nft_mint, nft_transfer, achievement_wrap, etc.)
   * are recorded on-chain but do NOT debit/credit SWARM.
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

    // Balance should never go negative — clamp as a safety net
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

  private async persistState(): Promise<void> {
    const state: ChainState = {
      chain: this.chain,
      pendingTransactions: this.pendingTransactions,
      difficulty: this.difficulty,
      miningReward: this.miningReward,
      totalSupply: this.getTotalSupply(),
      circulatingSupply: this.getTotalSupply(),
      lastBlockTime: this.getLatestBlock().timestamp,
    };
    await saveChainState(state);
  }

  getChain(): SwarmBlock[] {
    return this.chain;
  }

  getPendingTransactions(): SwarmTransaction[] {
    return this.pendingTransactions;
  }
}

let chainInstance: SwarmChain | null = null;

export function getSwarmChain(): SwarmChain {
  if (!chainInstance) {
    chainInstance = new SwarmChain();
  }
  return chainInstance;
}
