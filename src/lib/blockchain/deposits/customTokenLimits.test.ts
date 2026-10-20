import { describe, expect, it } from "vitest";
import type { SwarmTransaction } from "../types";
import { assertCustomTokenDepositCapacity, customTokenDepositCapacity } from "./customTokenLimits";

const address = `0x${"ab".repeat(20)}`;
const deposit = (id: string, amount: number, to = "user-a", contract = address): SwarmTransaction => ({
  id, type: "external_deposit", from: "external", to, amount, timestamp: new Date(0).toISOString(), signature: "", fee: 0,
  meta: { currency: `MINTME:${contract}` },
});

describe("custom-token shared deposit ceiling", () => {
  it("accepts exactly 5,000,000 and refuses above it", () => {
    expect(assertCustomTokenDepositCapacity([], address, 5_000_000).max).toBe(5_000_000);
    expect(() => assertCustomTokenDepositCapacity([], address, 5_000_001)).toThrow("5,000,000");
  });
  it("counts deposits by different users together, including pending records", () => {
    const txs = [deposit("a", 3_000_000), deposit("b", 1_500_000, "user-b")];
    expect(customTokenDepositCapacity(txs, address).remaining).toBe(500_000);
    expect(() => assertCustomTokenDepositCapacity(txs, address, 500_001)).toThrow();
  });
  it("does not replenish lifetime capacity after withdrawal", () => {
    const withdrawal = { ...deposit("w", 2_000_000), type: "external_withdraw" as const };
    expect(customTokenDepositCapacity([deposit("a", 5_000_000), withdrawal], address).remaining).toBe(0);
  });
  it("keeps contract identity separate and normalizes case", () => {
    expect(customTokenDepositCapacity([deposit("a", 5_000_000)], `0x${"cd".repeat(20)}`).remaining).toBe(5_000_000);
    expect(customTokenDepositCapacity([deposit("a", 2_000_000)], address.toUpperCase()).remaining).toBe(3_000_000);
  });
  it("does not count duplicated ledger records twice", () => {
    const tx = deposit("a", 2_000_000);
    expect(customTokenDepositCapacity([tx, tx], address).remaining).toBe(3_000_000);
  });
});