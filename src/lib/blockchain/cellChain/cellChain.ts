/**
 * Cell chains: every private cell is its own independent chain with its own
 * coin, mined by its members.
 *
 * The rules are the shared SWARM chain's, applied to the cell's own blocks:
 * - Proof of work at the shared chain's difficulty, one block per 30-second
 *   beat, the v2 signed header (epoch, tick, producer, clock session), and the
 *   2-minute future limit on block times.
 * - The block reward is the only way the cell's coin is made: the same size
 *   and halving as SWARM, 95% to the miner and 5% to the cell's pool, and it
 *   matures after 20 blocks.
 * - Endorsements, witnesses, voters (newcomer wait included) and checkpoints
 *   are the shared chain's own code, with the cell's chain id as the network.
 *
 * What a cell adds: only members on the cell's signed roster may mine it or
 * hold its coin. Roster records ride in blocks and take their time from the
 * block, so the header's tick and epoch checks bound them too. Mining a cell
 * never creates SWARM.
 */
import { base64ToArrayBuffer, computeUserId } from "@/lib/crypto";
import { networkNow } from "@/lib/time/networkClock";
import { beatIsFree, BLOCK_VERSION, headerFor, verifyBlockHeader, type BlockSigner } from "../blockHeader";
import { FUTURE_LIMIT_MS, planAdoption } from "../chainCatchup";
import { calculateHash, calculateMerkleRoot, sha256Async } from "../crypto";
import type { Endorsement } from "../endorsements";
import { COMMUNITY_POOL, isRewardMature, POOL_REWARD_SHARE } from "../issuance";
import { SWARM_CONFIG, type SwarmBlock, type SwarmTransaction } from "../types";
import { latestCheckpoint, Participation, selectWitnesses, verifyWitnesses, witnessRoot } from "../witnesses";
import { canonical, CellRoster, rosterRecordHash, verifyRosterRecord, type SignedRosterRecord, type TextSigner } from "./roster";

/** The cell's pool: receives 5% of every block reward, on the cell's own chain. */
export const CELL_POOL = COMMUNITY_POOL;
export const CELL_ROSTER_TX = "cell_roster" as const;
export const CELL_TRANSFER_TX = "cell_transfer" as const;
export const MAX_CELL_BLOCK_TRANSACTIONS = 200;

/** The shared chain's mining rules, which cell chains use unchanged. */
export const CELL_MINING = {
  difficulty: SWARM_CONFIG.difficulty,
  miningReward: SWARM_CONFIG.miningReward,
  halvingInterval: SWARM_CONFIG.halvingInterval,
};

export function cellRewardAtHeight(index: number): number {
  return CELL_MINING.miningReward / Math.pow(2, Math.floor(index / CELL_MINING.halvingInterval));
}

// ── Transactions ────────────────────────────────────────────────────

export function rosterTransaction(chainId: string, s: SignedRosterRecord, id: string): SwarmTransaction {
  return {
    id, type: CELL_ROSTER_TX, from: s.signer, to: chainId, amount: 0, fee: 0,
    timestamp: new Date(s.record.at).toISOString(), signature: s.signature, publicKey: s.publicKey,
    nonce: 0, chainId, meta: { roster: s },
  };
}

export interface TransferBody {
  chain: string;
  from: string;
  to: string;
  amount: number;
  nonce: number;
  at: number;
}

function transferText(body: TransferBody, publicKey: string): string {
  return canonical({ v: 1, type: "cell-transfer", body, publicKey });
}

/** Sign a transfer of the cell's coin. */
export async function signCellTransfer(body: Omit<TransferBody, "from">, signer: TextSigner): Promise<SwarmTransaction> {
  const full: TransferBody = { ...body, from: signer.userId };
  const signature = await signer.signText(transferText(full, signer.publicKey));
  return {
    id: await sha256Async(canonical({ body: full, signature })),
    type: CELL_TRANSFER_TX, from: full.from, to: full.to, amount: full.amount, fee: 0,
    timestamp: new Date(full.at).toISOString(), signature, publicKey: signer.publicKey,
    nonce: full.nonce, chainId: full.chain, meta: { at: full.at },
  };
}

