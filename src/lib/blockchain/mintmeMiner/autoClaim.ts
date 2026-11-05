/**
 * Automatic contract claims for settled MintMe community rounds.
 * The recipient asks connected peers for attestations; each peer checks its own
 * ledger (recipient + amount in that round) and signs with its unlocked cold key.
 * At quorum the recipient's wallet submits claim() itself — no Claim button.
 * A locked wallet simply skips; the next tick after unlock continues.
 */
import type { SwarmTransaction } from "../types";
import { readCommunityPayout } from "../wallets/nativeMintmeLedger";
import { buildClaimCalldata, signRewardAttestation, validAttesters, type RewardAttestation } from "./rewardContract";

export const MINTME_ATTEST_CHANNEL = "mintme-reward-attest-v1";

type Msg = { kind: "request"; round: number; recipientId: string; recipient: string; amountUnits: string }
  | { kind: "attest"; recipientId: string; att: RewardAttestation };

export interface ClaimSigner { address: string; signMessage(m: Uint8Array): Promise<string> }

export interface AutoClaimDeps {
  transport: { broadcast(ch: string, m: unknown): void; onMessage(ch: string, h: (peer: string, m: unknown) => void): () => void };
  ledger(): SwarmTransaction[];
  memberId(): string | null;
  contract(): string | null;
  /** Unlocked cold key or null when the wallet is locked. */
  signer(): Promise<ClaimSigner | null>;
  submitClaim(calldata: string): Promise<string>;
  claims: { get(round: number): string | null; set(round: number, txHash: string): void };
}

/** Quorum for a round = strict majority of the peers who answered, minimum two. */
export function roundQuorum(tx: SwarmTransaction): number {
  const votes = Array.isArray(tx.meta?.votes) ? (tx.meta!.votes as unknown[]).length : 0;
  return Math.max(2, Math.floor(votes / 2) + 1);
}

export class MintMeAutoClaim {
  private atts = new Map<number, RewardAttestation[]>();
  /** First address seen per (round, recipientId); attesters never sign a second one. */
  private bound = new Map<string, string>();
  private busy = new Set<number>();
  private off?: () => void;
  constructor(private readonly d: AutoClaimDeps) {}

  start() { this.stop(); this.off = this.d.transport.onMessage(MINTME_ATTEST_CHANNEL, (_p, m) => void this.receive(m).catch(() => {})); }
  stop() { this.off?.(); this.off = undefined; }

  private payout(round: number) {
    for (const tx of this.d.ledger()) { const p = readCommunityPayout(tx); if (p?.round === round) return { p, tx }; }
    return null;
  }

  /** My unclaimed rounds: request attestations, claim at quorum. */
  async tick(): Promise<void> {
    const me = this.d.memberId(), contract = this.d.contract();
    if (!me || !contract) return;
    const signer = await this.d.signer();
    if (!signer) return; // locked: rewards wait for the next unlock
    for (const tx of this.d.ledger()) {
      const p = readCommunityPayout(tx);
      if (!p || !p.recipients.includes(me) || this.d.claims.get(p.round)) continue;
      const amountUnits = p.perPeerUnits.toString();
      this.d.transport.broadcast(MINTME_ATTEST_CHANNEL, { kind: "request", round: p.round, recipientId: me, recipient: signer.address, amountUnits });
      await this.tryClaim(p.round, signer.address, p.perPeerUnits, roundQuorum(tx));
    }
  }

  async receive(v: unknown): Promise<void> {
    if (!v || typeof v !== "object") return;
    const m = v as Msg, contract = this.d.contract();
    if (!contract) return;
    if (m.kind === "request") {
      const found = Number.isSafeInteger(m.round) ? this.payout(m.round) : null;
      if (!found || !found.p.recipients.includes(m.recipientId) || found.p.perPeerUnits.toString() !== m.amountUnits) return;
      const key = `${m.round}:${m.recipientId}`, prev = this.bound.get(key);
      if (prev && prev.toLowerCase() !== String(m.recipient).toLowerCase()) return;
      this.bound.set(key, m.recipient);
      const signer = await this.d.signer();
      if (!signer) return;
      const att = await signRewardAttestation(signer, contract, m.round, m.recipient, BigInt(m.amountUnits));
      this.d.transport.broadcast(MINTME_ATTEST_CHANNEL, { kind: "attest", recipientId: m.recipientId, att });
    } else if (m.kind === "attest") {
      if (m.recipientId !== this.d.memberId() || !m.att) return;
      const list = this.atts.get(m.att.round) ?? [];
      list.push(m.att); this.atts.set(m.att.round, list.slice(-64));
      const found = this.payout(m.att.round), signer = await this.d.signer();
      if (found && signer) await this.tryClaim(m.att.round, signer.address, found.p.perPeerUnits, roundQuorum(found.tx));
    }
  }

  private async tryClaim(round: number, recipient: string, amount: bigint, quorum: number) {
    const contract = this.d.contract();
    if (!contract || this.busy.has(round) || this.d.claims.get(round)) return;
    const list = this.atts.get(round) ?? [];
    if (validAttesters(contract, round, recipient, amount, list).length < quorum) return;
    const data = buildClaimCalldata(contract, round, recipient, amount, list, quorum);
    if (!data) return;
    this.busy.add(round);
    try { this.d.claims.set(round, await this.d.submitClaim(data)); }
    finally { this.busy.delete(round); }
  }
}

const claimsKey = (uid: string) => `swarm:mintme-claims:${uid}`;
export function readClaims(uid: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(claimsKey(uid)) ?? "{}"); } catch { return {}; }
}

/** Live wiring on the mesh with the user's cold key and the public MintMe RPC. */
export async function createMeshAutoClaim(mesh: AutoClaimDeps["transport"]) {
  const [{ getSwarmChain }, auth, { getMintMeRewardContract }, { deriveColdKey }, { mintMeReadProvider }] = await Promise.all([
    import("../chain"), import("@/lib/auth"), import("./rewardContract"), import("../wallets/coldKey"), import("../wallets/nativeMintmeCustody"),
  ]);
  const chain = getSwarmChain();
  const uid = () => auth.getCurrentUser()?.id ?? null;
  const key = async () => { const id = uid(); if (!id) return null; try { return (await deriveColdKey(id)).wallet; } catch { return null; } };
  return new MintMeAutoClaim({
    transport: mesh,
    ledger: () => [...chain.getChain().flatMap(b => b.transactions ?? []), ...chain.getPendingTransactions()],
    memberId: uid,
    contract: getMintMeRewardContract,
    signer: key,
    async submitClaim(data) {
      const wallet = await key(), contract = getMintMeRewardContract();
      if (!wallet || !contract) throw new Error("locked");
      const provider = mintMeReadProvider();
      try { return (await wallet.connect(provider).sendTransaction({ to: contract, data })).hash; } finally { provider.destroy(); }
    },
    claims: {
      get: r => { const id = uid(); return id ? readClaims(id)[r] ?? null : null; },
      set: (r, h) => { const id = uid(); if (!id) return; localStorage.setItem(claimsKey(id), JSON.stringify({ ...readClaims(id), [r]: h })); window.dispatchEvent(new Event("blockchain-transaction")); },
    },
  });
}
