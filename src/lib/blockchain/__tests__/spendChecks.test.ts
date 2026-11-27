import { describe, expect, it, vi } from "vitest";

vi.mock("../storage", () => ({ getChainState: async () => null, saveChainState: async () => {}, saveBlock: async () => {} }));
vi.mock("../chainHealthBridge", () => ({ recordBlockAccepted: () => {}, bootstrapChainBridge: () => {}, resolveFork: () => "keep" }));
// The mesh clock sits after the spend-check fork, so a draft block is checked like a peer's.
const clock = vi.hoisted(() => ({ now: Date.parse("2026-12-10T12:00:00Z") }));
vi.mock("@/lib/time/networkClock", () => ({ networkNow: () => clock.now }));

const { SwarmChain } = await import("../chain");
const { calculateMerkleRoot } = await import("../crypto");
const { genIdentityKeyPair, computeUserId } = await import("@/lib/crypto");
const { signWalletTip } = await import("../wallets/tipSignature");
const { headerFor, signerFromKeys } = await import("../blockHeader");
const { SPEND_CHECK_CUTOFF_MS, blockChecksSpends, isCheckedSwarmSpend } = await import("../issuance");
type Chain = InstanceType<typeof SwarmChain>;
type Block = ReturnType<Chain["getChain"]>[number];
type Signer = ReturnType<typeof signerFromKeys>;

const beforeFork = new Date(SPEND_CHECK_CUTOFF_MS - 60_000).toISOString();
const afterFork = (beats: number) => new Date(clock.now - 600_000 + beats * 30_000).toISOString();

async function newMember() {
  const keys = await genIdentityKeyPair();
  const userId = await computeUserId(keys.publicKey);
  return { ...keys, userId, signer: signerFromKeys(userId, keys.publicKey, keys.privateKey) as Signer };
}

async function forge(on: Chain, prev: Block, transactions: unknown[], timestamp: string, signer: Signer): Promise<Block> {
  const block = {
    index: prev.index + 1, timestamp, transactions, previousHash: prev.hash, hash: "", nonce: 0, difficulty: 4,
    miner: signer.userId, merkleRoot: await calculateMerkleRoot(transactions as never),
    ...headerFor(prev, Date.parse(timestamp), signer),
  };
  const mined = await (on as unknown as { mineBlock: (b: unknown) => Promise<Block> }).mineBlock(block);
  return { ...mined, producerSignature: await signer.sign(mined.hash) };
}

let seq = 0;
const base = (id: string) => ({ id, fee: 0, nonce: ++seq, publicKey: "", signature: "", timestamp: new Date(clock.now).toISOString() });
const rewards = (to: string) => [
  { ...base(`r-${++seq}`), type: "mining_reward", from: "system", to, amount: 47.5 },
  { ...base(`p-${++seq}`), type: "mining_reward", from: "system", to: "community-pool", amount: 2.5 },
];
/** SWARM handed to `to` in a block stamped before the fork, when nobody checked transfers. */
const legacyFunding = (to: string, amount: number) => ({ ...base(`fund-${++seq}`), type: "token_transfer", from: "old-escrow", to, amount });

async function donation(member: Awaited<ReturnType<typeof newMember>>, id: string, amount: number, meta?: Record<string, unknown>) {
  return signWalletTip({ ...base(id), type: "pool_donate", from: member.userId, to: "community-pool", amount,
    publicKey: member.publicKey, ...(meta ? { meta } : {}) } as never, member.privateKey);
}
async function transfer(member: Awaited<ReturnType<typeof newMember>>, id: string, to: string, amount: number, sign = true, meta?: Record<string, unknown>) {
  const raw = { ...base(id), type: "token_transfer", from: member.userId, to, amount, publicKey: member.publicKey, ...(meta ? { meta } : {}) };
  return sign ? signWalletTip(raw as never, member.privateKey) : raw;
}

/** A chain whose first block (before the fork) gives `member` 10 SWARM. */
async function fundedChain(member: Awaited<ReturnType<typeof newMember>>, miner: Signer) {
  const chain = new SwarmChain();
  await chain.whenReady();
  const genesis = chain.getChain()[0];
  const funded = await forge(chain, genesis, [legacyFunding(member.userId, 10), ...rewards(miner.userId)], beforeFork, miner);
  expect(await chain.appendPeerBlock(funded)).toBe(true);
  expect(chain.getConfirmedBalance(member.userId)).toBe(10);
  return { chain, funded };
}

describe("spend-check fork", () => {
  it("starts at the cutoff, and covers SWARM transfers and vault donations from anyone but system", () => {
    expect(blockChecksSpends({ timestamp: beforeFork })).toBe(false);
    expect(blockChecksSpends({ timestamp: new Date(SPEND_CHECK_CUTOFF_MS).toISOString() })).toBe(true);
    expect(blockChecksSpends({ timestamp: "garbage" })).toBe(true);
    expect(isCheckedSwarmSpend({ type: "pool_donate", from: "aabbccddeeff0011" })).toBe(true);
    expect(isCheckedSwarmSpend({ type: "token_transfer", from: "trading-stand:x" })).toBe(true);
    expect(isCheckedSwarmSpend({ type: "token_transfer", from: "system" })).toBe(false);
    expect(isCheckedSwarmSpend({ type: "custom_token_transfer", from: "aabbccddeeff0011" })).toBe(false);
  });
});

