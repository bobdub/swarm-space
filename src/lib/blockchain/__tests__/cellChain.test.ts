import { describe, expect, it } from "vitest";
import { computeUserId, genIdentityKeyPair } from "@/lib/crypto";
import { signerFromKeys, type BlockSigner } from "../blockHeader";
import { calculateHash } from "../crypto";
import { endorsementSignerFromKeys, signEndorsement, verifyEndorsement } from "../endorsements";
import { CELL_POOL, CellChain, cellRewardAtHeight, memoryCellChainStorage, signCellTransfer, type CellChainOptions } from "../cellChain/cellChain";
import { CellChains } from "../cellChain/cellChains";
import { acceptRecord, genesisRecord, inviteRecord, leaveRecord, rosterSignerFromKeys, signRosterRecord, type TextSigner } from "../cellChain/roster";
import type { SwarmBlock } from "../types";

interface Member { text: TextSigner; block: BlockSigner; userId: string; publicKey: string; privateKey: string }

async function newMember(): Promise<Member> {
  const keys = await genIdentityKeyPair();
  const userId = await computeUserId(keys.publicKey);
  return {
    userId, publicKey: keys.publicKey, privateKey: keys.privateKey,
    text: rosterSignerFromKeys(userId, keys.publicKey, keys.privateKey),
    block: signerFromKeys(userId, keys.publicKey, keys.privateKey),
  };
}

const CELL = "u/alice/ab12";
const T0 = Date.parse("2026-12-01T00:00:00Z");
const BEAT = 30_000;

/** A controllable mesh clock. */
function clock(start = T0 + BEAT) {
  const c = { t: start, now: () => c.t, beat: () => { c.t += BEAT; } };
  return c;
}

async function openCell(owner: Member, opts: Partial<CellChainOptions> = {}) {
  const genesis = await signRosterRecord(genesisRecord(CELL, "Garden Club", owner.userId, T0), owner.text);
  const c = clock();
  const chain = (await CellChain.open(genesis, { storage: memoryCellChainStorage(), difficulty: 1, now: c.now, ...opts }))!;
  return { genesis, chain, clock: c };
}

async function mineBeats(chain: CellChain, c: ReturnType<typeof clock>, miner: Member, n: number) {
  for (let i = 0; i < n; i++) {
    c.beat();
    expect(await chain.mine(miner.block)).not.toBeNull();
  }
}

