import { describe, expect, it } from "vitest";
import type { SwarmTransaction } from "../types";
import { buildDonorLeaderboard, formatDonationAmounts } from "./donorLeaderboard";
import { INFINITY_GIFT_VAULT } from "./vaults";

const tx = (p: Partial<SwarmTransaction>): SwarmTransaction => ({
  id: crypto.randomUUID(), type: "wallet_tip", from: "a", to: INFINITY_GIFT_VAULT, amount: 1,
  timestamp: "2026-01-01T00:00:00Z", signature: "", publicKey: "", nonce: 0, fee: 0, ...p,
});

describe("buildDonorLeaderboard", () => {
  it("counts gifts to Infinity and member vault donations, ranked by SWARM", () => {
    const board = buildDonorLeaderboard([
      tx({ from: "alice", amount: 10, meta: { ticker: "SWARM" } }),
      tx({ from: "bob", amount: 50, type: "pool_donate", to: "community-pool" }),
      tx({ from: "alice", amount: 3, meta: { ticker: "MINTME" } }),
      tx({ from: "alice", amount: 5, meta: { ticker: "SWARM" } }),
    ]);
    expect(board.donors.map((d) => d.userId)).toEqual(["bob", "alice"]);
    expect(board.donors[1].amounts).toEqual({ SWARM: 15, MINTME: 3 });
    expect(board.totals).toEqual({ SWARM: 65, MINTME: 3 });
    expect(board.donationCount).toBe(4);
  });

  it("skips system tax, tips to other people, and duplicate tx ids", () => {
    const dup = tx({ from: "carol", amount: 7 });
    const board = buildDonorLeaderboard([
      tx({ from: "system", type: "pool_donate", amount: 100 }),
      tx({ from: "dave", to: "0123456789abcdef", amount: 9 }),
      dup, dup,
    ]);
    expect(board.donors).toHaveLength(1);
    expect(board.totals).toEqual({ SWARM: 7 });
  });

  it("formats SWARM first", () => {
    expect(formatDonationAmounts({ MINTME: 2, SWARM: 1500 })).toBe(`${(1500).toLocaleString()} SWARM · 2 MINTME`);
  });
});
