import { computeUserId } from "@/lib/crypto";
import { MintMePayoutCoordinator, type MintMeAgreementTransport } from "./nativePayout";
import { signMintMeApproval, type MintMeAgreementCertificate, type MintMeAgreementSnapshot,
  type MintMeAgreementVerifier, type MintMePayoutProposal } from "./payoutAgreement";
import type { MintMeVoteJournal } from "./payoutJournal";

export interface MintMeSharedPayoutSource extends MintMeAgreementVerifier {
  /** An authenticated, shared checkpoint; never synthesized from local neighbours. */
  readSnapshot(): Promise<MintMeAgreementSnapshot | null>;
  /** Must atomically allocate receipts globally, retain 5%, and durably deliver native
   * MINTME exactly once. Returning true means committed, not merely broadcast. */
  commit(certificate: MintMeAgreementCertificate): Promise<boolean>;
}
export interface MintMeMemberSigner {
  userId: string;
  publicKey: string;
  readUnlockedKey(): Promise<string | null>;
}

/** Automatic protocol orchestration; no community login and no key prompt.
 * Deliberately has no default shared source: the existing mesh is transport only.
 */
export class AutomaticMintMePayout {
  private coordinator: MintMePayoutCoordinator;
  private transport: MintMeAgreementTransport | undefined;
  private generation = 0;
  private ticking = false;
  private signing = new Set<string>();
  private commits = new Map<string, MintMeAgreementCertificate>();
  constructor(private readonly source: MintMeSharedPayoutSource, private readonly journal: MintMeVoteJournal,
    private readonly signer: MintMeMemberSigner) {
    this.coordinator = new MintMePayoutCoordinator(source, certificate => {
      this.commits.set(certificate.proposal.id, certificate);
    }, proposal => this.approve(proposal));
  }

  start(transport: MintMeAgreementTransport): void {
    this.stop(); this.transport = transport; this.coordinator.start(transport);
  }
  stop(): void {
    this.generation++; this.transport = undefined; this.coordinator.stop();
    this.commits.clear(); this.signing.clear();
  }

  /** Caller schedules this on shared-state updates and periodic retry while online. */
  async tick(): Promise<void> {
    const transport = this.transport, generation = this.generation;
    if (!transport || this.ticking) return;
    this.ticking = true;
    try {
      // Failed delivery stays pending. The authoritative commit must be idempotent
      // across certificate IDs too, using receipt/checkpoint-exclusive allocation.
      for (const [id, certificate] of this.commits) {
        if (generation !== this.generation) return;
        if (await this.source.commit(structuredClone(certificate))) this.commits.delete(id);
      }
      const snapshot = await this.source.readSnapshot();
      if (!snapshot || generation !== this.generation || !snapshot.members.includes(this.signer.userId)) return;
      await this.coordinator.propose(snapshot, transport);
    } catch { /* Unavailable/unfunded shared state stays closed and is retried. */ }
    finally { this.ticking = false; }
  }

  private async approve(proposal: MintMePayoutProposal): Promise<void> {
    const transport = this.transport, generation = this.generation;
    if (!transport || this.signing.has(proposal.id) || !proposal.members.includes(this.signer.userId)) return;
    this.signing.add(proposal.id);
    try {
      if (await computeUserId(this.signer.publicKey) !== this.signer.userId) return;
      const key = await this.signer.readUnlockedKey();
      if (!key || generation !== this.generation) return;
      if (!await this.journal.reserve(proposal, this.signer.userId) || generation !== this.generation) return;
      const approval = await signMintMeApproval(proposal.id, this.signer.publicKey, key);
      if (generation === this.generation) await this.coordinator.approve(proposal, approval, transport);
    } catch { /* Locked identity/storage failure never prompts or issues an approval. */ }
    finally { this.signing.delete(proposal.id); }
  }
}