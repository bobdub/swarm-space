import { describe, expect, it, vi } from "vitest";

vi.mock("../storage", () => ({ getChainState: async () => null, saveChainState: async () => {}, saveBlock: async () => {} }));
vi.mock("../chainHealthBridge", () => ({ recordBlockAccepted: () => {}, bootstrapChainBridge: () => {}, resolveFork: () => "keep" }));
// A fixed mesh clock, so legacy blocks stay before the new-rules cutoff whenever the tests run.
const clock = vi.hoisted(() => ({ now: Date.parse("2026-11-21T12:00:00Z") }));
vi.mock("@/lib/time/networkClock", () => ({ networkNow: () => clock.now }));

const { SwarmChain } = await import("../chain");
const { calculateMerkleRoot } = await import("../crypto");
const { genIdentityKeyPair, computeUserId } = await import("@/lib/crypto");
const { signWalletTip } = await import("../wallets/tipSignature");
const { headerFor, signerFromKeys } = await import("../blockHeader");
type Chain = InstanceType<typeof SwarmChain>;
type Block = ReturnType<Chain["getChain"]>[number];
type Signer = ReturnType<typeof signerFromKeys>;

const later = "2026-12-01T00:00:00.000Z";

async function newSigner(): Promise<Signer & { privateKey: string }> {
  const keys = await genIdentityKeyPair();
  const userId = await computeUserId(keys.publicKey);
  return { ...signerFromKeys(userId, keys.publicKey, keys.privateKey), privateKey: keys.privateKey };
}

/** Build, mine and sign a v2 block by hand, so tests can put anything in it. */
async function forgeV2(on: Chain, prev: Block, transactions: unknown[], timestamp: string, signer: Signer): Promise<Block> {
  const block = {
    index: prev.index + 1, timestamp, transactions, previousHash: prev.hash, hash: "", nonce: 0, difficulty: 4,
    miner: signer.userId, merkleRoot: await calculateMerkleRoot(transactions as never),
    ...headerFor(prev, Date.parse(timestamp), signer),
  };
  const mined = await (on as unknown as { mineBlock: (b: unknown) => Promise<Block> }).mineBlock(block);
  return { ...mined, producerSignature: await signer.sign(mined.hash) };
}

const rewardTo = (to: string, id: string, amount = 47.5) =>
  ({ ...tx(id), type: "mining_reward", from: "system", to, amount });
const poolShare = (id: string, amount = 2.5) => ({ ...rewardTo("community-pool", id, amount) });

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
    expect(block!.transactions.filter((t) => t.type === "mining_reward" && t.to === "me")).toHaveLength(1);
    expect(block!.transactions.filter((t) => t.type === "mining_reward")).toHaveLength(2);
    const peer = new SwarmChain();
    await peer.whenReady();
    expect(await peer.appendPeerBlock(block!)).toBe(true);
  }, 60_000);
});

describe("block reward is the only issuance", () => {
  const selfMint = (id: string) => ({ ...tx(id), type: "token_mint", from: "system", to: "me", amount: 1_000 });

  it("keeps self-issued mints out of mined blocks, and can mine a reward-only block", async () => {
    const miner = new SwarmChain();
    await miner.whenReady();
    miner.addTransaction(selfMint("mine-to-me") as never);
    expect(await miner.minePendingTransactions("me")).toBeNull();
    const block = (await miner.minePendingTransactions("me", undefined, { allowEmpty: true, hollow: true }))!;
    expect(block.transactions.map((t) => [t.type, t.to, t.amount])).toEqual([
      ["mining_reward", "me", 23.75], ["mining_reward", "community-pool", 1.25],
    ]);
    const peer = new SwarmChain();
    await peer.whenReady();
    expect(await peer.appendPeerBlock(block)).toBe(true);
  }, 60_000);

  it("rejects a peer block stamped after the cutoff that carries a self-issued mint", async () => {
    const signer = await newSigner();
    const local = new SwarmChain();
    await local.whenReady();
    const genesis = local.getChain()[0];
    const honest = [rewardTo(signer.userId, "r"), poolShare("p")];
    expect(await local.isValidPeerChain([genesis, await forgeV2(local, genesis, honest, later, signer)])).toBe(true);
    const block = await forgeV2(local, genesis, [...honest, selfMint("forged")], later, signer);
    expect(await local.appendPeerBlock(block)).toBe(false);
  }, 60_000);

  it("holds a block reward back until it matures", async () => {
    const chain = await minedChain(1, "me");
    expect(chain.getBalance("me")).toBe(0);
    expect(chain.getImmatureRewards("me")).toBe(47.5);
    expect(chain.getImmatureRewards("community-pool")).toBe(2.5);
  }, 60_000);
});