describe("a cell chain", () => {
  it("starts from the owner's signed genesis, with the ticker from the cell name", async () => {
    const owner = await newMember();
    const { genesis, chain } = await openCell(owner);
    expect(chain.ticker).toBe("GARDEN");
    expect(chain.getRoster().sortedMembers()).toEqual([owner.userId]);
    // Every member builds the same genesis block from the same record.
    expect((await CellChain.genesisBlock(genesis)).hash).toBe(chain.getChain()[0].hash);
  });

  it("is mined like the shared chain: signed v2 header, one block per beat, 95% to the miner and 5% to the pool", async () => {
    const owner = await newMember();
    const { chain, clock: c } = await openCell(owner);
    c.beat();
    const block = (await chain.mine(owner.block))!;
    expect(block.version).toBe(2);
    expect(block.producer?.userId).toBe(owner.userId);
    expect(typeof block.producerSignature).toBe("string");
    const rewards = block.transactions.filter((tx) => tx.type === "mining_reward");
    expect(rewards.find((tx) => tx.to === owner.userId)?.amount).toBeCloseTo(cellRewardAtHeight(1) * 0.95);
    expect(rewards.find((tx) => tx.to === CELL_POOL)?.amount).toBeCloseTo(cellRewardAtHeight(1) * 0.05);
    expect(rewards.every((tx) => tx.chainId === chain.chainId)).toBe(true);
    // Same beat: no second block.
    expect(await chain.mine(owner.block)).toBeNull();
  });

  it("holds rewards until 20 blocks sit on top, as on the shared chain", async () => {
    const owner = await newMember();
    const { chain, clock: c } = await openCell(owner);
    await mineBeats(chain, c, owner, 20);
    expect(chain.getBalance(owner.userId)).toBe(0);
    expect(chain.getImmatureRewards(owner.userId)).toBeGreaterThan(0);
    await mineBeats(chain, c, owner, 1);
    expect(chain.getBalance(owner.userId)).toBeCloseTo(cellRewardAtHeight(1) * 0.95);
  });

  it("only lets members mine", async () => {
    const owner = await newMember();
    const outsider = await newMember();
    const { chain, clock: c } = await openCell(owner);
    c.beat();
    expect(await chain.mine(outsider.block)).toBeNull();
    expect(chain.getChain()).toHaveLength(1);
  });

  it("adds a member through an invite and acceptance carried in blocks, and the new member can mine", async () => {
    const owner = await newMember();
    const bob = await newMember();
    const { chain, clock: c } = await openCell(owner);
    const invite = await signRosterRecord(inviteRecord(chain.chainId, bob.userId, c.now()), owner.text);
    expect(await chain.queueRosterRecord(invite)).toBe(true);
    const accept = await signRosterRecord(await acceptRecord(invite, c.now()), bob.text);
    expect(await chain.queueRosterRecord(accept)).toBe(true);
    expect(chain.getRoster().isMember(bob.userId)).toBe(false);
    await mineBeats(chain, c, owner, 1);
    expect(chain.getRoster().isMember(bob.userId)).toBe(true);
    await mineBeats(chain, c, bob, 1);
  });

  it("refuses a record stamped later than now, so it can't wait in a block for the future", async () => {
    const owner = await newMember();
    const bob = await newMember();
    const { chain, clock: c } = await openCell(owner);
    const future = await signRosterRecord(inviteRecord(chain.chainId, bob.userId, c.now() + 60 * 60_000), owner.text);
    expect(await chain.queueRosterRecord(future)).toBe(false);
  });

  it("rejects a block stamped more than 2 minutes ahead of the mesh clock", async () => {
    const owner = await newMember();
    const ahead = await openCell(owner);
    ahead.clock.t += 10 * 60_000;
    const early = (await ahead.chain.mine(owner.block))!;
    const { chain } = await CellChain.open(ahead.genesis, { storage: memoryCellChainStorage(), difficulty: 1, now: () => T0 + BEAT * 2 })
      .then((ch) => ({ chain: ch! }));
    expect(await chain.appendPeerBlock(early)).toBe(false);
  });

  it("rejects a peer block from a non-member, or one with a tampered reward", async () => {
    const owner = await newMember();
    const outsider = await newMember();
    const { genesis, chain, clock: c } = await openCell(owner);
    // The outsider forges a roster where they own a copy, then mines on our genesis.
    const theirs = (await CellChain.open(genesis, { storage: memoryCellChainStorage(), difficulty: 1, now: c.now }))!;
    c.beat();
    expect(await theirs.mine(outsider.block)).toBeNull();
    const good = (await theirs.mine(owner.block))!;
    const greedy: SwarmBlock = JSON.parse(JSON.stringify(good));
    greedy.transactions.find((tx) => tx.to === owner.userId)!.amount = 1_000;
    greedy.hash = await calculateHash(greedy);
    expect(await chain.appendPeerBlock(greedy)).toBe(false);
    expect(await chain.appendPeerBlock(good)).toBe(true);
  });

  it("moves the coin only between members, with funds and a fresh nonce", async () => {
    const owner = await newMember();
    const bob = await newMember();
    const outsider = await newMember();
    const { chain, clock: c } = await openCell(owner);
    const invite = await signRosterRecord(inviteRecord(chain.chainId, bob.userId, c.now()), owner.text);
    await chain.queueRosterRecord(invite);
    await chain.queueRosterRecord(await signRosterRecord(await acceptRecord(invite, c.now()), bob.text));
    await mineBeats(chain, c, owner, 22);
    const pay = (to: string, amount: number, nonce: number) =>
      signCellTransfer({ chain: chain.chainId, to, amount, nonce, at: c.now() }, owner.text);
    expect(await chain.queue(await pay(outsider.userId, 1, 1))).toBe(false);
    expect(await chain.queue(await pay(bob.userId, 1_000_000, 2))).toBe(false);
    const ok = await pay(bob.userId, 10, 3);
    expect(await chain.queue(ok)).toBe(true);
    expect(await chain.queue(await pay(bob.userId, 5, 3))).toBe(false);
    await mineBeats(chain, c, owner, 1);
    expect(chain.getBalance(bob.userId)).toBe(10);
    // Tampering breaks the signature.
    expect(await chain.queue({ ...(await pay(bob.userId, 1, 4)), amount: 2 })).toBe(false);
  });

  it("adopts a longer valid copy of the chain, and keeps its own against an invalid one", async () => {
    const owner = await newMember();
    const { genesis, chain, clock: c } = await openCell(owner);
    const other = (await CellChain.open(genesis, { storage: memoryCellChainStorage(), difficulty: 1, now: c.now }))!;
    await mineBeats(other, c, owner, 3);
    const tampered: SwarmBlock[] = JSON.parse(JSON.stringify(other.getChain()));
    tampered[2].timestamp = new Date(Date.parse(tampered[2].timestamp) + 1).toISOString();
    expect(await chain.adoptPeerChain(tampered)).toBe("invalid");
    expect(await chain.adoptPeerChain(other.getChain())).toBe("adopted");
    expect(chain.getChain()).toHaveLength(4);
  });

  it("drops a replayed leave after the member rejoins", async () => {
    const owner = await newMember();
    const bob = await newMember();
    const { chain, clock: c } = await openCell(owner);
    const join = async () => {
      const invite = await signRosterRecord(inviteRecord(chain.chainId, bob.userId, c.now()), owner.text);
      await chain.queueRosterRecord(invite);
      await chain.queueRosterRecord(await signRosterRecord(await acceptRecord(invite, c.now()), bob.text));
      await mineBeats(chain, c, owner, 1);
    };
    await join();
    const leave = await signRosterRecord(leaveRecord(chain.chainId, c.now()), bob.text);
    await chain.queueRosterRecord(leave);
    await mineBeats(chain, c, owner, 1);
    await join();
    expect(await chain.queueRosterRecord(leave)).toBe(false);
    expect(chain.getRoster().isMember(bob.userId)).toBe(true);
  });

  it("treats a re-encoded signature as the same record, so an old leave can't come back that way", async () => {
    const owner = await newMember();
    const bob = await newMember();
    const { chain, clock: c } = await openCell(owner);
    const join = async () => {
      const invite = await signRosterRecord(inviteRecord(chain.chainId, bob.userId, c.now()), owner.text);
      await chain.queueRosterRecord(invite);
      await chain.queueRosterRecord(await signRosterRecord(await acceptRecord(invite, c.now()), bob.text));
      await mineBeats(chain, c, owner, 1);
    };
    await join();
    const leave = await signRosterRecord(leaveRecord(chain.chainId, c.now()), bob.text);
    await chain.queueRosterRecord(leave);
    await mineBeats(chain, c, owner, 1);
    await join();
    // A fresh, valid signature over the same leave (as a re-encoded one would be).
    const resigned = await signRosterRecord(leave.record, bob.text);
    expect(resigned.signature).not.toBe(leave.signature);
    expect(await chain.queueRosterRecord(resigned)).toBe(false);
    expect(chain.getRoster().isMember(bob.userId)).toBe(true);
  });

  it("reloads its blocks from storage", async () => {
    const owner = await newMember();
    const storage = memoryCellChainStorage();
    const { genesis, chain, clock: c } = await openCell(owner, { storage });
    await mineBeats(chain, c, owner, 2);
    const again = (await CellChain.open(genesis, { storage, difficulty: 1, now: c.now }))!;
    expect(again.getChain().map((b) => b.hash)).toEqual(chain.getChain().map((b) => b.hash));
  });
});

