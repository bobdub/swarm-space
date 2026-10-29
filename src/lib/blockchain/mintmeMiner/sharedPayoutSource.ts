import type { MintMeAgreementCertificate, MintMeAgreementSnapshot, MintMeFundingReceipt } from "./payoutAgreement";
import type { MintMeSharedPayoutSource } from "./automaticPayout";
import { verifyMintMeFundingOnChain } from "./verifiedFunding";

/** Implemented by authenticated network checkpoint/custody infrastructure, NOT
 * an unsigned Gun advertisement or the current node's connected-peer list. */
export interface MintMeAuthoritativePayoutBackend {
  readAuthenticatedSnapshot(): Promise<MintMeAgreementSnapshot | null>;
  commitExclusiveAllocation(certificate: MintMeAgreementCertificate): Promise<boolean>;
}

export class VerifiedMintMeSharedSource implements MintMeSharedPayoutSource {
  constructor(private readonly backend: MintMeAuthoritativePayoutBackend,
    private readonly vaultAddress: string,
    private readonly funding = verifyMintMeFundingOnChain) {}

  async readSnapshot(): Promise<MintMeAgreementSnapshot | null> {
    const snapshot = await this.backend.readAuthenticatedSnapshot();
    if (!snapshot || snapshot.vaultAddress.toLowerCase() !== this.vaultAddress.toLowerCase()
      || snapshot.expiresAt <= Date.now()) return null;
    // Detach shared state; all voters compare the same canonical snapshot.
    return structuredClone(snapshot);
  }

  async verifyCheckpoint(candidate: MintMeAgreementSnapshot): Promise<boolean> {
    try {
      const snapshot = await this.readSnapshot();
      if (!snapshot) return false;
      const canonical = (s: MintMeAgreementSnapshot) => JSON.stringify({
        checkpoint: s.checkpoint, vault: s.vaultAddress.toLowerCase(), expiresAt: s.expiresAt,
        members: [...s.members].sort(),
        receipts: s.receipts.map(r => ({ txHash: r.txHash, amountUnits: r.amountUnits })).sort((a, b) => a.txHash.localeCompare(b.txHash)),
      });
      return canonical(snapshot) === canonical(candidate);
    } catch { return false; }
  }

  verifyFunding(receipts: readonly MintMeFundingReceipt[], vault: string): Promise<boolean> {
    return this.funding(receipts, vault, this.vaultAddress);
  }

  async commit(certificate: MintMeAgreementCertificate): Promise<boolean> {
    // Revalidation and exclusivity MUST happen atomically in the authoritative
    // backend. A client precheck cannot close an allocation race across partitions.
    return this.backend.commitExclusiveAllocation(structuredClone(certificate));
  }
}