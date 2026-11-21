import { describe, expect, it, vi } from "vitest";

vi.mock("../storage", () => ({ getChainState: async () => null, saveChainState: async () => {}, saveBlock: async () => {} }));
vi.mock("../chainHealthBridge", () => ({ recordBlockAccepted: () => {}, bootstrapChainBridge: () => {}, resolveFork: () => "keep" }));

const { SwarmChain } = await import("../chain");
const { calculateMerkleRoot } = await import("../crypto");
type Chain = InstanceType<typeof SwarmChain>;

const tx = (id: string) => ({
  id, type: "transfer" as const, from: "alice", to: "bob", amount: 1, fee: 0, nonce: 0,
  publicKey: "", signature: "", timestamp: new Date().toISOString(),
});

async function minedChain(blocks: number, miner = "miner"): Promise<Chain> {
  const chain = new SwarmChain();
  await chain.whenReady();
  for (let i = 0; i < blocks; i++) {
    chain.addTransaction(tx(`${miner}-tx-${i}`) as never);
    await chain.minePendingTransactions(miner);
  }
  return chain;
}

describe("shared chain safety", () => {
  it("adopts a valid longer peer chain", async () => {
    const peer = await minedChain(2, "peer");
    const local = new SwarmChain();
    await local.whenReady();
    expect(await local.adoptPeerChain(peer.getChain())).toBe("adopted");
    expect(local.getChain()).toHaveLength(3);
  }, 60_000);

  it("rejects a forged genesis that keeps the canonical hash", async () => {
    const peer = await minedChain(1, "peer");
    const local = new SwarmChain();
    await local.whenReady();
    const forged = structuredClone(peer.getChain());
    forged[0].transactions = [{ ...tx("free-money"), type: "mining_reward", from: "system", to: "attacker", amount: 1e9 }] as never;
    expect(await local.adoptPeerChain(forged)).toBe("invalid");
  }, 60_000);

  it("rejects a block that pays itself more than the mining reward", async () => {
    const peer = new SwarmChain();
    await peer.whenReady();
    peer.addTransaction(tx("t") as never);
    const honest = (await peer.minePendingTransactions("greedy"))!;
    const transactions = honest.transactions.map((t) => (t.type === "mining_reward" ? { ...t, amount: 1_000_000 } : t));
    const forged = { ...honest, transactions, nonce: 0, hash: "", merkleRoot: await calculateMerkleRoot(transactions) };
    const block = await (peer as unknown as { mineBlock: (b: unknown) => Promise<typeof honest> }).mineBlock(forged);
    (peer as unknown as { chain: unknown[] }).chain[1] = block;
    const local = new SwarmChain();
    await local.whenReady();
    expect(await local.appendPeerBlock(block!)).toBe(false);
    expect(await local.adoptPeerChain(peer.getChain())).toBe("invalid");
  }, 60_000);

  it("accepts only one of two sibling blocks that arrive together", async () => {
    const [a, b] = await Promise.all([minedChain(1, "a"), minedChain(1, "b")]);
    const local = new SwarmChain();
    await local.whenReady();
    const results = await Promise.all([local.appendPeerBlock(a.getChain()[1]), local.appendPeerBlock(b.getChain()[1])]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(local.getChain()).toHaveLength(2);
    expect(await local.isValidPeerChain(local.getChain())).toBe(true);
  }, 60_000);
});

describe("one reward per block", () => {
  it("never carries a stray reward into a mined block, so peers accept it", async () => {
    const miner = new SwarmChain();
    await miner.whenReady();
    miner.addTransaction({ ...tx("stray"), type: "mining_reward", from: "system", to: "someone", amount: 50 } as never);
    miner.addTransaction(tx("real") as never);
    const block = await miner.minePendingTransactions("me");
    expect(block!.transactions.filter((t) => t.type === "mining_reward")).toHaveLength(1);
    const peer = new SwarmChain();
    await peer.whenReady();
    expect(await peer.appendPeerBlock(block!)).toBe(true);
  }, 60_000);
});
