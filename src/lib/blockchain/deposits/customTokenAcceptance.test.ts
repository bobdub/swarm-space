import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SwarmTransaction } from "../types";
vi.mock("../storage", () => ({ getChainState: async () => null, saveChainState: async () => {}, saveBlock: async () => {} }));
vi.mock("../chainHealthBridge", () => ({ recordBlockAccepted: () => {}, bootstrapChainBridge: () => {} }));
vi.mock("./customTokenCustody", async importOriginal => {
  const actual = await importOriginal<typeof import("./customTokenCustody")>();
  return { ...actual, verifyCustomTokenSync: async () => true };
});
import { SwarmChain } from "../chain";
const contract = `0x${"ab".repeat(20)}`, address = `0x${"cd".repeat(20)}`;
const receipt = (units: number, total = units): SwarmTransaction => ({
  id: `token-sync:${contract}:${address}:${total}`, type: "external_deposit", from: address, to: "member", amount: units,
  fee: 0, nonce: 1, timestamp: new Date().toISOString(), signature: "verified-in-test", publicKey: address,
  meta: { currency: `MINTME:${contract}`, custody: "cold-token-sync-v1", custodyAddress: address,
    contract, decimals: 0, amountUnits: String(units), cumulativeUnits: String(total) },
});
beforeEach(() => localStorage.clear());
describe("atomic custom token receipt acceptance", () => {
  it("appends a concurrently received receipt only once and never changes SWARM", async () => {
    const chain = new SwarmChain(); await chain.whenReady();
    const tx = receipt(10);
    await Promise.all([chain.acceptCustomTokenDeposit(tx), chain.acceptCustomTokenDeposit(tx)]);
    expect(chain.getPendingTransactions()).toHaveLength(1);
    expect(chain.getBalance("member")).toBe(0);
    expect(() => chain.addTransaction(tx)).toThrow("verified acceptance");
  });
  it("rejects competing stale cumulative receipts", async () => {
    const chain = new SwarmChain(); await chain.whenReady();
    const results = await Promise.all([chain.acceptCustomTokenDeposit(receipt(10)), chain.acceptCustomTokenDeposit(receipt(20))]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(chain.getPendingTransactions()).toHaveLength(1);
  });
  it("permits exactly 5,000,000 ingress and rejects one more", async () => {
    const chain = new SwarmChain(); await chain.whenReady();
    expect(await chain.acceptCustomTokenDeposit(receipt(5_000_000))).toBe(true);
    expect(await chain.acceptCustomTokenDeposit(receipt(1, 5_000_001))).toBe(false);
    expect(chain.getPendingTransactions()).toHaveLength(1);
  });
});