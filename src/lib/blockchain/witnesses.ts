/**
 * Witnessed blocks: endorsements recorded on the chain, the voter list read
 * from it, and checkpoints.
 *
 * - Each block records the signed agreements its parent collected (its
 *   "witnesses"). They are hashed into the block through `witnessRoot`, so
 *   every peer reads the same record. Recorded from the new-rules cutoff on.
 * - Voters are the accounts that took part recently: produced a block or had
 *   an agreement recorded within the active window. A newcomer waits: its
 *   first appearance must sit at least NEWCOMER_WAIT_BLOCKS deep before it
 *   can vote. A block may bring at most one new identity onto the chain, so
 *   a miner can't seat a crowd of fresh accounts at once.
 * - A block is a checkpoint once its child records agreements from a
 *   majority of the voters eligible to witness it. Peers never switch to a
 *   chain that drops a checkpoint.
 */
import { sha256Async } from "./crypto";
import { verifyEndorsement, type Endorsement } from "./endorsements";
import { SELF_MINT_CUTOFF_MS } from "./issuance";
import type { SwarmBlock } from "./types";

/** Blocks stamped from this instant on may record witnesses (the shared new-rules cutoff). */
export const WITNESS_CUTOFF_MS = SELF_MINT_CUTOFF_MS;
export const MAX_WITNESSES_PER_BLOCK = 32;
/** New identities (producer or witness) a single block may bring onto the chain. */
export const MAX_NEW_IDENTITIES_PER_BLOCK = 1;
/** An account stays a voter while it took part within this many blocks (about a day of beats). */
export const ACTIVE_WINDOW_BLOCKS = 2_880;
/** A newcomer's first appearance must be this many blocks deep before it votes (about an hour of beats). */
export const NEWCOMER_WAIT_BLOCKS = 120;

export function blockMayRecordWitnesses(block: Pick<SwarmBlock, "timestamp">, cutoffMs = WITNESS_CUTOFF_MS): boolean {
  const stamped = Date.parse(block.timestamp);
  return Number.isFinite(stamped) && stamped >= cutoffMs;
}

export function witnessRoot(witnesses: Endorsement[]): Promise<string> {
  return sha256Async(JSON.stringify(witnesses));
}

/** The accounts a block shows taking part: its v2 producer and its recorded witnesses. */
export function participantsOf(block: Pick<SwarmBlock, "version" | "producer" | "witnesses">): string[] {
  const ids: string[] = [];
  if (block.version === 2 && typeof block.producer?.userId === "string") ids.push(block.producer.userId);
  for (const e of block.witnesses ?? []) if (typeof e?.voter === "string") ids.push(e.voter);
  return ids;
}

/** Who has taken part, and when, along a chain read from genesis. */
export class Participation {
  private first = new Map<string, number>();
  private last = new Map<string, number>();
  /** Height of the last block added. */
  height = -1;

  static of(chain: SwarmBlock[]): Participation {
    const p = new Participation();
    for (const block of chain) p.add(block);
    return p;
  }

  clone(): Participation {
    const copy = new Participation();
    copy.first = new Map(this.first);
    copy.last = new Map(this.last);
    copy.height = this.height;
    return copy;
  }

  add(block: SwarmBlock): void {
    for (const id of participantsOf(block)) {
      if (!this.first.has(id)) this.first.set(id, block.index);
      this.last.set(id, block.index);
    }
    this.height = block.index;
  }

  known(id: string): boolean {
    return this.first.has(id);
  }

  /** Accounts eligible to witness the block after the last one added. */
  voters(): Set<string> {
    const out = new Set<string>();
    for (const [id, first] of this.first) {
      if (this.height - first < NEWCOMER_WAIT_BLOCKS) continue;
      if (this.height - (this.last.get(id) ?? -Infinity) >= ACTIVE_WINDOW_BLOCKS) continue;
      out.add(id);
    }
    return out;
  }
}

type WitnessCandidate = Pick<Endorsement, "blockHash" | "height" | "agree" | "voter">;

/** The structural rules a witness entry must meet for `parent`, before any signature check. */
function fitsParent(e: WitnessCandidate | null | undefined, parent: Pick<SwarmBlock, "hash" | "index" | "miner">): boolean {
  return !!e && e.blockHash === parent.hash && e.height === parent.index && e.agree === true
    && typeof e.voter === "string" && e.voter !== parent.miner;
}

/**
 * Pick which agreements a new block records: those for its parent, one per
 * voter, known accounts first, with at most one new identity in the block
 * (the producer counts if it is new itself).
 */
export function selectWitnesses(
  candidates: Endorsement[],
  parent: SwarmBlock,
  producer: string,
  participation: Pick<Participation, "known">,
): Endorsement[] {
  let fresh = MAX_NEW_IDENTITIES_PER_BLOCK - (participation.known(producer) ? 0 : 1);
  const seen = new Set<string>();
  const ordered = [...candidates].sort((a, b) => Number(participation.known(b.voter)) - Number(participation.known(a.voter)));
  const out: Endorsement[] = [];
  for (const e of ordered) {
    if (out.length >= MAX_WITNESSES_PER_BLOCK) break;
    if (!fitsParent(e, parent) || seen.has(e.voter)) continue;
    if (!participation.known(e.voter) && e.voter !== producer) {
      if (fresh <= 0) continue;
      fresh--;
    }
    seen.add(e.voter);
    out.push(e);
  }
  return out;
}

/** Check a block's recorded witnesses against its parent and the chain before it. */
export async function verifyWitnesses(
  block: SwarmBlock,
  parent: SwarmBlock,
  participation: Pick<Participation, "known">,
  /** The chain the endorsements must name: SWARM, or a cell chain's id. */
  network?: string,
): Promise<boolean> {
  if (block.witnesses === undefined && block.witnessRoot === undefined) return true;
  if (block.version !== 2 || !blockMayRecordWitnesses(block)) return false;
  const list = block.witnesses;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_WITNESSES_PER_BLOCK) return false;
  if (block.witnessRoot !== await witnessRoot(list)) return false;
  const producer = block.producer?.userId;
  let fresh = producer && participation.known(producer) ? 0 : 1;
  const voters = new Set<string>();
  for (const e of list) {
    if (!fitsParent(e, parent) || voters.has(e.voter)) return false;
    voters.add(e.voter);
    if (!participation.known(e.voter) && e.voter !== producer) fresh++;
  }
  if (fresh > MAX_NEW_IDENTITIES_PER_BLOCK) return false;
  for (const e of list) if (!await verifyEndorsement(e, network)) return false;
  return true;
}

/** True when `child` records agreements from a majority of `voters` (the parent's producer left out). */
export function seals(child: Pick<SwarmBlock, "witnesses">, voters: Set<string>): boolean {
  if (voters.size === 0 || !child.witnesses?.length) return false;
  const signed = child.witnesses.filter((e) => voters.has(e.voter)).length;
  return signed >= Math.floor(voters.size / 2) + 1;
}

/** Height of the newest checkpoint on a chain, or -1 when there is none. */
export function latestCheckpoint(chain: SwarmBlock[]): number {
  const p = new Participation();
  let found = -1;
  for (let i = 0; i < chain.length - 1; i++) {
    p.add(chain[i]);
    if (!chain[i + 1].witnesses?.length) continue;
    const voters = p.voters();
    const producer = chain[i].producer?.userId ?? chain[i].miner;
    if (producer) voters.delete(producer);
    if (seals(chain[i + 1], voters)) found = chain[i].index;
  }
  return found;
}
