import { describe, expect, it } from "vitest";
import { parseTokenRef, tokenCurrency, tokenRef, tokenRefFromCurrency } from "./tokenNetworks";
import { customTokenDepositCapacity, validCustomTokenDepositLedger } from "./customTokenLimits";
import type { SwarmTransaction } from "../types";

const contract = "0x634340447220bcaaa09a5505d71ca62b644a1a82";

describe("token refs key imported tokens by chain plus contract", () => {
  it("keeps MintMe refs as the bare contract so older records stay valid", () => {
    expect(tokenRef(contract.toUpperCase().replace("0X", "0x"))).toBe(contract);
    expect(tokenCurrency(contract)).toBe(`MINTME:${contract}`);
    expect(parseTokenRef(contract)).toEqual({ network: "mintme", contract });
  });
  it("gives the same contract on Ethereum its own ref and currency", () => {
    const ref = tokenRef(contract, "ethereum");
    expect(ref).toBe(`eth:${contract}`);
    expect(tokenCurrency(ref)).toBe(`ETHEREUM:${contract}`);
    expect(tokenCurrency(ref)).not.toBe(tokenCurrency(contract));
    expect(parseTokenRef(ref)).toEqual({ network: "ethereum", contract });
  });
  it("round trips currencies and refuses anything that is not an imported token", () => {
    expect(tokenRefFromCurrency(`MINTME:${contract}`)).toBe(contract);
    expect(tokenRefFromCurrency(`ETHEREUM:${contract}`)).toBe(`eth:${contract}`);
    expect(tokenRefFromCurrency("ETH")).toBeNull();
    expect(tokenRefFromCurrency("MINTME")).toBeNull();
    expect(tokenRefFromCurrency("ETHEREUM:0x12")).toBeNull();
    expect(parseTokenRef("eth:nope")).toBeNull();
  });
  it("counts the deposit ceiling per chain, not per contract", () => {
    const deposit = (currency: string, amount: number, id: string) =>
      ({ id, type: "external_deposit", to: "a", amount, meta: { currency } }) as unknown as SwarmTransaction;
    const ledger = [deposit(`MINTME:${contract}`, 4_000_000, "m"), deposit(`ETHEREUM:${contract}`, 4_000_000, "e")];
    expect(customTokenDepositCapacity(ledger, contract).deposited).toBe(4_000_000);
    expect(customTokenDepositCapacity(ledger, `eth:${contract}`).deposited).toBe(4_000_000);
    expect(validCustomTokenDepositLedger(ledger)).toBe(true);
    expect(validCustomTokenDepositLedger([...ledger, deposit(`ETHEREUM:${contract}`, 1_000_001, "e2")])).toBe(false);
  });
});
