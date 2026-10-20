import { describe, expect, it } from "vitest";
import { knownContractsFrom } from "./creatorVaultAssets";
import type { SwarmTransaction } from "./types";

const tx = (o: Partial<SwarmTransaction>) => ({ id: "x", from: "a", to: "b", amount: 1, timestamp: "", signature: "", publicKey: "", nonce: 0, fee: 0, ...o }) as SwarmTransaction;

describe("vault known contracts", () => {
  it("only recognises tokens deposited onto the native ledger", () => {
    const c = "0x" + "b".repeat(40);
    const set = knownContractsFrom([
      tx({ type: "external_deposit", meta: { currency: `MINTME:${c.toUpperCase().replace("0X", "0x")}` } }),
      tx({ type: "token_transfer", meta: { currency: "MINTME:0x" + "c".repeat(40) } }),
    ]);
    expect([...set]).toEqual([c]);
  });
});
