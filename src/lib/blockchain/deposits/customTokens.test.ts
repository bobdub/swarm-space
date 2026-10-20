import { describe, it, expect, beforeEach } from "vitest";
import { addCustomToken, listCustomTokens, canHideToken, numberToUnits, unitsToNumber, isContractAddress } from "./customTokens";

const A = "0x" + "ab".repeat(20);
describe("custom tokens", () => {
  beforeEach(() => localStorage.clear());
  it("rejects non-contract addresses", () => {
    expect(isContractAddress("0x123")).toBe(false);
    expect(() => addCustomToken("u", { address: "nope", symbol: "X", decimals: 18 })).toThrow();
  });
  it("stores one entry per contract", () => {
    addCustomToken("u", { address: A, symbol: "abc", decimals: 18 });
    addCustomToken("u", { address: A.toUpperCase().replace("0X", "0x"), symbol: "ABC", decimals: 18 });
    expect(listCustomTokens("u")).toHaveLength(1);
    expect(listCustomTokens("u")[0].symbol).toBe("ABC");
  });
  it("only allows hiding a zero-balance token", () => {
    expect(canHideToken(0, 0)).toBe(true);
    expect(canHideToken(1, 0)).toBe(false);
    expect(canHideToken(0, 2)).toBe(false);
    expect(canHideToken(null, 0)).toBe(false);
  });
  it("converts units with decimals", () => {
    expect(numberToUnits(1.5, 18)).toBe(1500000000000000000n);
    expect(unitsToNumber(1500000000000000000n, 18)).toBe(1.5);
  });
});
