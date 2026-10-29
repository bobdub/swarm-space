import { formatUnits } from "ethers";
import { arrayBufferToBase64, arrayBufferToHex, base64ToArrayBuffer, computeUserId } from "@/lib/crypto";
import type { SwarmTransaction } from "../types";
import { MINTME_COMMUNITY_PAYOUT_TYPE, MINTME_COMMUNITY_POOL, readCommunityPayout } from "../wallets/nativeMintmeLedger";
import { MINTME_PAYOUT_THRESHOLD_UNITS, planMintMePayout } from "./payoutPolicy";

/**
 * Mesh-agreed MintMe community payouts. No vault account and no vault key:
 * every node reads the same community vault balance, and when 25+ MINTME is
 * available the agreeing nodes (majority of the mesh, at least two) sign a vote.
 * The signed votes ARE the authority. Each payout round is numbered, so a round
 * can only be paid once on any ledger.
 */
export interface MintMeCommunityVote {
  proposalId: string;
  round: number;
  availableUnits: string;
  voterId: string;
  publicKey: string;
  signature: string;
}

export async function communityProposalId(round: number, availableUnits: bigint): Promise<string> {
  const body = new TextEncoder().encode(`SWARM MINTME community payout v2\n${round}\n${availableUnits}`);
  return arrayBufferToHex(await crypto.subtle.digest("SHA-256", body));
}

const voteMessage = (proposalId: string) => new TextEncoder().encode(`SWARM MINTME community vote v2\n${proposalId}`);

export async function signCommunityVote(round: number, availableUnits: bigint, publicKey: string, privateKey: string): Promise<MintMeCommunityVote> {
  const proposalId = await communityProposalId(round, availableUnits);
  const key = await crypto.subtle.importKey("pkcs8", base64ToArrayBuffer(privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, voteMessage(proposalId));
  return { proposalId, round, availableUnits: availableUnits.toString(), voterId: await computeUserId(publicKey), publicKey, signature: arrayBufferToBase64(signature) };
}

export async function verifyCommunityVote(vote: MintMeCommunityVote): Promise<boolean> {
  try {
    if (!Number.isSafeInteger(vote.round) || vote.round < 0 || !/^\d+$/.test(vote.availableUnits)) return false;
    if (await communityProposalId(vote.round, BigInt(vote.availableUnits)) !== vote.proposalId) return false;
    if (await computeUserId(vote.publicKey) !== vote.voterId) return false;
    const key = await crypto.subtle.importKey("spki", base64ToArrayBuffer(vote.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64ToArrayBuffer(vote.signature), voteMessage(vote.proposalId));
  } catch { return false; }
}

/** Distinct payout rounds already on the ledger (first record per round wins). */
export function communityPayouts(transactions: readonly SwarmTransaction[]) {
  const rounds = new Map<number, NonNullable<ReturnType<typeof readCommunityPayout>>>();
  for (const tx of transactions) {
    const payout = readCommunityPayout(tx);
    if (payout && !rounds.has(payout.round)) rounds.set(payout.round, payout);
  }
  return [...rounds.values()];
}

export const nextCommunityRound = (transactions: readonly SwarmTransaction[]) => communityPayouts(transactions).length;

/** Vault balance minus everything already shared and the 5% already set aside. */
export function availableCommunityUnits(vaultUnits: bigint, transactions: readonly SwarmTransaction[]): bigint {
  const used = communityPayouts(transactions).reduce((sum, p) => sum + p.perPeerUnits * BigInt(p.recipients.length) + p.communityUnits, 0n);
  return vaultUnits > used ? vaultUnits - used : 0n;
}

/** Builds the ledger record once enough distinct members signed the same proposal. */
export async function buildCommunityPayoutTx(votes: readonly MintMeCommunityVote[], required = 2): Promise<SwarmTransaction | null> {
  const byVoter = new Map<string, MintMeCommunityVote>();
  for (const vote of votes) if (!byVoter.has(vote.voterId)) byVoter.set(vote.voterId, vote);
  const approvals = [...byVoter.values()].sort((a, b) => a.voterId.localeCompare(b.voterId));
  if (approvals.length < Math.max(2, required)) return null;
  const { proposalId, round, availableUnits } = approvals[0];
  if (approvals.some(v => v.proposalId !== proposalId)) return null;
  for (const vote of approvals) if (!await verifyCommunityVote(vote)) return null;
  const available = BigInt(availableUnits);
  if (available < MINTME_PAYOUT_THRESHOLD_UNITS) return null;
  const plan = planMintMePayout(available, approvals.map(v => v.voterId));
  if (plan.status !== "ready" || plan.perPeerUnits <= 0n) return null;
  return {
    id: `mintme-community-payout-${round}`,
    type: MINTME_COMMUNITY_PAYOUT_TYPE as SwarmTransaction["type"],
    from: MINTME_COMMUNITY_POOL, to: MINTME_COMMUNITY_POOL,
    amount: Number(formatUnits(plan.peersTotalUnits, 18)),
    timestamp: new Date(0).toISOString(),
    signature: "", publicKey: "", nonce: round, fee: 0, chainId: "SWARM",
    meta: {
      currency: "MINTME", round, proposalId, availableUnits,
      recipients: plan.recipients, perPeerUnits: plan.perPeerUnits.toString(),
      communityUnits: plan.communityUnits.toString(),
      approvals: approvals.map(v => ({ ...v })),
    },
  };
}

/** Re-derives the record from its signed votes; any edited amount or recipient fails. */
export async function verifyCommunityPayoutTx(tx: SwarmTransaction): Promise<boolean> {
  try {
    const parsed = readCommunityPayout(tx);
    const approvals = tx.meta?.approvals;
    if (!parsed || !Array.isArray(approvals) || approvals.length > 1000) return false;
    const expected = await buildCommunityPayoutTx(approvals as MintMeCommunityVote[]);
    if (!expected || expected.id !== tx.id || approvals.length !== (expected.meta!.approvals as unknown[]).length) return false;
    const e = expected.meta!, m = tx.meta!;
    return e.round === m.round && e.availableUnits === m.availableUnits && e.proposalId === m.proposalId
      && e.perPeerUnits === m.perPeerUnits && e.communityUnits === m.communityUnits
      && JSON.stringify(e.recipients) === JSON.stringify(m.recipients) && expected.amount === tx.amount;
  } catch { return false; }
}

/** One record per round, appended in order: a round can never be paid twice. */
export function canAppendCommunityPayout(transactions: readonly SwarmTransaction[], tx: SwarmTransaction): boolean {
  const parsed = readCommunityPayout(tx);
  return !!parsed && parsed.round === nextCommunityRound(transactions);
}
