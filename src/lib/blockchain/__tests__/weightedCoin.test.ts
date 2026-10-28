import { describe, expect, it } from "vitest";
import { applySeal } from "../coinFill";
import { coinAssetClass, isWeightedCoin } from "../weightedCoin";

describe("weighted coin tagging", () => {
  it("sealing stamps the Creator Proof tag", () => {
    const c = applySeal({ coinId: "a", fillState: "filling" as const }, "2026-01-01T00:00:00Z");
    expect(isWeightedCoin(c as never)).toBe(true);
    expect(coinAssetClass(c as never)).toBe("swarm-weighted");
  });
  it("untagged sealed (legacy) coins stay hollow", () => {
    expect(isWeightedCoin({ fillState: "sealed" } as never)).toBe(false);
  });
});
