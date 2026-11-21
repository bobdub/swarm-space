import { describe, expect, it } from "vitest";
import type { SwarmTransaction } from "../types";
import { buildDonorLeaderboard, formatDonationAmounts } from "./donorLeaderboard";
import { INFINITY_GIFT_VAULT } from "./vaults";
import { NATIVE_MINTME_ASSET_ID } from "../wallets/nativeMintmeLedger";

const tx = (p: Partial<SwarmTransaction>): SwarmTransaction => ({
  id: crypto.randomUUID(), type: "wallet_tip", from: "a", to: INFINITY_GIFT_VAULT, amount: 1,
  timestamp: "2026-01-01T00:00:00Z", signature: "", publicKey: "", nonce: 0, fee: 0, ...p,
});

const MINTME_META = { assetId: NATIVE_MINTME_ASSET_ID, currency: "MINTME", amountUnits: "3000000000000000000", ticker: "MINTME" };

describe("buildDonorLeaderboard", () => {
  it("counts gifts to Infinity and member vault donations, ranked by SWARM", () => {
    const board = buildDonorLeaderboard([
      tx({ from: "alice", amount: 10, meta: { assetId: "chain:SWARM", ticker: "SWARM" } }),
      tx({ from: "bob", amount: 50, type: "pool_donate", to: "community-pool" }),
      tx({ from: "alice", amount: 3, meta: MINTME_META }),
      tx({ from: "alice", amount: 5, meta: { assetId: "chain:SWARM", ticker: "SWARM" } }),
    ]);
    expect(board.donors.map((d) => d.userId)).toEqual(["bob", "alice"]);
    expect(board.donors[1].amounts).toEqual({ SWARM: 15, MINTME: 3 });
    expect(board.totals).toEqual({ SWARM: 65, MINTME: 3 });
    expect(board.donationCount).toBe(4);
  });

  it("skips system tax, tips to other people, and duplicate tx ids", () => {
    const dup = tx({ from: "carol", amount: 7, meta: { assetId: "chain:SWARM" } });
    const board = buildDonorLeaderboard([
      tx({ from: "system", type: "pool_donate", amount: 100 }),
      tx({ from: "dave", to: "0123456789abcdef", amount: 9 }),
      dup, dup,
    ]);
    expect(board.donors).toHaveLength(1);
    expect(board.totals).toEqual({ SWARM: 7 });
  });

  it("takes the currency from the settled asset, not the display ticker", () => {
    const board = buildDonorLeaderboard([
      tx({ from: "eve", amount: 3, meta: { ...MINTME_META, ticker: "SWARM" } }),
      tx({ from: "eve", amount: 9, meta: { assetId: "token:eve-coin", ticker: "SWARM" } }),
      tx({ from: "eve", amount: 4, meta: { assetId: "token:fox", ticker: "FOX" } }),
      tx({ from: "eve", amount: 1, meta: { ticker: "SWARM" } }),
    ]);
    expect(board.totals).toEqual({ MINTME: 3, "token:eve-coin": 9, FOX: 4 });
  });

  it("formats SWARM first", () => {
    expect(formatDonationAmounts({ MINTME: 2, SWARM: 1500 })).toBe(`${(1500).toLocaleString()} SWARM · 2 MINTME`);
  });
});