describe("one account spending the same SWARM twice", () => {
  it("refuses a peer block that pays the vault with SWARM already donated in an earlier block", async () => {
    const [member, miner] = await Promise.all([newMember(), newMember()]);
    const { chain, funded } = await fundedChain(member, miner.signer);
    const first = await forge(chain, funded, [await donation(member, "phone", 10), ...rewards(miner.userId)], afterFork(1), miner.signer);
    expect(await chain.appendPeerBlock(first)).toBe(true);
    const second = await forge(chain, first, [await donation(member, "laptop", 10), ...rewards(miner.userId)], afterFork(2), miner.signer);
    expect(await chain.appendPeerBlock(second)).toBe(false);
    // A whole peer chain carrying the double spend is refused too.
    const fresh = new SwarmChain();
    await fresh.whenReady();
    expect(await fresh.adoptPeerChain([...chain.getChain(), second])).toBe("invalid");
    expect(await fresh.adoptPeerChain(chain.getChain())).toBe("adopted");
  }, 120_000);

  it("refuses both copies in one block, and a SWARM transfer that spends the same coins as a donation", async () => {
    const [member, miner] = await Promise.all([newMember(), newMember()]);
    const { chain, funded } = await fundedChain(member, miner.signer);
    const twice = [await donation(member, "a", 10), await donation(member, "b", 10), ...rewards(miner.userId)];
    expect(await chain.appendPeerBlock(await forge(chain, funded, twice, afterFork(1), miner.signer))).toBe(false);
    const mixed = [await donation(member, "c", 6), await transfer(member, "d", "trading-stand:main", 6), ...rewards(miner.userId)];
    expect(await chain.appendPeerBlock(await forge(chain, funded, mixed, afterFork(1), miner.signer))).toBe(false);
    const fits = [await donation(member, "e", 4), await transfer(member, "f", "trading-stand:main", 6), ...rewards(miner.userId)];
    expect(await chain.appendPeerBlock(await forge(chain, funded, fits, afterFork(1), miner.signer))).toBe(true);
  }, 120_000);

  it("refuses an unsigned or forged member transfer, but balance-checks vault accounts without a key", async () => {
    const [member, thief, miner] = await Promise.all([newMember(), newMember(), newMember()]);
    const { chain, funded } = await fundedChain(member, miner.signer);
    const unsigned = await transfer(member, "unsigned", "trading-stand:main", 5, false);
    expect(await chain.appendPeerBlock(await forge(chain, funded, [unsigned, ...rewards(miner.userId)], afterFork(1), miner.signer))).toBe(false);
    const forged = await signWalletTip({ ...(await transfer(member, "forged", thief.userId, 5, false)) as never, publicKey: thief.publicKey } as never, thief.privateKey);
    expect(await chain.appendPeerBlock(await forge(chain, funded, [forged, ...rewards(miner.userId)], afterFork(1), miner.signer))).toBe(false);
    // The stand vault holds what the member paid it, and can pay out no more than that.
    const pay = await transfer(member, "pay", "trading-stand:main", 5);
    const payout = { ...base("payout"), type: "token_transfer", from: "trading-stand:main", to: member.userId, amount: 5 };
    const overpay = { ...base("overpay"), type: "token_transfer", from: "trading-stand:main", to: member.userId, amount: 6 };
    expect(await chain.appendPeerBlock(await forge(chain, funded, [pay, overpay, ...rewards(miner.userId)], afterFork(1), miner.signer))).toBe(false);
    expect(await chain.appendPeerBlock(await forge(chain, funded, [pay, payout, ...rewards(miner.userId)], afterFork(1), miner.signer))).toBe(true);
  }, 120_000);
});

describe("a spend peers refused leaves the queue", () => {
  it("drops the second device's donation (and its order's other legs) once the first is mined", async () => {
    const [member, miner] = await Promise.all([newMember(), newMember()]);
    const { chain, funded } = await fundedChain(member, miner.signer);
    // This device queued an order of its own: a payment plus a goods leg.
    chain.addTransaction(await donation(member, "laptop-order", 10, { operationId: "op-1" }) as never);
    chain.addTransaction({ ...base("laptop-goods"), type: "custom_token_transfer", from: "trading-stand:main", to: member.userId,
      amount: 1, meta: { currency: "GOOD:wood", operationId: "op-1" } } as never);
    chain.addTransaction({ ...base("unrelated"), type: "transfer", from: "x", to: "y", amount: 1 } as never);
    // Meanwhile the other device's donation of the same 10 SWARM was mined.
    const theirs = await forge(chain, funded, [await donation(member, "phone-order", 10), ...rewards(miner.userId)], afterFork(1), miner.signer);
    expect(await chain.appendPeerBlock(theirs)).toBe(true);
    expect(chain.getPendingTransactions().map((t) => t.id)).toEqual(["unrelated"]);
  }, 120_000);

  it("mines only what the ledger funds, and lets the unfundable copy go", async () => {
    const [member, miner] = await Promise.all([newMember(), newMember()]);
    const { chain } = await fundedChain(member, miner.signer);
    chain.addTransaction(await donation(member, "ok", 10) as never);
    chain.addTransaction(await donation(member, "double", 10) as never);
    const block = (await chain.minePendingTransactions("ignored", undefined, { signer: miner.signer }))!;
    expect(block.transactions.map((t) => t.id)).toContain("ok");
    expect(block.transactions.map((t) => t.id)).not.toContain("double");
    expect(chain.getPendingTransactions().map((t) => t.id)).not.toContain("double");
    const peer = new SwarmChain();
    await peer.whenReady();
    expect(await peer.isValidPeerChain(chain.getChain())).toBe(true);
  }, 120_000);
});