function transferBodyOf(tx: SwarmTransaction): TransferBody | null {
  const at = Number(tx.meta?.at);
  if (typeof tx.chainId !== "string" || !Number.isSafeInteger(at)) return null;
  return { chain: tx.chainId, from: tx.from, to: tx.to, amount: Number(tx.amount), nonce: tx.nonce, at };
}

async function verifyCellTransfer(tx: SwarmTransaction): Promise<boolean> {
  const body = transferBodyOf(tx);
  if (!body || !Number.isFinite(body.amount) || body.amount <= 0 || !Number.isSafeInteger(body.nonce)) return false;
  if (tx.fee !== 0 || body.from === body.to) return false;
  try {
    if (await computeUserId(tx.publicKey) !== tx.from) return false;
    if (tx.id !== await sha256Async(canonical({ body, signature: tx.signature }))) return false;
    const key = await crypto.subtle.importKey("spki", base64ToArrayBuffer(tx.publicKey),
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
      base64ToArrayBuffer(tx.signature), new TextEncoder().encode(transferText(body, tx.publicKey)));
  } catch {
    return false;
  }
}

// ── Ledger state, replayed block by block ───────────────────────────

/** Everything the rules need at one point of a cell chain. */
class LedgerState {
  balances = new Map<string, number>();
  maturing: { index: number; to: string; amount: number }[] = [];
  nonces = new Set<string>();
  txIds = new Set<string>();

  constructor(public roster: CellRoster, public participation: Participation) {}

  clone(): LedgerState {
    const copy = new LedgerState(this.roster.clone(), this.participation.clone());
    copy.balances = new Map(this.balances);
    copy.maturing = this.maturing.map((m) => ({ ...m }));
    copy.nonces = new Set(this.nonces);
    copy.txIds = new Set(this.txIds);
    return copy;
  }

  /** Rewards old enough to spend in the block at `index` become balance. */
  ripen(index: number): void {
    for (let i = this.maturing.length - 1; i >= 0; i--) {
      if (!isRewardMature(this.maturing[i].index, index)) continue;
      const { to, amount } = this.maturing[i];
      this.balances.set(to, (this.balances.get(to) ?? 0) + amount);
      this.maturing.splice(i, 1);
    }
  }

  balance(address: string): number {
    return this.balances.get(address) ?? 0;
  }
}

/**
 * Check and apply one non-reward transaction against `state`, as part of a
 * block stamped at `blockMs`. Returns false, with `state` possibly half
 * changed, when it doesn't fit: callers work on a clone.
 */
async function applyTransaction(state: LedgerState, tx: SwarmTransaction, blockMs: number, chainId: string): Promise<boolean> {
  if (!tx || typeof tx.id !== "string" || state.txIds.has(tx.id) || tx.chainId !== chainId) return false;
  if (tx.type === CELL_ROSTER_TX) {
    const s = tx.meta?.roster as SignedRosterRecord | undefined;
    if (!s || tx.from !== s.signer || tx.to !== chainId || (tx.amount ?? 0) !== 0) return false;
    if (tx.id !== await rosterRecordHash(s)) return false;
    if (!await state.roster.apply(s, blockMs)) return false;
  } else if (tx.type === CELL_TRANSFER_TX) {
    if (!await verifyCellTransfer(tx)) return false;
    const at = Number(tx.meta?.at);
    if (at > blockMs) return false;
    // The coin stays inside the cell: both ends must be members.
    if (!state.roster.isMember(tx.from) || !state.roster.isMember(tx.to)) return false;
    const nonceKey = `${tx.from}:${tx.nonce}`;
    if (state.nonces.has(nonceKey)) return false;
    const amount = Number(tx.amount);
    if (state.balance(tx.from) < amount) return false;
    state.nonces.add(nonceKey);
    state.balances.set(tx.from, state.balance(tx.from) - amount);
    state.balances.set(tx.to, state.balance(tx.to) + amount);
  } else {
    return false;
  }
  state.txIds.add(tx.id);
  return true;
}