describe("cell endorsements", () => {
  it("name the cell's chain, and don't verify as SWARM endorsements or another cell's", async () => {
    const m = await newMember();
    const signer = endorsementSignerFromKeys(m.userId, m.publicKey, m.privateKey);
    const e = await signEndorsement({ hash: "00ab", index: 3, epoch: 0, tick: 1 }, true, signer, 1, "cell-chain-id");
    expect(await verifyEndorsement(e, "cell-chain-id")).toBe(true);
    expect(await verifyEndorsement(e)).toBe(false);
    expect(await verifyEndorsement(e, "other-cell")).toBe(false);
  });
});

describe("this device's cell chains", () => {
  function memoryStore() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v); },
      removeItem: (k: string) => { data.delete(k); },
    };
  }

  it("creates the owner's chain once, and refuses another owner's genesis for the same cell", async () => {
    const owner = await newMember();
    const rival = await newMember();
    const chains = new CellChains(memoryStore(), { storage: memoryCellChainStorage(), difficulty: 1 });
    const chain = (await chains.ensureOwned(CELL, "Garden Club", owner.text, T0))!;
    expect((await chains.ensureOwned(CELL, "Garden Club", owner.text, T0 + 5))?.chainId).toBe(chain.chainId);
    expect(await chains.ensureOwned(CELL, "Garden Club", rival.text, T0)).toBeNull();
    const forged = await signRosterRecord(genesisRecord(CELL, "Garden Club", rival.userId, T0), rival.text);
    expect(await chains.setGenesis(CELL, forged)).toBe(false);
  });

  it("moves records saved by the first signed-roster version into the chain", async () => {
    const owner = await newMember();
    const bob = await newMember();
    const store = memoryStore();
    const now = () => T0 + BEAT;
    const genesis = await signRosterRecord(genesisRecord(CELL, "Garden Club", owner.userId, T0), owner.text);
    const chainId = (await CellChain.open(genesis, { storage: memoryCellChainStorage(), difficulty: 1, now }))!.chainId;
    const invite = await signRosterRecord(inviteRecord(chainId, bob.userId, T0 + 1), owner.text);
    store.setItem(`cell-roster-v1:${CELL}`, JSON.stringify([genesis, invite]));
    const chains = new CellChains(store, { storage: memoryCellChainStorage(), difficulty: 1, now });
    const chain = (await chains.chain(CELL))!;
    expect(chain.chainId).toBe(chainId);
    expect(chain.getPendingTransactions().map((tx) => tx.id)).toHaveLength(1);
    expect(store.getItem(`cell-roster-v1:${CELL}`)).toBeNull();
  });
});
