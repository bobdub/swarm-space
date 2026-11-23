import { describe, expect, it } from "vitest";
import { calculateHash, findProofOfWork, hasLeadingHexZeros } from "../crypto";
import type { SwarmBlock } from "../types";

function block(over: Partial<SwarmBlock> = {}): SwarmBlock {
  return {
    index: 7,
    timestamp: "2026-11-23T20:00:00.000Z",
    transactions: [{ id: "tx-1", type: "mining_reward", from: "system", to: "alice", amount: 5, timestamp: "2026-11-23T20:00:00.000Z" }],
    previousHash: "00ab",
    hash: "",
    nonce: 0,
    difficulty: 2,
    miner: "alice",
    merkleRoot: "m-root",
    ...over,
  } as SwarmBlock;
}

/** The original miner: hash every nonce in turn with calculateHash. */
async function naive(b: SwarmBlock): Promise<{ nonce: number; hash: string }> {
  const target = "0".repeat(b.difficulty);
  for (let nonce = b.nonce; ; nonce++) {
    const hash = await calculateHash({ ...b, nonce });
    if (hash.startsWith(target)) return { nonce, hash };
  }
}

describe("findProofOfWork", () => {
  it("finds the same nonce and hash as hashing each nonce in turn", async () => {
    for (const b of [block(), block({ difficulty: 3, index: 9 }), block({ nonce: 40, previousHash: "ff" })]) {
      const fast = await findProofOfWork(b);
      expect(fast).toEqual(await naive(b));
      expect(await calculateHash({ ...b, nonce: fast.nonce })).toBe(fast.hash);
    }
  });

  it("hashes v2 headers the same way calculateHash does", async () => {
    const b = block({ version: 2, epoch: 1, tick: 3, producer: "p", clockSession: "s", difficulty: 2 } as Partial<SwarmBlock>);
    const fast = await findProofOfWork(b);
    expect(await calculateHash({ ...b, nonce: fast.nonce })).toBe(fast.hash);
    expect(fast.hash.startsWith("00")).toBe(true);
  });
});

describe("hasLeadingHexZeros", () => {
  it("checks whole and half bytes", () => {
    expect(hasLeadingHexZeros(new Uint8Array([0, 0x0f, 1]), 3)).toBe(true);
    expect(hasLeadingHexZeros(new Uint8Array([0, 0x10, 1]), 3)).toBe(false);
    expect(hasLeadingHexZeros(new Uint8Array([0, 0, 1]), 4)).toBe(true);
    expect(hasLeadingHexZeros(new Uint8Array([0, 1, 1]), 4)).toBe(false);
    expect(hasLeadingHexZeros(new Uint8Array([5]), 0)).toBe(true);
  });
});
