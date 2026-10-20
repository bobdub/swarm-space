import { describe, expect, it } from "vitest";
import { poolDeltaFromTx } from "../storage";
import type { SwarmTransaction } from "../types";

function transaction(meta: Record<string, unknown>): SwarmTransaction {
  return { id: "closure", type: "creator_token_earnings_withdraw", from: "creator", to: "creator",
    amount: 0, fee: 0, nonce: 1, timestamp: "2026-10-20T22:07:00Z", signature: "", publicKey: "creator", meta };
}

describe("Market closure survives community pool re-derivation", () => {
  it("counts the dissolved reserve as a pool contribution", () => {
    expect(poolDeltaFromTx(transaction({ closed: true, dissolved: 20 }))).toBe(20);
  });
  it("does not count an ordinary earnings claim as a community contribution", () => {
    expect(poolDeltaFromTx(transaction({ tokenId: "token", dissolved: 20 }))).toBe(0);
  });
});