function validRewards(block: SwarmBlock, chainId: string): boolean {
  const rewards = block.transactions.filter((tx) => tx.type === "mining_reward");
  if (rewards.length === 0) return true;
  if (rewards.length !== 2 || rewards.filter((tx) => tx.to === CELL_POOL).length !== 1) return false;
  let paid = 0;
  for (const reward of rewards) {
    if (reward.from !== "system" || reward.chainId !== chainId) return false;
    const amount = Number(reward.amount ?? 0);
    if (!Number.isFinite(amount) || amount < 0) return false;
    paid += amount;
  }
  const pool = rewards.find((tx) => tx.to === CELL_POOL)!;
  if (Number(pool.amount) < paid * POOL_REWARD_SHARE - 1e-9) return false;
  return paid <= cellRewardAtHeight(block.index) + 1e-9;
}

// ── Storage ─────────────────────────────────────────────────────────

export interface CellChainSnapshot {
  blocks: SwarmBlock[];
  pending: SwarmTransaction[];
}

export interface CellChainStorage {
  load(chainId: string): Promise<CellChainSnapshot | null>;
  save(chainId: string, snapshot: CellChainSnapshot): Promise<void>;
}

/** IndexedDB, beside the shared chain's state in the "blockchain" store. */
export const indexedDbCellChainStorage: CellChainStorage = {
  async load(chainId) {
    const { get } = await import("@/lib/store");
    const row = await get<CellChainSnapshot & { id: string }>("blockchain", `cell-chain:${chainId}`);
    return row ? { blocks: row.blocks ?? [], pending: row.pending ?? [] } : null;
  },
  async save(chainId, snapshot) {
    const { put } = await import("@/lib/store");
    await put("blockchain", { id: `cell-chain:${chainId}`, ...snapshot });
  },
};

export function memoryCellChainStorage(): CellChainStorage {
  const rows = new Map<string, string>();
  return {
    async load(chainId) { const raw = rows.get(chainId); return raw ? JSON.parse(raw) : null; },
    async save(chainId, snapshot) { rows.set(chainId, JSON.stringify(snapshot)); },
  };
}

// ── The chain ───────────────────────────────────────────────────────

export interface CellChainOptions {
  storage?: CellChainStorage;
  /** Proof-of-work difficulty; the shared chain's by default. Tests lower it. */
  difficulty?: number;
  now?: () => number;
}

export class CellChain {
  private chain: SwarmBlock[];
  private pending: SwarmTransaction[] = [];
  private state!: LedgerState;
  private storage: CellChainStorage;
  private difficulty: number;
  private now: () => number;
  private mutation: Promise<unknown> = Promise.resolve();

  private constructor(readonly chainId: string, genesis: SwarmBlock, opts: CellChainOptions) {
    this.chain = [genesis];
    this.storage = opts.storage ?? indexedDbCellChainStorage;
    this.difficulty = opts.difficulty ?? CELL_MINING.difficulty;
    this.now = opts.now ?? networkNow;
  }

  /** The genesis block for a signed genesis record: deterministic, so every member builds the same one. */
  static async genesisBlock(genesis: SignedRosterRecord): Promise<SwarmBlock> {
    const chainId = await rosterRecordHash(genesis);
    const transactions = [rosterTransaction(chainId, genesis, chainId)];
    const block: SwarmBlock = {
      index: 0,
      timestamp: new Date(genesis.record.at).toISOString(),
      transactions,
      previousHash: "0",
      hash: "",
      nonce: 0,
      difficulty: 0,
      miner: genesis.signer,
      merkleRoot: await calculateMerkleRoot(transactions),
    };
    block.hash = await calculateHash(block);
    return block;
  }

