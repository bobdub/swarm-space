import { arrayBufferToBase64, arrayBufferToHex, base64ToArrayBuffer, computeUserId } from "@/lib/crypto";
import { planMintMePayout } from "./payoutPolicy";

export interface MintMeFundingReceipt { txHash: string; amountUnits: string }
export interface MintMeAgreementSnapshot {
  checkpoint: string;
  vaultAddress: string;
  members: string[];
  receipts: MintMeFundingReceipt[];
  expiresAt: number;
}
export interface MintMePayoutProposal extends MintMeAgreementSnapshot {
  version: 1;
  id: string;
  communityUnits: string;
  perPeerUnits: string;
  remainingPoolUnits: string;
}
export interface MintMeApproval { proposalId: string; voterId: string; publicKey: string; signature: string }
export interface MintMeAgreementCertificate { proposal: MintMePayoutProposal; approvals: MintMeApproval[] }

/** These checks must come from independently authenticated network/custody state.
 * A proposed member list, neighbour count, share receipt or balance claim is not a verifier.
 */
export interface MintMeAgreementVerifier {
  verifyCheckpoint(snapshot: MintMeAgreementSnapshot): Promise<boolean>;
  verifyFunding(receipts: readonly MintMeFundingReceipt[], vaultAddress: string): Promise<boolean>;
}

const memberPattern = /^[a-f0-9]{16}$/;
const checkpointPattern = /^[a-f0-9]{64}$/;
const receiptPattern = /^0x[a-f0-9]{64}$/;

function canonicalSnapshot(snapshot: MintMeAgreementSnapshot): MintMeAgreementSnapshot {
  if (!checkpointPattern.test(snapshot.checkpoint) || !/^0x[a-f0-9]{40}$/i.test(snapshot.vaultAddress)
    || /^0x0{40}$/i.test(snapshot.vaultAddress) || !Number.isSafeInteger(snapshot.expiresAt)) throw new Error("Invalid agreement checkpoint");
  if (!Array.isArray(snapshot.members) || !snapshot.members.length || snapshot.members.length > 1000
    || snapshot.members.some(id => !memberPattern.test(id)) || new Set(snapshot.members).size !== snapshot.members.length) throw new Error("Invalid agreement members");
  if (!Array.isArray(snapshot.receipts) || !snapshot.receipts.length || snapshot.receipts.length > 1000
    || snapshot.receipts.some(r => !receiptPattern.test(r.txHash) || !/^[1-9]\d{0,77}$/.test(r.amountUnits))
    || new Set(snapshot.receipts.map(r => r.txHash)).size !== snapshot.receipts.length) throw new Error("Invalid funding receipts");
  return {
    checkpoint: snapshot.checkpoint, vaultAddress: snapshot.vaultAddress.toLowerCase(),
    members: [...snapshot.members].sort(),
    receipts: snapshot.receipts.map(r => ({ txHash: r.txHash, amountUnits: r.amountUnits })).sort((a, b) => a.txHash.localeCompare(b.txHash)),
    expiresAt: snapshot.expiresAt,
  };
}

export async function createMintMeProposal(snapshot: MintMeAgreementSnapshot): Promise<MintMePayoutProposal> {
  const canonical = canonicalSnapshot(snapshot);
  const units = canonical.receipts.reduce((sum, r) => sum + BigInt(r.amountUnits), 0n);
  const plan = planMintMePayout(units, canonical.members);
  if (plan.status !== "ready") throw new Error("Community earnings are below 25 MINTME");
  const body = { version: 1 as const, ...canonical, communityUnits: plan.communityUnits.toString(),
    perPeerUnits: plan.perPeerUnits.toString(), remainingPoolUnits: plan.remainingPoolUnits.toString() };
  const id = arrayBufferToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body))));
  return { ...body, id };
}

export async function verifyMintMeProposal(proposal: MintMePayoutProposal, verifier: MintMeAgreementVerifier, now = Date.now()): Promise<boolean> {
  try {
    if (proposal.version !== 1 || now >= proposal.expiresAt) return false;
    const expected = await createMintMeProposal(proposal);
    if (expected.id !== proposal.id || expected.communityUnits !== proposal.communityUnits
      || expected.perPeerUnits !== proposal.perPeerUnits || expected.remainingPoolUnits !== proposal.remainingPoolUnits
      || JSON.stringify(expected.members) !== JSON.stringify(proposal.members)
      || JSON.stringify(expected.receipts) !== JSON.stringify(proposal.receipts)) return false;
    return await verifier.verifyCheckpoint(expected) && await verifier.verifyFunding(expected.receipts, expected.vaultAddress);
  } catch { return false; }
}

function approvalMessage(proposalId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`SWARM native MINTME community approval v1\n${proposalId}`);
}

/** Member identity authorization only; never a community key or an external-chain signature. */
export async function signMintMeApproval(proposalId: string, publicKey: string, privateKey: string): Promise<MintMeApproval> {
  if (!checkpointPattern.test(proposalId)) throw new Error("Invalid proposal identifier");
  const key = await crypto.subtle.importKey("pkcs8", base64ToArrayBuffer(privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, approvalMessage(proposalId));
  return { proposalId, voterId: await computeUserId(publicKey), publicKey, signature: arrayBufferToBase64(signature) };
}

export async function verifyMintMeApproval(proposal: MintMePayoutProposal, approval: MintMeApproval): Promise<boolean> {
  try {
    if (approval.proposalId !== proposal.id || !proposal.members.includes(approval.voterId)
      || await computeUserId(approval.publicKey) !== approval.voterId) return false;
    const key = await crypto.subtle.importKey("spki", base64ToArrayBuffer(approval.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
      base64ToArrayBuffer(approval.signature), approvalMessage(proposal.id));
  } catch { return false; }
}

export async function verifyMintMeCertificate(certificate: MintMeAgreementCertificate, verifier: MintMeAgreementVerifier, now = Date.now()): Promise<boolean> {
  try {
    if (!await verifyMintMeProposal(certificate.proposal, verifier, now)) return false;
    const { approvals, proposal } = certificate;
    if (!Array.isArray(approvals) || approvals.length > proposal.members.length
      || new Set(approvals.map(a => a.voterId)).size !== approvals.length) return false;
    for (const approval of approvals) if (!await verifyMintMeApproval(proposal, approval)) return false;
    return approvals.length >= Math.floor(proposal.members.length / 2) + 1;
  } catch { return false; }
}