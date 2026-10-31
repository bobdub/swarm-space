import { formatUnits } from "ethers";
import type { SwarmTransaction } from "../types";
import { MINTME_COMMUNITY_PAYOUT_TYPE, readCommunityPayout } from "../wallets/nativeMintmeLedger";
import { INFINITY_ID, INFINITY_VAULTS } from "../infinity/vaults";
import { MINTME_PAYOUT_THRESHOLD_UNITS, planMintMePayout } from "./payoutPolicy";

/**
 * Infinity network action: MintMe community payout. No signatures — connected
 * mesh peers each read the pool themselves and answer yes/no. A strict majority
 * of yes answers (at least two), or Infinity's mesh-wide tie-break, commits the
 * round. Every node re-checks the record against its own ledger.
 */
export interface MintMeCommunityVote {
  proposalId: string;
  round: number;
  availableUnits: string;
  voterId: string;
  agree: boolean;
}

export interface InfinityTieBreak {
  /** Pool readings gathered on Infinity's trip across the mesh. */
  readings: { voterId: string; units: string }[];
  decision: boolean;
}

export const communityProposalId = (round: number, availableUnits: bigint) => `mintme-r${round}-${availableUnits}`;

/** Infinity's deciding answer: yes only when a majority of reached peers read at least the proposal. */
export function infinityTieDecision(readings: InfinityTieBreak["readings"], proposed: bigint): boolean {
  const unique = new Map(readings.filter(r => /^\d+$/.test(r.units)).map(r => [r.voterId, BigInt(r.units)]));
  if (unique.size < 2) return false;
  const confirm = [...unique.values()].filter(u => u >= proposed).length;
  return confirm * 2 > unique.size;
}

export function communityPayouts(transactions: readonly SwarmTransaction[]) {
  const rounds = new Map<number, NonNullable<ReturnType<typeof readCommunityPayout>>>();
  for (const tx of transactions) {
    const payout = readCommunityPayout(tx);
    if (payout && !rounds.has(payout.round)) rounds.set(payout.round, payout);
  }
  return [...rounds.values()];
}

export const nextCommunityRound = (transactions: readonly SwarmTransaction[]) => communityPayouts(transactions).length;

/** Pool balance minus everything already shared and the 5% already moved to the market. */
export function availableCommunityUnits(vaultUnits: bigint, transactions: readonly SwarmTransaction[]): bigint {
  const used = communityPayouts(transactions).reduce((sum, p) => sum + p.perPeerUnits * BigInt(p.recipients.length) + p.communityUnits, 0n);
  return vaultUnits > used ? vaultUnits - used : 0n;
}

/** Builds the network action once yes answers win the majority (or Infinity breaks a tie). */
export function buildCommunityPayoutTx(votes: readonly MintMeCommunityVote[], required = 2, tieBreak?: InfinityTieBreak): SwarmTransaction | null {
  const byVoter = new Map<string, MintMeCommunityVote>();
  for (const vote of votes) if (vote && typeof vote.voterId === "string" && !byVoter.has(vote.voterId)) byVoter.set(vote.voterId, vote);
  const all = [...byVoter.values()];
  if (!all.length) return null;
  const { proposalId, round, availableUnits } = all[0];
  if (all.some(v => v.proposalId !== proposalId || v.round !== round || v.availableUnits !== availableUnits)) return null;
  if (!Number.isSafeInteger(round) || round < 0 || !/^\d+$/.test(availableUnits)) return null;
  const available = BigInt(availableUnits);
  if (proposalId !== communityProposalId(round, available) || available < MINTME_PAYOUT_THRESHOLD_UNITS) return null;
  const yes = all.filter(v => v.agree).sort((a, b) => a.voterId.localeCompare(b.voterId));
  const no = all.length - yes.length;
  if (yes.length < 2) return null;
  if (tieBreak) {
    if (yes.length !== no || tieBreak.decision !== infinityTieDecision(tieBreak.readings, available) || !tieBreak.decision) return null;
  } else if (yes.length < Math.max(2, required)) return null;
  const plan = planMintMePayout(available, yes.map(v => v.voterId));
  if (plan.status !== "ready" || plan.perPeerUnits <= 0n) return null;
  return {
    id: `mintme-community-payout-${round}`,
    type: MINTME_COMMUNITY_PAYOUT_TYPE as SwarmTransaction["type"],
    from: INFINITY_VAULTS.mintme, to: INFINITY_VAULTS.mintme,
    amount: Number(formatUnits(plan.peersTotalUnits, 18)),
    timestamp: new Date(0).toISOString(),
    signature: "", publicKey: "", nonce: round, fee: 0, chainId: "SWARM",
    meta: {
      currency: "MINTME", actor: INFINITY_ID, round, proposalId, availableUnits,
      recipients: plan.recipients, perPeerUnits: plan.perPeerUnits.toString(),
      communityUnits: plan.communityUnits.toString(), retainedTo: INFINITY_VAULTS.market,
      votes: all.sort((a, b) => a.voterId.localeCompare(b.voterId)).map(v => ({ ...v })),
      ...(tieBreak ? { tieBreak } : {}),
    },
  };
}

/** Re-derives the action from its recorded answers; any edited amount or recipient fails. */
export function verifyCommunityPayoutTx(tx: SwarmTransaction): boolean {
  try {
    const parsed = readCommunityPayout(tx);
    const votes = tx.meta?.votes;
    if (!parsed || !Array.isArray(votes) || votes.length > 1000) return false;
    const expected = buildCommunityPayoutTx(votes as MintMeCommunityVote[], 2, tx.meta?.tieBreak as InfinityTieBreak | undefined);
    if (!expected || expected.id !== tx.id || (expected.meta!.votes as unknown[]).length !== votes.length) return false;
    const e = expected.meta!, m = tx.meta!;
    return e.round === m.round && e.availableUnits === m.availableUnits && e.proposalId === m.proposalId
      && e.perPeerUnits === m.perPeerUnits && e.communityUnits === m.communityUnits && e.retainedTo === m.retainedTo
      && JSON.stringify(e.recipients) === JSON.stringify(m.recipients) && expected.amount === tx.amount
      && tx.from === expected.from && tx.to === expected.to;
  } catch { return false; }
}

/** One record per round, appended in order: a round can never be paid twice. */
export function canAppendCommunityPayout(transactions: readonly SwarmTransaction[], tx: SwarmTransaction): boolean {
  const parsed = readCommunityPayout(tx);
  return !!parsed && parsed.round === nextCommunityRound(transactions);
}
