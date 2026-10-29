import { openDB } from "@/lib/store";
import type { MintMePayoutProposal } from "./payoutAgreement";

export interface MintMeVoteJournal {
  /** Persist BEFORE signing. Locks receipts and checkpoint across tabs/restarts. */
  reserve(proposal: MintMePayoutProposal, voterId: string): Promise<boolean>;
}

/** Local durable anti-equivocation, NOT global allocation consensus.
 * Locks never expire: an expired approval can still be part of a remote certificate.
 */
export class IndexedDBMintMeVoteJournal implements MintMeVoteJournal {
  async reserve(proposal: MintMePayoutProposal, voterId: string): Promise<boolean> {
    const db = await openDB();
    const keys = [
      `mintme-vote:${voterId}:checkpoint:${proposal.checkpoint}`,
      ...proposal.receipts.map(r => `mintme-vote:${voterId}:receipt:${r.txHash}`),
    ];
    return new Promise((resolve, reject) => {
      const tx = db.transaction("blockchain", "readwrite");
      const store = tx.objectStore("blockchain");
      let allowed = true, remaining = keys.length;
      tx.oncomplete = () => resolve(allowed);
      tx.onabort = () => { if (allowed) reject(tx.error ?? new Error("Payout journal aborted")); else resolve(false); };
      tx.onerror = () => reject(tx.error ?? new Error("Payout journal failed"));
      for (const key of keys) {
        const request = store.get(key);
        request.onsuccess = () => {
          if (!allowed) return;
          if (request.result && request.result.proposalId !== proposal.id) {
            allowed = false; tx.abort(); return;
          }
          remaining--;
          if (remaining === 0) for (const id of keys) store.put({ id, proposalId: proposal.id });
        };
      }
    });
  }
}