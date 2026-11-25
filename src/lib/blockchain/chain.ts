// Swarm-Space Blockchain Implementation
import { SwarmBlock, SwarmTransaction, ChainState, SWARM_CONFIG } from "./types";
import { calculateHash, calculateMerkleRoot, findProofOfWork } from "./crypto";
import { getChainState, saveChainState, saveBlock } from "./storage";
import { recordBlockAccepted, bootstrapChainBridge, resolveFork } from "./chainHealthBridge";
import { planAdoption } from "./chainCatchup";
import { beatIsFree, headerFor, verifyBlockHeader, type BlockSigner } from "./blockHeader";
import { blockForbidsSelfMints, COMMUNITY_POOL, HOLLOW_REWARD_SHARE, isRewardMature, isSelfIssuedSwarmMint, POOL_REWARD_SHARE } from "./issuance";
import { verifyWalletTip } from "./wallets/tipSignature";
import { canSettleCustomTokenTip, isCustomTokenTip } from "./deposits/customTokenTips";
import { isNativeMintMeCustody as isNativeMintMeDeposit, isNativeMintMeWithdraw, isNativeMintMeTip, nativeMintMeBalanceUnits, nativeMintMeUnits } from "./wallets/nativeMintmeLedger";
import { verifyNativeMintMeDeposit } from "./wallets/nativeMintmeCustody";
import { assertCustomTokenDepositCapacity, validCustomTokenDepositLedger } from "./deposits/customTokenLimits";
import { isCustomTokenSync, verifyCustomTokenSync, customTokenCustodyFlows, syncRecordRef } from "./deposits/customTokenCustody";
import { tokenRefFromCurrency } from "./deposits/tokenNetworks";
import { networkNow } from "@/lib/time/networkClock";
import type { Endorsement } from "./endorsements";
import { blockMayRecordWitnesses, latestCheckpoint, Participation, selectWitnesses, verifyWitnesses, witnessRoot } from "./witnesses";

/** localStorage snapshot written on tab hide: only what IndexedDB may lack. */
interface ChainSnapshotV2 {
  v: 2;
  savedAt: number;
  /** Index of the first block in `tail`. */
  base: number;
  tail: SwarmBlock[];
  pendingTransactions: SwarmTransaction[];
  difficulty: number;
  miningReward: number;
}

