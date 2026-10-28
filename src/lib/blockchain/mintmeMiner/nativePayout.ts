import { createMintMeProposal, verifyMintMeApproval, verifyMintMeCertificate, verifyMintMeProposal,
  type MintMeAgreementCertificate, type MintMeAgreementSnapshot, type MintMeAgreementVerifier,
  type MintMeApproval, type MintMePayoutProposal } from "./payoutAgreement";

export const MINTME_AGREEMENT_CHANNEL = "mintme-community-agreement-v1";
type AgreementMessage = { kind: "proposal"; proposal: MintMePayoutProposal }
  | { kind: "approval"; proposal: MintMePayoutProposal; approval: MintMeApproval }
  | { kind: "certificate"; certificate: MintMeAgreementCertificate };

export interface MintMeAgreementTransport {
  broadcast(channel: string, message: unknown): void;
  onMessage(channel: string, handler: (peerId: string, message: unknown) => void): () => void;
}

/** Collects account-free agreement, not settlement. No default custody/membership
 * verifier or ledger bypass exists. Certified rewards must pass a future durable,
 * checkpoint-exclusive allocation acceptance rule before they credit a wallet.
 */
export class MintMePayoutCoordinator {
  private proposals = new Map<string, { proposal: MintMePayoutProposal; approvals: Map<string, MintMeApproval> }>();
  private completed = new Set<string>();
  private unsubscribe: (() => void) | undefined;
  private generation = 0;
  constructor(private readonly verifier: MintMeAgreementVerifier,
    private readonly onCertificate: (certificate: MintMeAgreementCertificate) => void) {}

  start(transport: MintMeAgreementTransport): void {
    this.stop();
    this.unsubscribe = transport.onMessage(MINTME_AGREEMENT_CHANNEL, (_peer, message) => {
      void this.receive(message, transport).catch(() => {});
    });
  }

  stop(): void {
    this.generation++;
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.proposals.clear(); this.completed.clear();
  }

  async propose(snapshot: MintMeAgreementSnapshot, transport: MintMeAgreementTransport): Promise<MintMePayoutProposal | null> {
    const proposal = await createMintMeProposal(snapshot);
    if (!await this.receive({ kind: "proposal", proposal }, transport)) return null;
    transport.broadcast(MINTME_AGREEMENT_CHANNEL, { kind: "proposal", proposal });
    return proposal;
  }

  async approve(proposal: MintMePayoutProposal, approval: MintMeApproval, transport: MintMeAgreementTransport): Promise<boolean> {
    const message: AgreementMessage = { kind: "approval", proposal, approval };
    if (!await this.receive(message, transport)) return false;
    transport.broadcast(MINTME_AGREEMENT_CHANNEL, message);
    return true;
  }

  async receive(value: unknown, transport: MintMeAgreementTransport): Promise<boolean> {
    const generation = this.generation;
    try {
      if (!value || typeof value !== "object") return false;
      const message = value as AgreementMessage;
      if (message.kind === "certificate") {
        if (!await verifyMintMeCertificate(message.certificate, this.verifier) || generation !== this.generation) return false;
        this.deliver(message.certificate, transport);
        return true;
      }
      if (message.kind !== "proposal" && message.kind !== "approval") return false;
      // Copy network data before awaiting; local callers cannot mutate an approved proposal.
      const proposal = structuredClone(message.proposal);
      const approval = message.kind === "approval" ? structuredClone(message.approval) : null;
      if (!await verifyMintMeProposal(proposal, this.verifier) || generation !== this.generation) return false;
      for (const [id, entry] of this.proposals) if (entry.proposal.expiresAt <= Date.now()) this.proposals.delete(id);
      let entry = this.proposals.get(proposal.id);
      if (!entry) {
        if (this.proposals.size >= 64) return false;
        entry = { proposal, approvals: new Map() }; this.proposals.set(proposal.id, entry);
      }
      if (!approval) return true;
      if (!await verifyMintMeApproval(proposal, approval) || generation !== this.generation) return false;
      entry.approvals.set(approval.voterId, approval);
      const certificate = { proposal: entry.proposal, approvals: [...entry.approvals.values()].sort((a, b) => a.voterId.localeCompare(b.voterId)) };
      if (await verifyMintMeCertificate(certificate, this.verifier) && generation === this.generation) this.deliver(certificate, transport);
      return true;
    } catch { return false; }
  }

  private deliver(certificate: MintMeAgreementCertificate, transport: MintMeAgreementTransport): void {
    if (this.completed.has(certificate.proposal.id) || this.completed.size >= 256) return;
    this.completed.add(certificate.proposal.id);
    this.onCertificate(structuredClone(certificate));
    transport.broadcast(MINTME_AGREEMENT_CHANNEL, { kind: "certificate", certificate });
  }
}