describe("rewards and local mints can't fund shared-chain payments early", () => {

  async function tipFrom(keys: { publicKey: string; privateKey: string }, from: string, id: string) {
    return signWalletTip({ id, type: "wallet_tip", from, to: "aabbccddeeff0011", amount: 10, fee: 0, nonce: 1,
      publicKey: keys.publicKey, signature: "", timestamp: later, meta: { assetId: "chain:SWARM" } } as never, keys.privateKey);
  }

  it("refuses a peer block that spends a reward from the block before it", async () => {
    const signer = await newSigner();
    const me = signer.userId;
    const local = new SwarmChain();
    await local.whenReady();
    const genesis = local.getChain()[0];
    const b1 = await forgeV2(local, genesis, [rewardTo(me, "r1"), poolShare("p1")], later, signer);
    const next = new Date(Date.parse(later) + 30_000).toISOString();
    const reward2 = [rewardTo(me, "r2"), poolShare("p2")];
    expect(await local.isValidPeerChain([genesis, b1, await forgeV2(local, b1, reward2, next, signer)])).toBe(true);
    const keys = { publicKey: signer.publicKey, privateKey: signer.privateKey };
    const b2 = await forgeV2(local, b1, [await tipFrom(keys, me, "spend"), ...reward2], next, signer);
    expect(await local.appendPeerBlock(b1)).toBe(true);
    expect(await local.appendPeerBlock(b2)).toBe(false);
  }, 60_000);

  it("refuses a block under the new rules that skips the pool's share", async () => {
    const signer = await newSigner();
    const local = new SwarmChain();
    await local.whenReady();
    const block = await forgeV2(local, local.getChain()[0], [rewardTo(signer.userId, "solo", 50)], later, signer);
    expect(await local.appendPeerBlock(block)).toBe(false);
  }, 60_000);

  it("won't accept a payment funded only by a local self-issued mint", async () => {
    const keys = await genIdentityKeyPair();
    const me = await computeUserId(keys.publicKey);
    const chain = new SwarmChain();
    await chain.whenReady();
    chain.addTransaction({ ...tx("local"), type: "token_mint", from: "system", to: me, amount: 100 } as never);
    expect(chain.getBalance(me)).toBe(100);
    expect(chain.getSpendableBalance(me)).toBe(0);
    expect(await chain.acceptWalletTip(await tipFrom(keys, me, "pay"))).toBe(false);
  }, 60_000);
});

describe("block header v2", () => {
  it("mines a signed block on the cadence, and peers accept it", async () => {
    const signer = await newSigner();
    const miner = new SwarmChain();
    await miner.whenReady();
    const block = (await miner.minePendingTransactions("ignored", undefined, { allowEmpty: true, signer }))!;
    expect(block).toMatchObject({ version: 2, miner: signer.userId, producer: { userId: signer.userId } });
    expect(block.tick).toBe(Math.floor(clock.now / 30_000));
    // One block per beat: the same beat is refused, the next one is free.
    expect(await miner.minePendingTransactions("x", undefined, { allowEmpty: true, signer })).toBeNull();
    clock.now += 30_000;
    const second = (await miner.minePendingTransactions("x", undefined, { allowEmpty: true, signer }))!;
    expect(second.tick).toBe(block.tick! + 1);
    const peer = new SwarmChain();
    await peer.whenReady();
    expect(await peer.adoptPeerChain(miner.getChain())).toBe("adopted");
  }, 60_000);

  it("rejects a bad signature, a wrong tick or epoch, a reward paid to someone else, and an unsigned late block", async () => {
    const signer = await newSigner();
    const other = await newSigner();
    const local = new SwarmChain();
    await local.whenReady();
    const genesis = local.getChain()[0];
    const pays = (to = signer.userId) => [rewardTo(to, `r-${to.slice(0, 4)}`), poolShare(`p-${to.slice(0, 4)}`)];
    const good = await forgeV2(local, genesis, pays(), later, signer);
    const check = (b: Block) => local.isValidPeerChain([genesis, b]);
    expect(await check(good)).toBe(true);
    expect(await check({ ...good, producerSignature: await other.sign(good.hash) })).toBe(false);
    const remine = async (patch: Partial<Block>) => {
      const b = { ...(await forgeV2(local, genesis, pays(), later, signer)), ...patch, nonce: 0, hash: "" };
      const mined = await (local as unknown as { mineBlock: (x: unknown) => Promise<Block> }).mineBlock(b);
      return { ...mined, producerSignature: await signer.sign(mined.hash) };
    };
    expect(await check(await remine({ tick: good.tick! + 1 }))).toBe(false);
    expect(await check(await remine({ epoch: 7 }))).toBe(false);
    expect(await check(await remine({ difficulty: 1 }))).toBe(false);
    expect(await check(await forgeV2(local, genesis, pays(other.userId), later, signer))).toBe(false);
    const legacy = { ...good, version: undefined, epoch: undefined, tick: undefined, producer: undefined, clockSession: undefined };
    const unsigned = await (local as unknown as { mineBlock: (x: unknown) => Promise<Block> }).mineBlock({ ...legacy, nonce: 0, hash: "" });
    expect(await check(unsigned)).toBe(false);
  }, 60_000);
});

describe("mining against a moving tip", () => {
  it("drops a block whose parent was replaced by a peer block mid-mining", async () => {
    const signer = await newSigner();
    const peerSigner = await newSigner();
    clock.now += 60_000;
    const local = new SwarmChain();
    await local.whenReady();
    const genesis = local.getChain()[0];
    // A peer's block for this same beat lands while we are still mining.
    const theirs = await forgeV2(local, genesis, [rewardTo(peerSigner.userId, "theirs"), poolShare("theirs-p")],
      new Date(clock.now).toISOString(), peerSigner);
    // Hold our miner inside its first ledger check until the peer block is in.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const target = local as unknown as { validateWalletTipLedger: (b: Block[]) => Promise<boolean> };
    const original = target.validateWalletTipLedger.bind(local);
    let first = true;
    target.validateWalletTipLedger = async (b) => {
      if (first) { first = false; await gate; }
      return original(b);
    };
    const mining = local.minePendingTransactions("x", undefined, { allowEmpty: true, signer });
    expect(await local.appendPeerBlock(theirs)).toBe(true);
    release();
    expect(await mining).toBeNull();
    expect(local.getChain().map((b) => b.hash)).toEqual([genesis.hash, theirs.hash]);
    expect(await local.isValidPeerChain(local.getChain())).toBe(true);
  }, 60_000);
});