export class SwarmChain {
  private chain: SwarmBlock[] = [];
  private pendingTransactions: SwarmTransaction[] = [];
  private difficulty: number = SWARM_CONFIG.difficulty;
  private miningReward: number = SWARM_CONFIG.miningReward;
  private _ready: Promise<void>;
  private _dirty = false;
  private _flushScheduled = false;
  /** Hashes of the blocks in IndexedDB, by index, so a save writes only what changed. */
  private _storedHashes: string[] = [];
  /** How many block records IndexedDB holds (may exceed _storedHashes after a gap). */
  private _storedLength = 0;
  /** Saves run one at a time so the stored-hash mirror never races. */
  private _persistQueue: Promise<void> = Promise.resolve();
  private _txAddedListeners = new Set<(tx: SwarmTransaction) => void>();

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
      // Never overwrite a good snapshot with an empty one.
      if (this.chain.length === 0) return;
      // Blocks are already in IndexedDB one record each, so the snapshot
      // only carries what may not be: pending transactions and any block
      // not yet written. Stringifying the whole chain here blocked the
      // page for seconds on a long chain every time the tab was hidden.
      const base = this.firstUnstoredIndex();
      const snapshot: ChainSnapshotV2 = {
        v: 2,
        savedAt: Date.now(),
        base,
        tail: this.chain.slice(base),
        pendingTransactions: this.pendingTransactions,
        difficulty: this.difficulty,
        miningReward: this.miningReward,
      };
      // Rotate the previous snapshot so we have one extra reload of safety.
      try {
        const prev = localStorage.getItem("__swarm_chain_snapshot");
        if (prev) localStorage.setItem("__swarm_chain_snapshot_prev", prev);
      } catch { /* best-effort */ }
      localStorage.setItem("__swarm_chain_snapshot", JSON.stringify(snapshot));
      this._dirty = false;
    } catch {
      // localStorage might be full or unavailable — best effort
    }
  }

  /** Index of the first block whose stored copy is missing or differs. */
  private firstUnstoredIndex(): number {
    const stored = this._storedHashes;
    const n = Math.min(stored.length, this.chain.length);
    let i = 0;
    while (i < n && stored[i] === this.chain[i].hash) i++;
    return i;
  }

  private async loadChain(): Promise<void> {
    // Try latest snapshot, then previous rotated snapshot as a safety net.
    let legacySnapshot: ChainState | null = null;
    let snapshotV2: ChainSnapshotV2 | null = null;
    const tryParse = (raw: string | null): void => {
      if (!raw || legacySnapshot || snapshotV2) return;
      try {
        const parsed = JSON.parse(raw) as ChainState | ChainSnapshotV2;
        if ((parsed as ChainSnapshotV2)?.v === 2 && Array.isArray((parsed as ChainSnapshotV2).tail)) {
          snapshotV2 = parsed as ChainSnapshotV2;
        } else if (parsed && Array.isArray((parsed as ChainState).chain) && (parsed as ChainState).chain.length > 0) {
          legacySnapshot = parsed as ChainState;
        }
      } catch { /* ignore */ }
    };
    try {
      tryParse(localStorage.getItem("__swarm_chain_snapshot"));
      tryParse(localStorage.getItem("__swarm_chain_snapshot_prev"));
      // Do NOT delete the snapshot yet — keep it as durable backup.
    } catch { /* ignore */ }

    const state = await getChainState();
    const snapshot = legacySnapshot as ChainState | null;

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
      if (best === state && typeof state.storedLength === "number") {
        this._storedHashes = state.chain.map((block) => block.hash);
        this._storedLength = state.storedLength;
      }
      let changed = best === snapshot || typeof best.storedLength !== "number";
      // A v2 snapshot carries what IndexedDB may not have caught yet.
      const snap = snapshotV2 as ChainSnapshotV2 | null;
      if (snap && best === state && snap.savedAt > (state.savedAt ?? 0)) {
        if (snap.tail.length > 0 && snap.base <= this.chain.length
          && (snap.base === 0 || snap.tail[0].previousHash === this.chain[snap.base - 1]?.hash)
          && snap.base + snap.tail.length >= this.chain.length) {
          this.chain = [...this.chain.slice(0, snap.base), ...snap.tail];
        }
        this.pendingTransactions = snap.pendingTransactions ?? this.pendingTransactions;
        this.difficulty = snap.difficulty ?? this.difficulty;
        this.miningReward = snap.miningReward ?? this.miningReward;
        changed = true;
      }
      // Recovered from a snapshot, or still in the old one-record shape:
      // write it out as per-block records once.
      if (changed) {
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

  hasTransaction(transactionId: string): boolean {
    if (!transactionId) return false;
    if (this.pendingTransactions.some((tx) => tx.id === transactionId)) return true;
    return this.chain.some((block) =>
      (block.transactions ?? []).some((tx) => tx.id === transactionId),
    );
  }

  addTransaction(transaction: SwarmTransaction): void {
    if (transaction.type === "wallet_tip") throw new Error("Wallet tips require verified acceptance");
    if (isNativeMintMeDeposit(transaction)) throw new Error("MINTME custody requires verified acceptance");
    if (isCustomTokenSync(transaction)) throw new Error("Custom token custody requires verified acceptance");
    if (!this.isValidTransaction(transaction)) {
      throw new Error("Invalid transaction");
    }
    if (this.hasTransaction(transaction.id)) return;
    const depositRef = transaction.type === "external_deposit" ? tokenRefFromCurrency(transaction.meta?.currency) : null;
    if (depositRef) {
      assertCustomTokenDepositCapacity(
        [...this.chain.flatMap((block) => block.transactions ?? []), ...this.pendingTransactions],
        depositRef,
        Number(transaction.amount),
      );
    }
    this.pendingTransactions.push(transaction);
    this._markDirtyAndScheduleFlush();
    for (const listener of this._txAddedListeners) {
      try { listener(transaction); } catch { /* listener errors never block the ledger */ }
    }
  }

  /** Observe transactions appended to the pending pool via addTransaction (used for live peer gossip). */
  onTransactionAdded(listener: (tx: SwarmTransaction) => void): () => void {
    this._txAddedListeners.add(listener);
    return () => { this._txAddedListeners.delete(listener); };
  }

  /** Validation awaits before a synchronous balance check and append: concurrent receipts cannot overspend. */
  async acceptWalletTip(transaction: SwarmTransaction): Promise<boolean> {
    await this.whenReady();
    if (!await verifyWalletTip(transaction)) return false;
    if (this.hasTransaction(transaction.id)) return true;
    const transactions = [...this.chain.flatMap(b => b.transactions), ...this.pendingTransactions];
    if (transactions.some(tx => tx.type === "wallet_tip" && tx.from === transaction.from
      && tx.meta?.assetId === transaction.meta?.assetId && tx.nonce === transaction.nonce)) return false;
    if (isNativeMintMeTip(transaction)) {
      const units = nativeMintMeUnits(transaction);
      if (units === null || nativeMintMeBalanceUnits(transactions, transaction.from) < units) return false;
    } else if (isCustomTokenTip(transaction)) {
      if (!canSettleCustomTokenTip(transactions, transaction)) return false;
    } else if (this.getSpendableBalance(transaction.from) < (transaction.amount ?? 0)) return false;
    this.pendingTransactions.push(transaction);
    this._markDirtyAndScheduleFlush();
    return true;
  }

  async acceptNativeMintMeDeposit(transaction: SwarmTransaction): Promise<boolean> {
    await this.whenReady();
    const ledger = [...this.chain.flatMap(b => b.transactions), ...this.pendingTransactions];
    if (this.hasTransaction(transaction.id)) return true;
    if (!await verifyNativeMintMeDeposit(transaction, ledger, true)) return false;
    if (isNativeMintMeWithdraw(transaction)) {
      const units = nativeMintMeUnits(transaction);
      if (units === null || nativeMintMeBalanceUnits(ledger, transaction.from) < units) return false;
    }
    this.pendingTransactions.push(transaction);
    this._markDirtyAndScheduleFlush();
    return true;
  }

  async acceptCustomTokenDeposit(transaction: SwarmTransaction): Promise<boolean> {
    await this.whenReady();
    const ledger = () => [...this.chain.flatMap(b => b.transactions), ...this.pendingTransactions];
    if (this.hasTransaction(transaction.id)) return true;
    if (!await verifyCustomTokenSync(transaction, ledger(), true)) return false;
    // Recheck after asynchronous RPC/signature validation before the synchronous append.
    if (this.hasTransaction(transaction.id)) return true;
    const current = ledger();
    const ref = syncRecordRef(transaction);
    if (!ref) return false;
    const address = String(transaction.meta?.custodyAddress);
    const flows = customTokenCustodyFlows(current, transaction.to, address, ref, Number(transaction.meta?.decimals));
    if (flows.inflow + BigInt(String(transaction.meta?.amountUnits)) !== BigInt(String(transaction.meta?.cumulativeUnits))) return false;
    try { assertCustomTokenDepositCapacity(current, ref, Number(transaction.amount)); } catch { return false; }
    this.pendingTransactions.push(transaction);
    this._markDirtyAndScheduleFlush();
    return true;
  }

  getNativeMintMeBalanceUnits(address: string): bigint {
    return nativeMintMeBalanceUnits([...this.chain.flatMap(b => b.transactions), ...this.pendingTransactions], address);
  }

  /** Infinity network action: mesh-agreed community payout, re-derived from its recorded answers; one record per round. */
  async acceptMintMeCommunityPayout(transaction: SwarmTransaction): Promise<boolean> {
    await this.whenReady();
    const { verifyCommunityPayoutTx, canAppendCommunityPayout } = await import("./mintmeMiner/communityPayout");
    if (!verifyCommunityPayoutTx(transaction)) return false;
    if (this.hasTransaction(transaction.id)) return false;
    if (!canAppendCommunityPayout([...this.chain.flatMap(b => b.transactions), ...this.pendingTransactions], transaction)) return false;
    this.pendingTransactions.push(transaction);
    this._markDirtyAndScheduleFlush();
    return true;
  }

  /** Verify first, then synchronously check and append the complete batch.
   * No partially paid batch can survive an insufficient balance or interruption.
   */
  async acceptNativeMintMeBatch(transactions: SwarmTransaction[]): Promise<boolean> {
    await this.whenReady();
    if (!transactions.length) return false;
    for (const tx of transactions) if (!isNativeMintMeTip(tx) || !await verifyWalletTip(tx)) return false;
    const accepted = [...this.chain.flatMap(b => b.transactions), ...this.pendingTransactions];
    for (const tx of transactions) {
      if (accepted.some(prev => prev.id === tx.id || (prev.type === "wallet_tip" && prev.from === tx.from
        && prev.meta?.assetId === tx.meta?.assetId && prev.nonce === tx.nonce))) return false;
      const units = nativeMintMeUnits(tx);
      if (units === null || nativeMintMeBalanceUnits(accepted, tx.from) < units) return false;
      accepted.push(tx);
    }
    this.pendingTransactions.push(...transactions);
    this._markDirtyAndScheduleFlush();
    return true;
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

  async minePendingTransactions(
    minerAddress: string,
    chainId?: string,
    options: { allowEmpty?: boolean; hollow?: boolean; signer?: BlockSigner | null; witnesses?: Endorsement[] } = {},
  ): Promise<SwarmBlock | null> {
    const signer = options.signer ?? null;
    if (signer) minerAddress = signer.userId;
    // Header v2 allows one block per cadence beat on top of the tip.
    const startedAt = networkNow();
    // Build on one parent throughout: if a peer block lands while we work,
    // the commit below sees the tip moved and drops this block.
    const parent = this.getLatestBlock();
    if (signer && !beatIsFree(parent, startedAt)) return null;
    // A block pays exactly one reward: its own. Rewards from other blocks
    // (orphaned or copied from a peer's chain) never ride along, and
    // self-issued mints stay on this device: peers can't check them.
    const carried = this.pendingTransactions.filter((tx) => tx.type !== "mining_reward" && !isSelfIssuedSwarmMint(tx));
    if (carried.length === 0 && !options.allowEmpty) {
      return null;
    }

    const resolvedChainId = chainId || "SWARM";

    // The block's reward, Bitcoin-style: the miner's share plus the community
    // pool's share (the old 5% mining tax), together no more than the height allows.
    const total = this.rewardAtHeight(parent.index + 1) * (options.hollow ? HOLLOW_REWARD_SHARE : 1);
    const poolShare = total * POOL_REWARD_SHARE;
    const stamp = new Date(networkNow()).toISOString();
    const rewardId = `reward-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const rewardBase = {
      type: "mining_reward" as const, from: "system", timestamp: stamp, signature: "", publicKey: "",
      nonce: 0, fee: 0, chainId: resolvedChainId,
    };
    const rewardTransactions: SwarmTransaction[] = [
      { ...rewardBase, id: rewardId, to: minerAddress, amount: total - poolShare,
        meta: { reward: true, chainId: resolvedChainId, ...(options.hollow ? { hollow: true } : {}) } },
      { ...rewardBase, id: `${rewardId}-pool`, to: COMMUNITY_POOL, amount: poolShare,
        meta: { reward: true, chainId: resolvedChainId, poolTax: poolShare, marketVaultFunding: "swarm-mining" } },
    ];

    // Only carry payments peers will accept: one funded by a local-only mint
    // or an unripe reward stays pending instead of poisoning the block.
    const transactions = [...carried, ...rewardTransactions];
    const draft = { index: parent.index + 1, timestamp: new Date(startedAt).toISOString() };
    const history = this.chain.slice(0, parent.index + 1);
    while (!await this.validateWalletTipLedger([...history, { ...draft, transactions } as SwarmBlock])) {
      const last = transactions.map((tx) => tx.type).lastIndexOf("wallet_tip");
      if (last < 0) break;
      transactions.splice(last, 1);
    }
    if (transactions.length === rewardTransactions.length && !options.allowEmpty) return null;
    // Record the agreements our parent collected (signed blocks only, from the cutoff on).
    const witnesses = signer && options.witnesses?.length && blockMayRecordWitnesses(draft)
      ? selectWitnesses(options.witnesses, parent, signer.userId, this.participationAt(parent))
      : [];
    const block: SwarmBlock = {
      index: draft.index,
      timestamp: draft.timestamp,
      transactions,
      previousHash: parent.hash,
      hash: "",
      nonce: 0,
      difficulty: this.difficulty,
      miner: minerAddress,
      merkleRoot: await calculateMerkleRoot(transactions),
      ...(signer ? headerFor(parent, startedAt, signer) : {}),
      ...(witnesses.length ? { witnesses, witnessRoot: await witnessRoot(witnesses) } : {}),
    };

    const minedBlock = await this.mineBlock(block);
    if (signer) minedBlock.producerSignature = await signer.sign(minedBlock.hash);
    return this.exclusive(async () => {
      // A peer's block may have landed while we were mining: ours no longer
      // extends the tip, so drop it and keep its transactions pending.
      if (this.getLatestBlock().hash !== minedBlock.previousHash) return null;
      this.chain.push(minedBlock);
      await saveBlock(minedBlock);

      // Notify the UQRC bridge so the smoothed tip pin advances.
      try { recordBlockAccepted(minedBlock); } catch { /* non-fatal */ }

      // Clear the mined transactions (keep any that arrived while mining).
      const mined = new Set(minedBlock.transactions.map((tx) => tx.id));
      this.pendingTransactions = this.pendingTransactions.filter((tx) => !mined.has(tx.id) && tx.type !== "mining_reward");

      // Check for halving
      if (this.chain.length % SWARM_CONFIG.halvingInterval === 0) {
        this.miningReward = this.miningReward / 2;
      }

      await this.persistState();
      return minedBlock;
    });
  }

  private async mineBlock(block: SwarmBlock): Promise<SwarmBlock> {
    // Same nonce search as hashing each nonce in turn, without hogging the
    // main thread: mining starts when the first peer joins, and the old loop
    // made the whole page stall for seconds every block.
    const { nonce, hash } = await findProofOfWork(block);
    block.nonce = nonce;
    block.hash = hash;
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
    "wallet_tip",
    "token_transfer",
    "token_mint",
    "token_burn",
    "mining_reward",
    "credit_lock",
    "coin_deploy",
    "pool_donate",
    "creator_token_deploy",
    "profile_token_deploy",
    "coin_market_list",
    "coin_market_settle",
    "coin_market_cancel",
    "cross_chain_swap",
    "coin_transfer",
  ]);

  private applyTransactionToBalance(tx: SwarmTransaction, address: string): number {
    if (isNativeMintMeTip(tx) || isCustomTokenTip(tx)) return 0;
    if (tx.type === "wallet_tip" && (tx.tokenId || (tx.chainId && tx.chainId !== "SWARM"))) return 0;
    // SWARM moved between a native identity and its MetaMask-key-controlled ledger slot.
    const swarmExternal = (tx.type === "external_withdraw" || tx.type === "external_deposit")
      && (tx.meta as Record<string, unknown> | undefined)?.currency === "SWARM";
    if (!swarmExternal && !SwarmChain.BALANCE_AFFECTING_TYPES.has(tx.type)) return 0;
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
      // A reward is spendable only once enough blocks sit on top of it, so a
      // block that loses a fork takes its reward with it before anyone spends it.
      const mature = isRewardMature(block.index, this.chain.length);
      for (const tx of block.transactions) {
        if (tx.type === "mining_reward" && !mature) continue;
        balance += this.applyTransactionToBalance(tx, address);
      }
    }

    for (const tx of this.pendingTransactions) {
      balance += this.applyTransactionToBalance(tx, address);
    }

    return Math.max(0, balance);
  }

  /**
   * Balance a signed payment may spend on the shared chain: leaves out
   * self-issued mints, which stay on this device and never reach a block.
   */
  getSpendableBalance(address: string): number {
    const local = this.pendingTransactions
      .filter((tx) => isSelfIssuedSwarmMint(tx))
      .reduce((sum, tx) => sum + this.applyTransactionToBalance(tx, address), 0);
    return Math.max(0, this.getBalance(address) - local);
  }

  /** Block rewards paid to `address` that are not yet spendable. */
  getImmatureRewards(address: string): number {
    let total = 0;
    for (const block of this.chain) {
      if (isRewardMature(block.index, this.chain.length)) continue;
      for (const tx of block.transactions) {
        if (tx.type === "mining_reward" && tx.to === address) total += Number(tx.amount) || 0;
      }
    }
    return total;
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
    const supply = this.getTotalSupply();
    return {
      chain: this.chain,
      pendingTransactions: this.pendingTransactions,
      difficulty: this.difficulty,
      miningReward: this.miningReward,
      totalSupply: supply,
      circulatingSupply: supply,
      lastBlockTime: this.getLatestBlock().timestamp,
      savedAt: Date.now(),
    };
  }

  /**
   * Save bookkeeping plus only the blocks that changed since the last save
   * (usually just the new tip), instead of cloning the whole chain into
   * IndexedDB after every block.
   */
  private persistState(): Promise<void> {
    const run = this._persistQueue.then(async () => {
      const state = this._buildState();
      const from = this.firstUnstoredIndex();
      const changed = this.chain.slice(from);
      const hashes = this.chain.map((block) => block.hash);
      const previousLength = Math.max(this._storedLength, this._storedHashes.length);
      await saveChainState(state, changed, previousLength);
      this._storedHashes = hashes;
      this._storedLength = hashes.length;
      this._dirty = false;
    });
    this._persistQueue = run.catch(() => { /* next save retries */ });
    return run;
  }

  getChain(): SwarmBlock[] {
    return this.chain;
  }

  getPendingTransactions(): SwarmTransaction[] {
    return this.pendingTransactions;
  }

  /**
   * Replace a still-unmined entry with a copy carrying the same id, e.g. once
   * its owner has signed it. Returns false when it is no longer pending.
   */
  replacePendingTransaction(transaction: SwarmTransaction): boolean {
    const index = this.pendingTransactions.findIndex((tx) => tx.id === transaction.id);
    if (index < 0) return false;
    this.pendingTransactions[index] = transaction;
    this._markDirtyAndScheduleFlush();
    return true;
  }

  /**
   * Replace the entire local chain (used by fork resolution).
   * Caller is expected to have validated `incoming` and decided via
   * `resolveFork()` that adoption is correct.
   */
  async replaceChain(incoming: SwarmBlock[]): Promise<void> {
    if (incoming.length === 0) return;
    if (!validCustomTokenDepositLedger(incoming.flatMap((block) => block.transactions))) throw new Error("Peer chain exceeds custom-token deposit limits");
    if (!await this.validateWalletTipLedger(incoming)) throw new Error("Invalid wallet tip in peer chain");
    this.chain = incoming;
    const included = new Set(incoming.flatMap(block => block.transactions.map(tx => tx.id)));
    this.pendingTransactions = this.pendingTransactions.filter(tx => !included.has(tx.id));
    this.pruneCustomTokenPending();
    await this.persistState();
    try { recordBlockAccepted(this.getLatestBlock()); } catch { /* non-fatal */ }
  }

  /** Check a peer's chain links up: same genesis, valid hashes, proof of work. */
  async isValidPeerChain(blocks: SwarmBlock[]): Promise<boolean> {
    const genesis = this.chain[0];
    if (blocks.length === 0 || !genesis || blocks[0].hash !== genesis.hash) return false;
    // The hash is only a claim: recompute it so a forged genesis with extra
    // transactions under the canonical hash is rejected.
    if (await calculateHash(blocks[0]) !== genesis.hash) return false;
    const participation = new Participation();
    participation.add(blocks[0]);
    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      const prev = blocks[i - 1];
      if (block.index !== prev.index + 1 || block.previousHash !== prev.hash) return false;
      if (await calculateHash(block) !== block.hash) return false;
      const target = "0".repeat(block.difficulty);
      if (block.hash.substring(0, block.difficulty) !== target) return false;
      if (!this.hasValidRewards(block)) return false;
      if (!await verifyBlockHeader(block, prev, SWARM_CONFIG.difficulty)) return false;
      if (!await verifyWitnesses(block, prev, participation)) return false;
      participation.add(block);
    }
    return true;
  }

  /** Who has taken part along our chain up to and including `tip` (cached for the current tip). */
  private participationCache: { hash: string; value: Participation } | null = null;
  private participationAt(tip: SwarmBlock): Participation {
    if (this.participationCache?.hash === tip.hash) return this.participationCache.value;
    const value = Participation.of(this.chain.slice(0, tip.index + 1));
    if (tip.hash === this.getLatestBlock().hash) this.participationCache = { hash: tip.hash, value };
    return value;
  }

  /** Accounts eligible to witness the next block on our chain. */
  getVoters(): Set<string> {
    return this.participationAt(this.getLatestBlock()).voters();
  }

  /** Height of our newest checkpoint (cached per tip); -1 when there is none. */
  private checkpointCache: { hash: string; height: number } | null = null;
  getLatestCheckpoint(): number {
    const tip = this.getLatestBlock();
    if (this.checkpointCache?.hash !== tip.hash) this.checkpointCache = { hash: tip.hash, height: latestCheckpoint(this.chain) };
    return this.checkpointCache.height;
  }

  /** Reward allowed for a block at this height (halves every halvingInterval blocks). */
  private rewardAtHeight(index: number): number {
    return SWARM_CONFIG.miningReward / Math.pow(2, Math.floor(index / SWARM_CONFIG.halvingInterval));
  }

  /**
   * A peer block may pay at most one mining reward, from "system", no larger
   * than the reward for its height. Without this a peer could mine a block
   * that credits itself any amount.
   */
  private hasValidRewards(block: SwarmBlock): boolean {
    // New coins come only from the block reward: no self-issued mints.
    if (blockForbidsSelfMints(block) && block.transactions.some(isSelfIssuedSwarmMint)) return false;
    // One reward per block: the miner's share, plus at most one share to the community pool.
    const rewards = block.transactions.filter((tx) => tx.type === "mining_reward");
    if (rewards.length > 2) return false;
    if (rewards.length === 2 && rewards.filter((tx) => tx.to === COMMUNITY_POOL).length !== 1) return false;
    let paid = 0;
    for (const reward of rewards) {
      if (reward.from !== "system") return false;
      const amount = Number(reward.amount ?? 0);
      if (!Number.isFinite(amount) || amount < 0) return false;
      paid += amount;
    }
    // Under the new issuance rules the pool's share is part of every reward.
    if (paid > 0 && blockForbidsSelfMints(block)) {
      const pool = rewards.find((tx) => tx.to === COMMUNITY_POOL && rewards.length === 2);
      if (!pool || Number(pool.amount) < paid * POOL_REWARD_SHARE - 1e-9) return false;
    }
    return paid <= this.rewardAtHeight(block.index) + 1e-9;
  }

  /** Re-admit a transaction from a dropped block through the same checks a new one passes. */
  private async readmitTransaction(tx: SwarmTransaction): Promise<boolean> {
    try {
      if (this.hasTransaction(tx.id)) return false;
      // A dropped block's reward dies with the block; the next block pays its own.
      if (tx.type === "mining_reward") return false;
      if (tx.type === "wallet_tip") return await this.acceptWalletTip(tx);
      if (isNativeMintMeDeposit(tx)) return await this.acceptNativeMintMeDeposit(tx);
      if (isCustomTokenSync(tx)) return await this.acceptCustomTokenDeposit(tx);
      this.addTransaction(tx);
      return this.hasTransaction(tx.id);
    } catch {
      return false;
    }
  }

  /** Run chain mutations one at a time, so concurrent appends can't interleave. */
  private mutation: Promise<unknown> = Promise.resolve();
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutation.then(fn, fn);
    this.mutation = run.catch(() => undefined);
    return run;
  }

  /**
   * Shared chain: switch to a peer's chain when the fork choice prefers it.
   * Our transactions from dropped blocks that the new chain lacks go back to
   * pending, so they're mined into the shared chain and nothing is lost.
   */
  async adoptPeerChain(incoming: SwarmBlock[]): Promise<"adopted" | "kept" | "invalid"> {
    return this.exclusive(async () => {
      if (!await this.isValidPeerChain(incoming)) return "invalid";
      // Keep our own trusted genesis object rather than the peer's copy.
      const candidate = [this.chain[0], ...incoming.slice(1)];
      const plan = planAdoption(this.chain, candidate, resolveFork);
      if (!plan.replace) return "kept";
      // A block most voters signed is final: never switch to a chain that drops it.
      if (plan.forkPoint <= this.getLatestCheckpoint()) return "kept";
      try {
        await this.replaceChain(candidate);
      } catch (err) {
        console.warn("[Chain] Peer chain rejected:", err);
        return "invalid";
      }
      // Our dropped transactions go back through full validation against the
      // adopted ledger; a tip the new chain already spent is left out.
      let readmitted = 0;
      for (const tx of plan.requeue) if (await this.readmitTransaction(tx)) readmitted++;
      this.pruneCustomTokenPending();
      await this.persistState();
      console.log(`[Chain] Adopted peer chain (${candidate.length} blocks, fork at #${plan.forkPoint}, ${readmitted}/${plan.requeue.length} tx re-queued)`);
      return "adopted";
    });
  }

  /**
   * Append a single peer-supplied block if it extends our tip.
   * Returns true on append, false otherwise (caller may then trigger fork
   * resolution against a full chain).
   */
  async appendPeerBlock(block: SwarmBlock): Promise<boolean> {
    return this.exclusive(() => this.appendPeerBlockNow(block));
  }

  private async appendPeerBlockNow(block: SwarmBlock): Promise<boolean> {
    if (!this.hasValidRewards(block)) return false;
    const tip = this.getLatestBlock();
    if (!tip) return false;
    if (block.index !== tip.index + 1) return false;
    if (block.previousHash !== tip.hash) return false;
    const recalculated = await calculateHash(block);
    if (recalculated !== block.hash) return false;
    const target = "0".repeat(block.difficulty);
    if (block.hash.substring(0, block.difficulty) !== target) return false;
    if (!await verifyBlockHeader(block, tip, SWARM_CONFIG.difficulty)) return false;
    if (!await verifyWitnesses(block, tip, this.participationAt(tip))) return false;

    if (!await this.validateWalletTipLedger([...this.chain, block])) return false;
    if (!validCustomTokenDepositLedger([...this.chain, block].flatMap((entry) => entry.transactions))) return false;

    this.chain.push(block);
    const included = new Set(block.transactions.map(tx => tx.id));
    this.pendingTransactions = this.pendingTransactions.filter(tx => !included.has(tx.id));
    this.pruneCustomTokenPending();
    await saveBlock(block);
    await this.persistState();
    try { recordBlockAccepted(block); } catch { /* non-fatal */ }
    return true;
  }

  private pruneCustomTokenPending(): void {
    const accepted = this.chain.flatMap((block) => block.transactions);
    this.pendingTransactions = this.pendingTransactions.filter((tx) => {
      if (!validCustomTokenDepositLedger([...accepted, tx])) return false;
      accepted.push(tx);
      return true;
    });
  }

  /**
   * Ledger state after validating a prefix of blocks, keyed by the last
   * block's hash. Block hashes cover their transactions, so a later call
   * whose blocks share that prefix can resume from here instead of
   * re-walking (and re-verifying every signed tip in) the whole chain.
   */
  private ledgerCache: { length: number; tipHash: string; state: LedgerWalk } | null = null;

  private async validateWalletTipLedger(blocks: SwarmBlock[]): Promise<boolean> {
    let start = 0;
    let walk: LedgerWalk;
    const cache = this.ledgerCache;
    if (cache && blocks.length > cache.length && blocks[cache.length - 1]?.hash === cache.tipHash) {
      walk = cloneLedgerWalk(cache.state);
      start = cache.length;
    } else {
      walk = { balances: new Map(), seen: new Set(), accepted: [], nonces: new Set(), maturing: [] };
    }
    const { balances, seen, accepted, nonces, maturing } = walk;
    // Rewards from blocks under the new issuance rules wait to mature before they can be spent.
    for (let b = start; b < blocks.length; b++) {
      const block = blocks[b];
      for (let i = maturing.length - 1; i >= 0; i--) {
        if (!isRewardMature(maturing[i].index, block.index)) continue;
        const { to, amount } = maturing[i];
        balances.set(to, (balances.get(to) ?? 0) + amount);
        maturing.splice(i, 1);
      }
      const holdRewards = blockForbidsSelfMints(block);
      for (const tx of block.transactions) {
        if (isNativeMintMeDeposit(tx) && (seen.has(tx.id) || !await verifyNativeMintMeDeposit(tx, accepted))) return false;
        if (isCustomTokenSync(tx) && (seen.has(tx.id) || !await verifyCustomTokenSync(tx, accepted))) return false;
        if (tx.type === "wallet_tip") {
          if (seen.has(tx.id) || !await verifyWalletTip(tx)) return false;
          const nonceKey = `${tx.from}:${tx.meta?.assetId}:${tx.nonce}`;
          if (nonces.has(nonceKey)) return false;
          nonces.add(nonceKey);
          if (isNativeMintMeTip(tx)) {
            const units = nativeMintMeUnits(tx);
            if (units === null || nativeMintMeBalanceUnits(accepted, tx.from) < units) return false;
          } else if (isCustomTokenTip(tx)) {
            if (!canSettleCustomTokenTip(accepted, tx)) return false;
          } else if ((balances.get(tx.from) ?? 0) < (tx.amount ?? 0)) return false;
        }
        seen.add(tx.id);
        accepted.push(tx);
        if (holdRewards && tx.type === "mining_reward") {
          maturing.push({ index: block.index, to: tx.to, amount: this.applyTransactionToBalance(tx, tx.to) });
          continue;
        }
        for (const address of new Set([tx.from, tx.to])) {
          balances.set(address, (balances.get(address) ?? 0) + this.applyTransactionToBalance(tx, address));
        }
      }
      // Remember the state at the last block with a hash (a draft block being
      // mined has none yet, and never becomes a resume point).
      if (b === blocks.length - 1 || (b === blocks.length - 2 && !blocks[b + 1]?.hash)) {
        if (typeof block.hash === "string" && block.hash) {
          this.ledgerCache = { length: b + 1, tipHash: block.hash, state: cloneLedgerWalk(walk) };
        }
      }
    }
    return true;
  }
}

/** Running state of a wallet-ledger walk over blocks. */
interface LedgerWalk {
  balances: Map<string, number>;
  seen: Set<string>;
  accepted: SwarmTransaction[];
  nonces: Set<string>;
  maturing: { index: number; to: string; amount: number }[];
}

function cloneLedgerWalk(w: LedgerWalk): LedgerWalk {
  return {
    balances: new Map(w.balances),
    seen: new Set(w.seen),
    accepted: w.accepted.slice(),
    nonces: new Set(w.nonces),
    maturing: w.maturing.map((m) => ({ ...m })),
  };
}

let chainInstance: SwarmChain | null = null;

export function getSwarmChain(): SwarmChain {
  if (!chainInstance) {
    chainInstance = new SwarmChain();
  }
  return chainInstance;
}
