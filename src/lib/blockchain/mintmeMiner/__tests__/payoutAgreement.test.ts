import { describe, expect, it, vi } from "vitest";
import { computeUserId, genIdentityKeyPair } from "@/lib/crypto";
import { createMintMeProposal, signMintMeApproval, verifyMintMeCertificate, verifyMintMeProposal,
  type MintMeAgreementVerifier, type MintMeAgreementSnapshot } from "../payoutAgreement";
import { MintMePayoutCoordinator, MINTME_AGREEMENT_CHANNEL } from "../nativePayout";

async function fixture(count = 2) {
  const keys = await Promise.all(Array.from({ length: count }, () => genIdentityKeyPair()));
  const members = await Promise.all(keys.map(k => computeUserId(k.publicKey)));
  const snapshot: MintMeAgreementSnapshot = { checkpoint: "a".repeat(64), vaultAddress: `0x${"b".repeat(40)}`,
    members, receipts: [{ txHash: `0x${"c".repeat(64)}`, amountUnits: "25000000000000000000" }], expiresAt: Date.now() + 60_000 };
  // Models a supplied authenticated checkpoint/funding source, NOT live mesh verification.
  const verifier: MintMeAgreementVerifier = {
    verifyCheckpoint: async s => s.checkpoint === snapshot.checkpoint && JSON.stringify([...s.members].sort()) === JSON.stringify([...members].sort()),
    verifyFunding: async (r, address) => address === snapshot.vaultAddress && JSON.stringify(r) === JSON.stringify(snapshot.receipts),
  };
  const proposal = await createMintMeProposal(snapshot);
  const approvals = await Promise.all(keys.map(k => signMintMeApproval(proposal.id, k.publicKey, k.privateKey)));
  return { keys, snapshot, verifier, proposal, approvals };
}

describe("account-free MintMe agreement", () => {
  it("requires both of two members and binds 1.25 retained / 11.875 each at 25 MINTME", async () => {
    const { proposal, approvals, verifier } = await fixture();
    expect(proposal.communityUnits).toBe("1250000000000000000");
    expect(proposal.perPeerUnits).toBe("11875000000000000000");
    expect(await verifyMintMeCertificate({ proposal, approvals: approvals.slice(0, 1) }, verifier)).toBe(false);
    expect(await verifyMintMeCertificate({ proposal, approvals }, verifier)).toBe(true);
  });
  it("requires a strict majority of the same membership checkpoint", async () => {
    const { proposal, approvals, verifier } = await fixture(3);
    expect(await verifyMintMeCertificate({ proposal, approvals: approvals.slice(0, 1) }, verifier)).toBe(false);
    expect(await verifyMintMeCertificate({ proposal, approvals: approvals.slice(0, 2) }, verifier)).toBe(true);
  });
  it("rejects duplicate voters and forged member identity", async () => {
    const { proposal, approvals, verifier } = await fixture();
    expect(await verifyMintMeCertificate({ proposal, approvals: [approvals[0], approvals[0]] }, verifier)).toBe(false);
    expect(await verifyMintMeCertificate({ proposal, approvals: [approvals[0], { ...approvals[1], voterId: approvals[0].voterId }] }, verifier)).toBe(false);
  });
  it("rejects unverified receipts even when all members approve", async () => {
    const { proposal, approvals, verifier } = await fixture();
    expect(await verifyMintMeCertificate({ proposal, approvals }, { ...verifier, verifyFunding: async () => false })).toBe(false);
  });
  it("rejects partition-local membership and expired checkpoints", async () => {
    const { proposal, approvals, verifier, snapshot } = await fixture(3);
    const partition = await createMintMeProposal({ ...snapshot, members: snapshot.members.slice(0, 2) });
    expect(await verifyMintMeProposal(partition, verifier)).toBe(false);
    expect(await verifyMintMeCertificate({ proposal, approvals }, verifier, proposal.expiresAt)).toBe(false);
  });
  it("rejects changed shares, receipts and cross-proposal signatures", async () => {
    const { proposal, approvals, verifier } = await fixture();
    expect(await verifyMintMeCertificate({ proposal: { ...proposal, perPeerUnits: "25000000000000000000" }, approvals }, verifier)).toBe(false);
    expect(await verifyMintMeCertificate({ proposal: { ...proposal, receipts: [{ ...proposal.receipts[0], amountUnits: "50000000000000000000" }] }, approvals }, verifier)).toBe(false);
    expect(await verifyMintMeCertificate({ proposal, approvals: approvals.map(a => ({ ...a, proposalId: "d".repeat(64) })) }, verifier)).toBe(false);
  });
  it("rejects below 25 MINTME and duplicate funding receipts", async () => {
    const { snapshot } = await fixture();
    await expect(createMintMeProposal({ ...snapshot, receipts: [{ ...snapshot.receipts[0], amountUnits: "24999999999999999999" }] })).rejects.toThrow("below 25");
    await expect(createMintMeProposal({ ...snapshot, receipts: [snapshot.receipts[0], snapshot.receipts[0]] })).rejects.toThrow("funding receipts");
  });
  it("gathers two nodes over the agreement channel and deduplicates delivery without crediting balances", async () => {
    const { snapshot, approvals, verifier } = await fixture();
    const deliveredA = vi.fn(), deliveredB = vi.fn();
    const a = new MintMePayoutCoordinator(verifier, deliveredA), b = new MintMePayoutCoordinator(verifier, deliveredB);
    const handlers = new Map<string, (peer: string, value: unknown) => void>();
    const queue: (() => void)[] = [];
    const transport = (id: string, other: string) => ({
      broadcast: (channel: string, value: unknown) => { expect(channel).toBe(MINTME_AGREEMENT_CHANNEL); queue.push(() => handlers.get(other)?.(id, structuredClone(value))); },
      onMessage: (_channel: string, handler: (peer: string, value: unknown) => void) => { handlers.set(id, handler); return () => { handlers.delete(id); }; },
    });
    const ta = transport("a", "b"), tb = transport("b", "a"); a.start(ta); b.start(tb);
    const proposal = await a.propose(snapshot, ta);
    if (!proposal) throw new Error("Proposal rejected");
    expect(await a.approve(proposal, approvals[0], ta)).toBe(true);
    expect(deliveredA).not.toHaveBeenCalled();
    expect(await b.approve(proposal, approvals[1], tb)).toBe(true);
    // Replay actual queued channel messages through each node's receive boundary.
    while (queue.length) { queue.shift()?.(); await new Promise(r => setTimeout(r, 10)); }
    await vi.waitFor(() => { expect(deliveredA).toHaveBeenCalledOnce(); expect(deliveredB).toHaveBeenCalledOnce(); });
    expect(await a.receive({ kind: "certificate", certificate: { proposal, approvals } }, ta)).toBe(true);
    expect(deliveredA).toHaveBeenCalledOnce(); a.stop(); b.stop();
  });
  it("invalidates pending validation when the coordinator stops", async () => {
    const { proposal, approvals, verifier } = await fixture();
    let release: ((result: boolean) => void) | undefined;
    const delivered = vi.fn();
    const coordinator = new MintMePayoutCoordinator({ ...verifier, verifyCheckpoint: () => new Promise(resolve => { release = resolve; }) }, delivered);
    const transport = { broadcast: vi.fn(), onMessage: () => () => {} };
    const pending = coordinator.receive({ kind: "certificate", certificate: { proposal, approvals } }, transport);
    await vi.waitFor(() => expect(release).toBeDefined()); coordinator.stop(); release?.(true);
    expect(await pending).toBe(false); expect(delivered).not.toHaveBeenCalled();
  });
});