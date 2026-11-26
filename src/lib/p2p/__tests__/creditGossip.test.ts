import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as null | { id: string; publicKey: string }, privateKey: null as null | string }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => auth.user, getCachedPrivateKey: async () => auth.privateKey }));
import { acceptablePeerDonation, acceptablePeerVaultGift, peerDonationProblem, peerVaultGiftProblem, CreditGossip, isGossipedChainTx, MAX_HOPS, signedUnminedDonations, UNMINED_REOFFER_MS, type GossipMesh } from "../creditGossip";
import { signWalletTip } from "@/lib/blockchain/wallets/tipSignature";
import { arrayBufferToBase64, computeUserId } from "@/lib/crypto";
import type { CreditTransaction } from "@/types";
import type { SwarmTransaction } from "@/lib/blockchain/types";

/** A tiny in-memory mesh: nodes deliver messages to each other synchronously. */
class FakeNetwork {
  nodes = new Map<string, FakeMesh>();
  link(a: string, b: string) {
    this.nodes.get(a)!.peers.add(b);
    this.nodes.get(b)!.peers.add(a);
    this.nodes.get(a)!.firePeers();
    this.nodes.get(b)!.firePeers();
  }
}

class FakeMesh implements GossipMesh {
  peers = new Set<string>();
  handlers = new Map<string, Set<(peerId: string, payload: unknown) => void>>();
  peerHandlers = new Set<() => void>();
  sent: Array<{ channel: string; to: string; payload: unknown }> = [];
  constructor(public id: string, private net: FakeNetwork) { net.nodes.set(id, this); }
  getConnectedPeerIds() { return [...this.peers]; }
  send(channel: string, peerId: string, payload: unknown) {
    this.sent.push({ channel, to: peerId, payload });
    const target = this.net.nodes.get(peerId);
    // JSON round-trip like the real wire.
    const wire = JSON.parse(JSON.stringify(payload));
    target?.handlers.get(channel)?.forEach((h) => h(this.id, wire));
    return true;
  }
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void) {
    if (!this.handlers.has(channel)) this.handlers.set(channel, new Set());
    this.handlers.get(channel)!.add(handler);
    return () => this.handlers.get(channel)!.delete(handler);
  }
  onPeersChange(handler: () => void) { this.peerHandlers.add(handler); return () => this.peerHandlers.delete(handler); }
  firePeers() { this.peerHandlers.forEach((h) => h()); }
}

function transfer(id: string, to: string): CreditTransaction {
  return { id, fromUserId: "alice", toUserId: to, amount: 5, type: "tip", createdAt: new Date().toISOString() } as CreditTransaction;
}

function mintTx(id: string, timestamp = new Date().toISOString()): SwarmTransaction {
  return { id, type: "token_mint", from: "system", to: "alice", amount: 0.095, timestamp, signature: "", publicKey: "system", nonce: 1, fee: 0 } as SwarmTransaction;
}

function donationTx(id: string, from = "alice", timestamp = new Date().toISOString()): SwarmTransaction {
  return { id, type: "pool_donate", from, to: "community-pool", amount: 1700, timestamp, signature: "", publicKey: from, nonce: 1, fee: 0 } as SwarmTransaction;
}

function node(net: FakeNetwork, id: string, unmined: () => SwarmTransaction[] = () => [], accept: (tx: SwarmTransaction) => boolean = () => true) {
  const mesh = new FakeMesh(id, net);
  const received: CreditTransaction[] = [];
  const ledger: SwarmTransaction[] = [];
  const localListeners = new Set<(tx: SwarmTransaction) => void>();
  const gossip = new CreditGossip(mesh, {
    onCreditTransfer: (tx) => { received.push(tx); },
    acceptChainTx: (tx) => {
      if (!accept(tx)) return false;
      if (!ledger.some((t) => t.id === tx.id)) { ledger.push(tx); localListeners.forEach((l) => l(tx)); }
      return true;
    },
    subscribeLocalChainTx: (l) => { localListeners.add(l); return () => localListeners.delete(l); },
    unminedLocalChainTxs: unmined,
    storage: null,
  });
  gossip.start();
  const addLocal = (tx: SwarmTransaction) => { ledger.push(tx); localListeners.forEach((l) => l(tx)); };
  return { mesh, gossip, received, ledger, addLocal };
}

