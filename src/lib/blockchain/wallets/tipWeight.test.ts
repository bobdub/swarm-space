import { describe, expect, it } from "vitest";
import type { SwarmCoin } from "../types";
import { availableTipWeights, hasValidTipWeight, readTipWeight, resolveTipWeight } from "./tipWeight";

const coin = (over: Partial<SwarmCoin>): SwarmCoin => ({
  coinId: "c", weight: 0, maxWeight: 1, wrappedTokens: [], ownerId: "member", status: "wallet",
  fillState: "sealed", creatorProof: { version: 1, sealedAt: "2026-11-01T00:00:00Z", tier: "rare" }, ...over,
} as SwarmCoin);

describe("tip weight", () => {
  it("offers only Hollow when the member holds no engraved coins", () => {
    expect(availableTipWeights([], "member")).toEqual(["hollow"]);
    expect(availableTipWeights([coin({ creatorProof: undefined })], "member")).toEqual(["hollow"]);
    expect(availableTipWeights([coin({ ownerId: "other" })], "member")).toEqual(["hollow"]);
    expect(availableTipWeights([coin({ kind: "media" })], "member")).toEqual(["hollow"]);
  });

  it("adds each engraved tier the member holds, in tier order", () => {
    const coins = [coin({ coinId: "a", creatorProof: { version: 1, sealedAt: "", tier: "legendary" } }), coin({ coinId: "b" })];
    expect(availableTipWeights(coins, "member")).toEqual(["hollow", "rare", "legendary"]);
  });

  it("defaults to Hollow and refuses a tier the sender does not hold", () => {
    expect(resolveTipWeight(undefined, ["hollow"])).toBe("hollow");
    expect(resolveTipWeight("rare", ["hollow", "rare"])).toBe("rare");
    expect(() => resolveTipWeight("legendary", ["hollow", "rare"])).toThrow("Legendary");
  });

  it("reads legacy tips as Hollow and validates the signed format", () => {
    expect(readTipWeight({ meta: { assetId: "chain:SWARM" } })).toBe("hollow");
    expect(readTipWeight({ meta: { weight: "rare" } })).toBe("rare");
    expect(hasValidTipWeight({ meta: { assetId: "chain:SWARM" } })).toBe(true);
    expect(hasValidTipWeight({ meta: { assetId: "chain:SWARM", tipFormat: 2, weight: "rare" } })).toBe(true);
    expect(hasValidTipWeight({ meta: { assetId: "chain:SWARM", tipFormat: 2, weight: "gold" } })).toBe(false);
    expect(hasValidTipWeight({ meta: { assetId: "chain:SWARM", weight: "rare" } })).toBe(false);
    expect(hasValidTipWeight({ meta: { assetId: "external:MINTME", tipFormat: 2, weight: "rare" } })).toBe(false);
  });
});
