import { describe, it, expect } from "vitest";
import { sealedCoinHistory } from "../sealedCoins";
const base = { weight: 0, maxWeight: 1, wrappedTokens: [], ownerId: "u", status: "wallet" as const, minedAt: "" };
describe("sealed coin history", () => {
  it("lists only the user's sealed coins, newest first", () => {
    const rows = sealedCoinHistory([
      { ...base, coinId: "a", fillState: "sealed", creatorProof: { version: 1, sealedAt: "2026-01-01", payloadBytes: 2e6, tier: "basic" } },
      { ...base, coinId: "b", fillState: "sealed", creatorProof: { version: 1, sealedAt: "2026-02-01", tier: "rare" } },
      { ...base, coinId: "c", fillState: "filling" },
      { ...base, coinId: "d", ownerId: "x", fillState: "sealed", creatorProof: { version: 1, sealedAt: "2026-03-01" } },
    ], "u");
    expect(rows.map((r) => r.coinId)).toEqual(["b", "a"]);
    expect(rows[1].bytes).toBe(2e6);
  });
});