describe("CreditGossip", () => {
  it("delivers a transfer to a recipient two hops away", async () => {
    const net = new FakeNetwork();
    const a = node(net, "A"); const b = node(net, "B"); const c = node(net, "C");
    net.link("A", "B"); net.link("B", "C");
    a.gossip.publishCreditTransfer(transfer("t1", "carol"));
    await vi.waitFor(() => expect(c.received.map((t) => t.id)).toEqual(["t1"]));
    expect(b.received.map((t) => t.id)).toEqual(["t1"]);
    expect(a.received).toEqual([]);
  });

  it("queues a transfer made with no peers and sends it when a peer connects", async () => {
    const net = new FakeNetwork();
    const a = node(net, "A"); const b = node(net, "B");
    a.gossip.publishCreditTransfer(transfer("t2", "bob"));
    expect(b.received).toEqual([]);
    net.link("A", "B");
    await vi.waitFor(() => expect(b.received.map((t) => t.id)).toEqual(["t2"]));
  });

  it("never applies the same transfer twice in a cycle", async () => {
    const net = new FakeNetwork();
    const a = node(net, "A"); const b = node(net, "B"); const c = node(net, "C");
    net.link("A", "B"); net.link("B", "C"); net.link("C", "A");
    a.gossip.publishCreditTransfer(transfer("t3", "x"));
    await vi.waitFor(() => expect(c.received).toHaveLength(1));
    expect(b.received).toHaveLength(1);
  });

  it("stops relaying after MAX_HOPS", async () => {
    const net = new FakeNetwork();
    const chain = Array.from({ length: MAX_HOPS + 3 }, (_, i) => node(net, `N${i}`));
    for (let i = 0; i < chain.length - 1; i++) net.link(`N${i}`, `N${i + 1}`);
    chain[0].gossip.publishCreditTransfer(transfer("t4", "far"));
    await vi.waitFor(() => expect(chain[MAX_HOPS].received).toHaveLength(1));
    expect(chain[MAX_HOPS + 1].received).toHaveLength(0);
  });

  it("gossips fresh local mining-reward ledger entries to peers", async () => {
    const net = new FakeNetwork();
    const a = node(net, "A"); const b = node(net, "B"); const c = node(net, "C");
    net.link("A", "B"); net.link("B", "C");
    a.addLocal(mintTx("m1"));
    await vi.waitFor(() => expect(c.ledger.map((t) => t.id)).toEqual(["m1"]));
    // B accepted it once and did not echo it back to A's ledger.
    expect(a.ledger.map((t) => t.id)).toEqual(["m1"]);
  });

  it("does not gossip stale or non-credit ledger entries", () => {
    const net = new FakeNetwork();
    const a = node(net, "A"); const b = node(net, "B");
    net.link("A", "B");
    a.addLocal(mintTx("old", new Date(Date.now() - 60 * 60 * 1000).toISOString()));
    a.addLocal({ ...mintTx("post"), type: "nft_mint" } as SwarmTransaction);
    expect(b.ledger).toEqual([]);
  });

  it("ignores incoming chain entries of types it does not gossip", () => {
    const net = new FakeNetwork();
    const a = node(net, "A"); const b = node(net, "B");
    net.link("A", "B");
    a.mesh.send("chain-tx", "B", { type: "chain-tx", tx: { ...mintTx("bad"), type: "token_transfer" } });
    expect(b.ledger).toEqual([]);
  });

  it("re-offers a seen transfer for local delivery so a later sign-in can apply it", async () => {
    const net = new FakeNetwork();
    const a = node(net, "A"); const b = node(net, "B");
    net.link("A", "B");
    a.gossip.publishCreditTransfer(transfer("t5", "bob"));
    await vi.waitFor(() => expect(b.received).toHaveLength(1));
    // Simulate the recipient's handler having ignored it (signed out), then a sign-in.
    b.received.length = 0;
    await b.gossip.redeliverCredits();
    expect(b.received.map((t) => t.id)).toEqual(["t5"]);
    // A replay from a peer is also offered locally again, but not relayed again.
    const sentBefore = b.mesh.sent.length;
    a.mesh.send("credits", "B", { type: "credit-transfer", transaction: transfer("t5", "bob"), timestamp: Date.now() });
    await vi.waitFor(() => expect(b.received).toHaveLength(2));
    expect(b.mesh.sent.length).toBe(sentBefore);
  });

  it("relays a member's vault donation across the mesh", async () => {
    const net = new FakeNetwork();
    const a = node(net, "A"); const b = node(net, "B"); const c = node(net, "C");
    net.link("A", "B"); net.link("B", "C");
    a.addLocal(donationTx("d1"));
    await vi.waitFor(() => expect(c.ledger.map((t) => t.id)).toEqual(["d1"]));
  });

  it("never relays the old system mining-tax top-up", async () => {
    const net = new FakeNetwork();
    const a = node(net, "A"); const b = node(net, "B");
    net.link("A", "B");
    a.addLocal(donationTx("tax", "system"));
    b.mesh.handlers.get("chain-tx")?.forEach((h) => h("A", { type: "chain-tx", tx: donationTx("tax2", "system"), hops: 0 }));
    await new Promise((r) => setTimeout(r, 10));
    expect(b.ledger).toEqual([]);
  });

  it("offers a days-old unmined donation to each newly connected peer", async () => {
    const net = new FakeNetwork();
    const old = donationTx("d-old", "alice", new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
    node(net, "A", () => [old]);
    const b = node(net, "B");
    net.link("A", "B");
    await vi.waitFor(() => expect(b.ledger.map((t) => t.id)).toEqual(["d-old"]));
  });

  it("offers donations restored after start to peers it already knew", async () => {
    const net = new FakeNetwork();
    let restored: SwarmTransaction[] = [];
    const a = node(net, "A", () => restored);
    const b = node(net, "B");
    net.link("A", "B");
    expect(b.ledger).toEqual([]);
    restored = [donationTx("d-late")];
    a.gossip.offerUnmined();
    await vi.waitFor(() => expect(b.ledger.map((t) => t.id)).toEqual(["d-late"]));
  });

});

async function identity() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = arrayBufferToBase64(await crypto.subtle.exportKey("spki", pair.publicKey));
  const privateKey = arrayBufferToBase64(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  return { id: await computeUserId(publicKey), publicKey, privateKey };
}

describe("donations a peer could not check yet", () => {
  it("are checked again on the next offer instead of being dropped for good", async () => {
    const net = new FakeNetwork();
    const donation = donationTx("d-retry");
    let ledgerCaughtUp = false;
    const a = node(net, "A", () => [donation]);
    const b = node(net, "B", () => [], () => ledgerCaughtUp);
    net.link("A", "B");
    await new Promise((r) => setTimeout(r, 10));
    expect(b.ledger).toEqual([]);
    ledgerCaughtUp = true;
    await a.gossip.offerUnmined();
    await vi.waitFor(() => expect(b.ledger.map((t) => t.id)).toEqual(["d-retry"]));
  });

  it("are offered again on a timer while they stay unmined", async () => {
    vi.useFakeTimers();
    try {
      const net = new FakeNetwork();
      const donation = donationTx("d-timer");
      let ledgerCaughtUp = false;
      node(net, "A", () => [donation]);
      const b = node(net, "B", () => [], () => ledgerCaughtUp);
      net.link("A", "B");
      await vi.advanceTimersByTimeAsync(10);
      expect(b.ledger).toEqual([]);
      ledgerCaughtUp = true;
      await vi.advanceTimersByTimeAsync(UNMINED_REOFFER_MS + 10);
      expect(b.ledger.map((t) => t.id)).toEqual(["d-timer"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("vault donations between peers follow the signed-spend rule", () => {
  it("accepts a donation only when its donor signed it and holds the SWARM", async () => {
    const donor = await identity();
    const signed = await signWalletTip({ ...donationTx("s1", donor.id), publicKey: donor.publicKey }, donor.privateKey);
    expect(await acceptablePeerDonation(signed, () => 2000)).toBe(true);
    // Not enough SWARM on this peer's ledger.
    expect(await acceptablePeerDonation(signed, () => 100)).toBe(false);
    // Unsigned, or signed by someone else in the donor's name.
    expect(await acceptablePeerDonation(donationTx("u1", donor.id), () => 2000)).toBe(false);
    const thief = await identity();
    const forged = await signWalletTip({ ...donationTx("f1", donor.id), publicKey: thief.publicKey }, thief.privateKey);
    expect(await acceptablePeerDonation(forged, () => 2000)).toBe(false);
    // Changing the amount after signing breaks the signature.
    expect(await acceptablePeerDonation({ ...signed, amount: 1 }, () => 2000)).toBe(false);
  });

  it("has the donor sign their own older unsigned donation, and never anyone else's", async () => {
    const me = await identity();
    const other = await identity();
    const mine = { ...donationTx("old-mine", me.id), publicKey: me.id };
    const theirs = { ...donationTx("old-theirs", other.id), publicKey: other.id };
    const pending: SwarmTransaction[] = [mine, theirs];
    const chain = {
      getPendingTransactions: () => pending,
      replacePendingTransaction: (tx: SwarmTransaction) => {
        const i = pending.findIndex((p) => p.id === tx.id);
        if (i < 0) return false;
        pending[i] = tx;
        return true;
      },
    };
    auth.user = { id: me.id, publicKey: me.publicKey };
    auth.privateKey = null;
    expect(await signedUnminedDonations(chain)).toEqual([]);
    auth.privateKey = me.privateKey;
    const offered = await signedUnminedDonations(chain);
    expect(offered.map((t) => t.id)).toEqual(["old-mine"]);
    expect(await acceptablePeerDonation(offered[0], () => 2000)).toBe(true);
    expect(pending[0].signature).not.toBe("");
    expect(pending[1].signature).toBe("");
  });
});

describe("Credits and token gifts to the vault travel signed", () => {
  const gift = (id: string, from: string, currency: string, amount = 50): SwarmTransaction => ({
    id, type: "custom_token_transfer", from, to: "community-pool", amount, timestamp: new Date().toISOString(),
    signature: "", publicKey: from, nonce: 1, fee: 0, meta: { currency, marketVault: true, direction: "donation" },
  } as SwarmTransaction);
  const TOKEN = "MINTME:0x634340447220bcaaa09a5505d71ca62b644a1a82";

  it("travels only as a member's donation to the vault, never as another token record", () => {
    expect(isGossipedChainTx(gift("g", "alice", "CREDITS"))).toBe(true);
    expect(isGossipedChainTx({ ...gift("t", "alice", TOKEN), meta: { currency: TOKEN, marketVault: true, direction: "vault-buy" } })).toBe(false);
    expect(isGossipedChainTx({ ...gift("p", "community-pool", "CREDITS"), to: "alice" })).toBe(false);
    expect(isGossipedChainTx({ ...gift("x", "alice", TOKEN), to: "bob" })).toBe(false);
  });

  it("accepts a Credits gift only with the donor's signature", async () => {
    const donor = await identity();
    const signed = await signWalletTip({ ...gift("c1", donor.id, "CREDITS"), publicKey: donor.publicKey }, donor.privateKey);
    expect(await acceptablePeerVaultGift(signed)).toBe(true);
    expect(await acceptablePeerVaultGift(gift("c2", donor.id, "CREDITS"))).toBe(false);
    expect(await acceptablePeerVaultGift({ ...signed, amount: 5000 })).toBe(false);
    const thief = await identity();
    const forged = await signWalletTip({ ...gift("c3", donor.id, "CREDITS"), publicKey: thief.publicKey }, thief.privateKey);
    expect(await acceptablePeerVaultGift(forged)).toBe(false);
  });

  it("accepts a token gift only when the donor holds that token on this ledger", async () => {
    const donor = await identity();
    const signed = await signWalletTip({ ...gift("t1", donor.id, TOKEN, 40), publicKey: donor.publicKey }, donor.privateKey);
    expect(await acceptablePeerVaultGift(signed, (id, cur) => (id === donor.id && cur === TOKEN ? 40 : 0))).toBe(true);
    expect(await acceptablePeerVaultGift(signed, () => 39)).toBe(false);
  });

  it("has the donor sign their own older unsigned Credits gift before offering it", async () => {
    const me = await identity();
    const pending: SwarmTransaction[] = [gift("old-credits", me.id, "CREDITS")];
    const chain = {
      getPendingTransactions: () => pending,
      replacePendingTransaction: (tx: SwarmTransaction) => { pending[0] = tx; return true; },
    };
    auth.user = { id: me.id, publicKey: me.publicKey };
    auth.privateKey = me.privateKey;
    const offered = await signedUnminedDonations(chain);
    expect(offered.map((t) => t.id)).toEqual(["old-credits"]);
    expect(await acceptablePeerVaultGift(offered[0])).toBe(true);
  });
});

describe("saying why a peer's donation was refused", () => {
  it("names a missing signature and a short balance", async () => {
    const donor = await identity();
    expect(await peerDonationProblem(donationTx("u", donor.id), () => 2000)).toMatch(/isn't signed/);
    const signed = await signWalletTip({ ...donationTx("s", donor.id), publicKey: donor.publicKey }, donor.privateKey);
    expect(await peerDonationProblem(signed, () => 12.5)).toBe("the donor has 12.5 spendable SWARM on this ledger, needs 1,700");
    expect(await peerDonationProblem(signed, () => 2000)).toBeNull();
    const gift = { ...donationTx("g", donor.id), type: "custom_token_transfer", amount: 40,
      meta: { currency: "MINTME:0x634340447220bcaaa09a5505d71ca62b644a1a82", marketVault: true, direction: "donation" } } as SwarmTransaction;
    const signedGift = await signWalletTip({ ...gift, publicKey: donor.publicKey }, donor.privateKey);
    expect(await peerVaultGiftProblem(signedGift, () => 3)).toBe("the donor holds 3 of that token on this ledger, needs 40");
  });
});