  /** Open a cell chain from its genesis record, loading what this device saved. Null for an invalid genesis. */
  static async open(genesis: SignedRosterRecord, opts: CellChainOptions = {}): Promise<CellChain | null> {
    const roster = await CellRoster.fromGenesis(genesis);
    if (!roster) return null;
    const chain = new CellChain(roster.chainId, await CellChain.genesisBlock(genesis), opts);
    chain.state = await chain.replay([chain.chain[0]]) as LedgerState;
    const saved = await chain.storage.load(chain.chainId).catch(() => null);
    if (saved?.blocks?.length && saved.blocks[0].hash === chain.chain[0].hash) {
      const replayed = await chain.replay(saved.blocks);
      if (replayed) {
        chain.chain = saved.blocks;
        chain.state = replayed;
      }
    }
    for (const tx of saved?.pending ?? []) await chain.queue(tx);
    return chain;
  }

  // ── Reads ──

  getChain(): SwarmBlock[] { return this.chain; }
  getLatestBlock(): SwarmBlock { return this.chain[this.chain.length - 1]; }
  getPendingTransactions(): SwarmTransaction[] { return this.pending; }
  getRoster(): CellRoster { return this.state.roster; }
  get ticker(): string { return this.state.roster.ticker; }
  get cellId(): string { return this.state.roster.cellId; }

  /** Spendable balance: rewards count once 20 blocks sit on top of them, as on the shared chain. */
  getBalance(address: string): number {
    const probe = this.state.clone();
    probe.ripen(this.chain.length);
    return probe.balance(address);
  }

  getImmatureRewards(address: string): number {
    const probe = this.state.clone();
    probe.ripen(this.chain.length);
    return probe.maturing.filter((m) => m.to === address).reduce((sum, m) => sum + m.amount, 0);
  }

  getTotalSupply(): number {
    let supply = 0;
    for (const block of this.chain) for (const tx of block.transactions) if (tx.type === "mining_reward") supply += Number(tx.amount) || 0;
    return supply;
  }

  /** Accounts eligible to witness the next block: the shared chain's voter rules on this chain. */
  getVoters(): Set<string> { return this.state.participation.voters(); }

  getLatestCheckpoint(): number { return latestCheckpoint(this.chain); }

  // ── Pending ──

  /** Queue a signed roster record or transfer for the next block, if it fits the chain as it stands. */
  async queue(tx: SwarmTransaction): Promise<boolean> {
    return this.exclusive(async () => {
      if (this.pending.some((p) => p.id === tx.id)) return false;
      const trial = this.state.clone();
      trial.ripen(this.chain.length);
      for (const p of this.pending) await applyTransaction(trial, p, this.now(), this.chainId);
      if (!await applyTransaction(trial, tx, this.now(), this.chainId)) return false;
      this.pending.push(tx);
      await this.persist();
      return true;
    });
  }

  /** Wrap a signed roster record for the chain. */
  async queueRosterRecord(s: SignedRosterRecord): Promise<boolean> {
    if (!await verifyRosterRecord(s)) return false;
    return this.queue(rosterTransaction(this.chainId, s, await rosterRecordHash(s)));
  }

  // ── Mining ──

