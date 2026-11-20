import { formatUnits } from "ethers";
import type { SwarmTransaction } from "../types";
import { INFINITY_ID, INFINITY_VAULTS } from "./vaults";
import {
  INFINITY_VAULT_ALLOCATION_TYPE, nativeMintMeBalanceUnits, readVaultAllocation,
} from "../wallets/nativeMintmeLedger";

/**
 * Infinity vault allocation — phase 6 of the autonomous agent.
 *
 * Infinity proposes, peers decide. Every node derives the same proposal from
 * its own ledger: move part of the MINTME gifted to Infinity's donations vault
 * into its market vault (the liquidity layer). Nothing leaves Infinity's own
 * vaults, so a bad round can only shuffle funds between them.
 *
 * Guardrails, all re-checked by every node before the record is accepted:
 *   • kill switch: INFINITY_POOL_ALLOCATION_ENABLED off → no node proposes,
 *     votes or accepts an allocation
 *   • at most 5% of the donations vault per round, 10% per day
 *   • at least 3 distinct signed-in members say yes, and yes is a strict
 *     majority of the answers; voters only answer after 2 h connected
 *   • known purpose only: donations → market, one record per round, in order
 *
 * Votes are unsigned, as with MintMe community payouts: this is local
 * settlement among peers, not consensus.
 */
export const INFINITY_POOL_ALLOCATION_ENABLED = true;
export const ALLOCATION_ROUND_CAP_BPS = 500n;  // 5%
export const ALLOCATION_DAY_CAP_BPS = 1000n;   // 10%
export const ALLOCATION_MIN_YES = 3;
/** Below this (0.01 MINTME) a round is not worth a record. */
export const ALLOCATION_MIN_UNITS = 10n ** 16n;
export const ALLOCATION_FROM = INFINITY_VAULTS.donations;
export const ALLOCATION_TO = INFINITY_VAULTS.market;
const DAY_MS = 86_400_000;

export const allocationDay = (nowMs: number) => Math.floor(nowMs / DAY_MS);

export interface AllocationPlan { round: number; day: number; units: bigint; fromBalance: bigint; proposalId: string }
export interface AllocationVote { proposalId: string; round: number; day: number; units: string; voterId: string; agree: boolean }

export function vaultAllocations(transactions: readonly SwarmTransaction[]) {
  const rounds = new Map<number, NonNullable<ReturnType<typeof readVaultAllocation>>>();
  for (const tx of transactions) {
    const a = readVaultAllocation(tx);
    if (a && !rounds.has(a.round)) rounds.set(a.round, a);
  }
  return [...rounds.values()].sort((x, y) => x.round - y.round);
}

export const nextAllocationRound = (transactions: readonly SwarmTransaction[]) => vaultAllocations(transactions).length;

export const allocationProposalId = (round: number, day: number, units: bigint) => `alloc-r${round}-d${day}-${units}`;

/** The one proposal this ledger allows for `day`, or null when caps leave nothing worth moving. */
export function planAllocation(transactions: readonly SwarmTransaction[], day: number): AllocationPlan | null {
  if (!INFINITY_POOL_ALLOCATION_ENABLED || !Number.isSafeInteger(day)) return null;
  const done = vaultAllocations(transactions);
  const last = done[done.length - 1];
  if (last && day < last.day) return null; // days never run backwards
  const fromBalance = nativeMintMeBalanceUnits(transactions, ALLOCATION_FROM);
  if (fromBalance <= 0n) return null;
  const movedToday = done.filter((a) => a.day === day).reduce((sum, a) => sum + a.units, 0n);
  const dayCap = ((fromBalance + movedToday) * ALLOCATION_DAY_CAP_BPS) / 10_000n - movedToday;
  const roundCap = (fromBalance * ALLOCATION_ROUND_CAP_BPS) / 10_000n;
  const units = dayCap < roundCap ? dayCap : roundCap;
  if (units < ALLOCATION_MIN_UNITS) return null;
  const round = done.length;
  return { round, day, units, fromBalance, proposalId: allocationProposalId(round, day, units) };
}

/** Builds the record once enough yes answers agree with this ledger's own plan. */
export function buildAllocationTx(votes: readonly AllocationVote[], transactions: readonly SwarmTransaction[]): SwarmTransaction | null {
  const byVoter = new Map<string, AllocationVote>();
  for (const v of votes) if (v && typeof v.voterId === "string" && v.voterId && !byVoter.has(v.voterId)) byVoter.set(v.voterId, v);
  const all = [...byVoter.values()];
  if (!all.length) return null;
  const { proposalId, round, day, units } = all[0];
  if (all.some((v) => v.proposalId !== proposalId || v.round !== round || v.day !== day || v.units !== units)) return null;
  const plan = planAllocation(transactions, day);
  if (!plan || plan.proposalId !== proposalId || plan.round !== round || plan.units.toString() !== units) return null;
  const yes = all.filter((v) => v.agree === true).length;
  if (yes < ALLOCATION_MIN_YES || yes * 2 <= all.length) return null;
  return {
    id: `infinity-allocation-${round}`,
    type: INFINITY_VAULT_ALLOCATION_TYPE as SwarmTransaction["type"],
    from: ALLOCATION_FROM, to: ALLOCATION_TO,
    amount: Number(formatUnits(plan.units, 18)),
    timestamp: new Date(day * DAY_MS).toISOString(),
    signature: "", publicKey: "", nonce: round, fee: 0, chainId: "SWARM",
    meta: {
      currency: "MINTME", actor: INFINITY_ID, purpose: "market-liquidity", round, day, proposalId,
      units: plan.units.toString(), fromBalance: plan.fromBalance.toString(),
      votes: all.sort((a, b) => a.voterId.localeCompare(b.voterId)).map((v) => ({ ...v })),
    },
  };
}

/**
 * Accept only a record that re-derives exactly from its recorded answers and
 * this node's ledger, for the next round, and not dated in the future.
 */
export function verifyAllocationTx(tx: SwarmTransaction, transactions: readonly SwarmTransaction[], nowMs = Date.now()): boolean {
  try {
    if (!INFINITY_POOL_ALLOCATION_ENABLED) return false;
    const parsed = readVaultAllocation(tx);
    const votes = tx.meta?.votes;
    if (!parsed || !Array.isArray(votes) || votes.length > 1000) return false;
    if (parsed.day > allocationDay(nowMs) + 1) return false;
    if (parsed.round !== nextAllocationRound(transactions)) return false;
    const expected = buildAllocationTx(votes as AllocationVote[], transactions);
    if (!expected || expected.id !== tx.id || (expected.meta!.votes as unknown[]).length !== votes.length) return false;
    const e = expected.meta!, m = tx.meta!;
    return e.units === m.units && e.day === m.day && e.proposalId === m.proposalId && e.fromBalance === m.fromBalance
      && expected.amount === tx.amount && tx.from === expected.from && tx.to === expected.to;
  } catch { return false; }
}
