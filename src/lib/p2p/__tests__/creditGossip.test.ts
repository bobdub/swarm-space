import { describe, expect, it, vi } from "vitest";
import { CreditGossip, MAX_HOPS, type GossipMesh } from "../creditGossip";
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

function node(net: FakeNetwork, id: string, unmined: () => SwarmTransaction[] = () => []) {
  const mesh = new FakeMesh(id, net);
  const received: CreditTransaction[] = [];
  const ledger: SwarmTransaction[] = [];
  const localListeners = new Set<(tx: SwarmTransaction) => void>();
  const gossip = new CreditGossip(mesh, {
    onCreditTransfer: (tx) => { received.push(tx); },
    acceptChainTx: (tx) => {
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
});
