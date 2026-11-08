import { describe, expect, it } from "vitest";
import { Wallet, parseUnits } from "ethers";
import type { SwarmTransaction } from "../../types";
import { nativeMintMeBalanceUnits, mintMeSource } from "../../wallets/nativeMintmeLedger";
import { INFINITY_VAULTS } from "../../infinity/vaults";
import { buildClaimCalldata, signRewardAttestation, validAttesters } from "../rewardContract";
import { MintMeAutoClaim, roundQuorum } from "../autoClaim";
import { processWithdraw, COMING_SOON, type WithdrawEntry } from "../../wallets/mintmeWithdrawQueue";

// Public deterministic fixtures only; never used by real accounts.
const testWallet = (n: number) => new Wallet(`0x${n.toString(16).padStart(64, "0")}`);
const CONTRACT = "0x1111111111111111111111111111111111111111";
const per = parseUnits("11.875", 18);
const payout = (round: number): SwarmTransaction => ({
  id: `mintme-community-payout-${round}`, type: "mintme_community_payout" as SwarmTransaction["type"],
  from: INFINITY_VAULTS.mintme, to: INFINITY_VAULTS.mintme, amount: 23.75, chainId: "SWARM",
  timestamp: new Date(0).toISOString(), publicKey: "", signature: "", nonce: round, fee: 0,
  meta: { round, recipients: ["alice", "bob"], perPeerUnits: per.toString(), communityUnits: parseUnits("1.25", 18).toString(), retainedTo: INFINITY_VAULTS.market,
    votes: [{ voterId: "alice" }, { voterId: "bob" }] },
});

describe("one MINTME balance", () => {
  it("mined rewards land in the same balance and count once", () => {
    const tx = payout(0);
    expect(nativeMintMeBalanceUnits([tx, tx], "alice")).toBe(per);
    expect(mintMeSource(tx)).toBe("mined");
  });
});

describe("reward contract attestations", () => {
  const a = testWallet(1), b = testWallet(2), me = testWallet(3);
  it("needs two distinct valid peer signatures", async () => {
    const s1 = await signRewardAttestation(a, CONTRACT, 0, me.address, per);
    const s2 = await signRewardAttestation(b, CONTRACT, 0, me.address, per);
    expect(buildClaimCalldata(CONTRACT, 0, me.address, per, [s1, s1], 2)).toBeNull();
    expect(buildClaimCalldata(CONTRACT, 0, me.address, per, [s1, s2], 2)).toMatch(/^0x/);
  });
  it("rejects a signature for a different amount or recipient", async () => {
    const s = await signRewardAttestation(a, CONTRACT, 0, me.address, per);
    expect(validAttesters(CONTRACT, 0, me.address, per + 1n, [s])).toHaveLength(0);
    expect(validAttesters(CONTRACT, 0, b.address, per, [{ ...s, recipient: b.address }])).toHaveLength(0);
  });
  it("quorum is a strict majority, minimum two", () => {
    expect(roundQuorum(payout(0))).toBe(2);
  });
});

describe("automatic claim", () => {
  it("claims once at quorum and skips while locked", async () => {
    const peers = [testWallet(4), testWallet(5)], mine = testWallet(6);
    const ledger = [payout(0)];
    const claims = new Map<number, string>();
    const sent: string[] = [];
    let locked = true;
    const bus: Array<(m: unknown) => void> = [];
    const node = (id: string, w: Wallet) => new MintMeAutoClaim({
      transport: { broadcast: (_c, m) => bus.forEach(h => h(m)), onMessage: () => () => {} },
      ledger: () => ledger, memberId: () => id, contract: () => CONTRACT,
      signer: async () => (id === "alice" && locked ? null : w),
      submitClaim: async d => { sent.push(d); return "0xhash"; },
      claims: { get: r => (id === "alice" ? claims.get(r) ?? null : null), set: (r, h) => claims.set(r, h) },
    });
    const alice = node("alice", mine);
    const others = peers.map((w, i) => node(`peer${i}`, w));
    bus.push(m => void alice.receive(m), ...others.map(o => (m: unknown) => void o.receive(m)));
    await alice.tick();
    expect(sent).toHaveLength(0);
    locked = false;
    await alice.tick();
    await new Promise(r => setTimeout(r, 50));
    expect(sent).toHaveLength(1);
    await alice.tick();
    expect(sent).toHaveLength(1);
  });
});

describe("withdraw queue", () => {
  const e: WithdrawEntry = { id: "1", to: CONTRACT, amount: 1, status: "queued", createdAt: 0 };
  const base = { contract: () => null, directBacked: async () => true, sendDirect: async () => "0xabc", sendContract: async () => "0xdef" };
  it("waits for a peer instead of sending", async () => {
    expect((await processWithdraw(e, { ...base, peers: () => 0 })).status).toBe("waiting-peer");
  });
  it("sends coins already at the receiving address", async () => {
    expect(await processWithdraw(e, { ...base, peers: () => 1 })).toMatchObject({ status: "sent", txHash: "0xabc" });
  });
  it("mined rewards stay queued until the contract is live", async () => {
    expect(await processWithdraw(e, { ...base, peers: () => 1, directBacked: async () => false })).toMatchObject({ status: "queued", note: COMING_SOON });
  });
  it("a failed release is reversed, not lost", async () => {
    const r = await processWithdraw(e, { ...base, peers: () => 1, sendDirect: async () => { throw new Error("boom."); } });
    expect(r.status).toBe("reversed");
  });
});
