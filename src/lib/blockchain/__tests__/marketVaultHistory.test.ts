import { describe, expect, it } from "vitest";
import { marketVaultHistory } from "../marketVaultHistory";
import type { SwarmTransaction } from "../types";
const payout = (direction: string): SwarmTransaction => ({ id: direction, from: "community-pool", to: "member", type: "credit_lock", amount: 2,
  fee: 0, nonce: 1, signature: "", publicKey: "pool", timestamp: "2026-11-10T03:25:00Z",
  meta: { marketVault: true, direction, tradeLeg: "payout", operationId: direction, paidAmount: 250, paidAsset: "Credits", receivedAsset: "SWARM" } });
describe("Market Vault receipt wiring", () => {
  it("reads purchases from completed vault payouts with actual amounts and rate", () => {
    expect(marketVaultHistory([payout("vault-buy")], "member")[0]).toMatchObject({ direction: "vault-buy", paid: 250, received: 2, rate: 125 });
  });
  it("reads sales separately from purchases", () => {
    expect(marketVaultHistory([payout("vault-sell")], "member")[0]?.direction).toBe("vault-sell");
  });
  it("never turns payment-only, legacy or another member's transactions into receipts", () => {
    const tx = payout("vault-buy");
    expect(marketVaultHistory([{ ...tx, meta: { ...tx.meta, tradeLeg: "payment" } }, { ...tx, meta: {} }], "member")).toEqual([]);
    expect(marketVaultHistory([tx], "other")).toEqual([]);
  });
  it("counts a payout once across pending and mined records", () => {
    const tx = payout("vault-buy");
    expect(marketVaultHistory([tx, tx], "member")).toHaveLength(1);
  });
});