  /**
   * Mine the next block, as a member. Null when the signer isn't a member,
   * this beat already has a block, or a peer's block landed while we worked.
   */
  async mine(signer: BlockSigner, witnesses: Endorsement[] = []): Promise<SwarmBlock | null> {
    const startedAt = this.now();
    const parent = this.getLatestBlock();
    if (!this.state.roster.isMember(signer.userId) || !beatIsFree(parent, startedAt)) return null;
    const draft = { index: parent.index + 1, timestamp: new Date(startedAt).toISOString() };

    // Carry the pending records and transfers that still fit, in order.
    const trial = this.state.clone();
    trial.ripen(draft.index);
    const carried: SwarmTransaction[] = [];
    for (const tx of this.pending) {
      if (carried.length >= MAX_CELL_BLOCK_TRANSACTIONS) break;
      const probe = trial.clone();
      if (!await applyTransaction(probe, tx, startedAt, this.chainId)) continue;
      await applyTransaction(trial, tx, startedAt, this.chainId);
      carried.push(tx);
    }

    const total = cellRewardAtHeight(draft.index);
    const poolShare = total * POOL_REWARD_SHARE;
    const rewardId = `cell-reward-${this.chainId.slice(0, 12)}-${draft.index}-${signer.userId}`;
    const base = { type: "mining_reward" as const, from: "system", timestamp: draft.timestamp, signature: "", publicKey: "", nonce: 0, fee: 0, chainId: this.chainId };
    const transactions: SwarmTransaction[] = [
      ...carried,
      { ...base, id: rewardId, to: signer.userId, amount: total - poolShare, meta: { reward: true, ticker: this.ticker } },
      { ...base, id: `${rewardId}-pool`, to: CELL_POOL, amount: poolShare, meta: { reward: true, ticker: this.ticker, poolTax: poolShare } },
    ];
    const recorded = witnesses.length ? selectWitnesses(witnesses, parent, signer.userId, this.state.participation) : [];
    const block: SwarmBlock = {
      index: draft.index,
      timestamp: draft.timestamp,
      transactions,
      previousHash: parent.hash,
      hash: "",
      nonce: 0,
      difficulty: this.difficulty,
      miner: signer.userId,
      merkleRoot: await calculateMerkleRoot(transactions),
      ...headerFor(parent, startedAt, signer),
      ...(recorded.length ? { witnesses: recorded, witnessRoot: await witnessRoot(recorded) } : {}),
    };
    const target = "0".repeat(block.difficulty);
    for (;;) {
      block.hash = await calculateHash(block);
      if (block.hash.startsWith(target)) break;
      block.nonce++;
      if (block.nonce % 1000 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    block.producerSignature = await signer.sign(block.hash);

    return this.exclusive(async () => {
      if (this.getLatestBlock().hash !== block.previousHash) return null;
      const next = await this.extend(this.state, block, this.getLatestBlock());
      if (!next) return null;
      this.commit(block, next);
      await this.persist();
      return block;
    });
  }

  // ── Peers ──

  /** Add a peer's block when it extends our tip and passes every check. */
  async appendPeerBlock(block: SwarmBlock): Promise<boolean> {
    return this.exclusive(async () => {
      const tip = this.getLatestBlock();
      if (block?.previousHash !== tip.hash) return false;
      const next = await this.extend(this.state, block, tip);
      if (!next) return false;
      this.commit(block, next);
      await this.persist();
      return true;
    });
  }

  /**
   * Switch to a peer's version of this cell chain when the shared chain's
   * fork choice prefers it and it keeps our newest checkpoint.
   */
  async adoptPeerChain(incoming: SwarmBlock[]): Promise<"adopted" | "kept" | "invalid"> {
    return this.exclusive(async () => {
      if (!incoming?.length || incoming[0].hash !== this.chain[0].hash) return "invalid";
      const candidate = [this.chain[0], ...incoming.slice(1)];
      const replayed = await this.replay(candidate);
      if (!replayed) return "invalid";
      const plan = planAdoption(this.chain, candidate, (local, theirs) => {
        if (theirs.length !== local.length) return theirs.length > local.length ? "replace" : "keep";
        return theirs[theirs.length - 1].hash < local[local.length - 1].hash ? "replace" : "keep";
      }, this.now());
      if (!plan.replace) return "kept";
      // A block most voters signed is final: never switch to a chain that drops it.
      if (plan.forkPoint <= this.getLatestCheckpoint()) return "kept";
      const dropped = this.pending;
      this.chain = candidate;
      this.state = replayed;
      this.pending = [];
      // Our records and transfers from dropped blocks go back through the checks.
      for (const tx of [...plan.requeue, ...dropped]) {
        if (tx.type === "mining_reward" || this.pending.some((p) => p.id === tx.id)) continue;
        const trial = this.state.clone();
        trial.ripen(this.chain.length);
        for (const p of this.pending) await applyTransaction(trial, p, this.now(), this.chainId);
        if (await applyTransaction(trial, tx, this.now(), this.chainId)) this.pending.push(tx);
      }
      await this.persist();
      return "adopted";
    });
  }

  // ── Validation ──

  /** Replay a whole chain from its genesis. Null when any block breaks a rule. */
  private async replay(blocks: SwarmBlock[]): Promise<LedgerState | null> {
    const genesis = blocks[0];
    if (!genesis || genesis.hash !== this.chain[0].hash || await calculateHash(genesis) !== genesis.hash) return null;
    const s = genesis.transactions[0]?.meta?.roster as SignedRosterRecord | undefined;
    const roster = s ? await CellRoster.fromGenesis(s) : null;
    if (!roster || roster.chainId !== this.chainId || genesis.transactions.length !== 1) return null;
    const participation = new Participation();
    participation.add(genesis);
    let state = new LedgerState(roster, participation);
    state.txIds.add(genesis.transactions[0].id);
    for (let i = 1; i < blocks.length; i++) {
      const next = await this.extend(state, blocks[i], blocks[i - 1]);
      if (!next) return null;
      state = next;
    }
    return state;
  }

  /**
   * The state after `block`, built on `parent` whose state is `before`; null
   * when the block breaks a rule. `before` is never changed.
   */
  private async extend(before: LedgerState, block: SwarmBlock, parent: SwarmBlock): Promise<LedgerState | null> {
    if (!block || !Array.isArray(block.transactions) || block.transactions.length > MAX_CELL_BLOCK_TRANSACTIONS + 2) return null;
    if (block.index !== parent.index + 1 || block.previousHash !== parent.hash) return null;
    if (await calculateHash(block) !== block.hash) return null;
    if (!Number.isInteger(block.difficulty) || !block.hash.startsWith("0".repeat(block.difficulty))) return null;
    const stamped = Date.parse(block.timestamp);
    // Same limit the shared chain's cadence and live-block checks use.
    if (!Number.isFinite(stamped) || stamped > this.now() + FUTURE_LIMIT_MS) return null;
    // Every cell block carries the v2 header: tick, epoch, producer, signature.
    if (block.version !== BLOCK_VERSION || !await verifyBlockHeader(block, parent, this.difficulty)) return null;
    if (!before.roster.isMember(block.producer!.userId)) return null;
    if (!validRewards(block, this.chainId)) return null;
    if (!await verifyWitnesses(block, parent, before.participation, this.chainId)) return null;

    const state = before.clone();
    state.ripen(block.index);
    for (const tx of block.transactions) {
      if (tx.type === "mining_reward") {
        if (state.txIds.has(tx.id)) return null;
        state.txIds.add(tx.id);
        state.maturing.push({ index: block.index, to: tx.to, amount: Number(tx.amount) || 0 });
        continue;
      }
      if (!await applyTransaction(state, tx, stamped, this.chainId)) return null;
    }
    state.participation.add(block);
    return state;
  }

  private commit(block: SwarmBlock, next: LedgerState): void {
    this.chain.push(block);
    this.state = next;
    const included = new Set(block.transactions.map((tx) => tx.id));
    this.pending = this.pending.filter((tx) => !included.has(tx.id));
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutation.then(fn, fn);
    this.mutation = run.catch(() => undefined);
    return run;
  }

  private async persist(): Promise<void> {
    try {
      await this.storage.save(this.chainId, { blocks: this.chain, pending: this.pending });
    } catch (err) {
      console.warn("[CellChain] save failed", err);
    }
  }
}
