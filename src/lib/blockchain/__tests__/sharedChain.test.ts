import { describe, expect, it, vi } from "vitest";

vi.mock("../storage", () => ({ getChainState: async () => null, saveChainState: async () => {}, saveBlock: async () => {} }));
vi.mock("../chainHealthBridge", () => ({ recordBlockAccepted: () => {}, bootstrapChainBridge: () => {}, resolveFork: () => "keep" }));

const { SwarmChain } = await import("../chain");
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
    (peer as unknown as { miningReward: number }).miningReward = 1_000_000;
    peer.addTransaction(tx("t") as never);
    const block = await peer.minePendingTransactions("greedy");
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
