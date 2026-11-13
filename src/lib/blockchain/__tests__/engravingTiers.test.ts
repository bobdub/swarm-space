import { describe, it, expect } from "vitest";
import { engravingTier, readSealTier, canSealEngraving } from "../engravingTiers";
import { applySeal } from "../coinFill";
import { tickCoin } from "../coinFillScheduler";
import type { SwarmCoin } from "../types";

const loaded = (bytes: number): SwarmCoin => ({
  coinId: "c", ownerId: "u", status: "wallet", weight: 0, maxWeight: 100,
  minedAt: "2026-11-12T00:00:00Z", wrappedTokens: [], fillState: "filling", sealBytes: bytes,
  lastPayloadLoadAt: "2026-11-12T00:00:00Z",
  payloadEntries: [{ id: "p", type: "post", sizeBytes: bytes, hash: "a" }],
});
describe("engraving size policy", () => {
  it.each([[1_000_000, "basic"], [5_000_000, "basic"], [9_999_999, "basic"],
    [10_000_000, "rare"], [49_999_999, "rare"], [50_000_000, "legendary"], [1024 ** 3, "legendary"]])(
    "records %i bytes as %s", (bytes, tier) => {
      expect(engravingTier(Number(bytes))).toBe(tier);
      expect(applySeal(loaded(Number(bytes))).creatorProof?.tier).toBe(tier);
    });
  it("reads older 1 GiB coins as Legendary without rewriting the seal", () => {
    const old = { version: 1 as const, sealedAt: "2025-01-01", payloadBytes: 1024 ** 3 };
    expect(readSealTier({ creatorProof: old })).toBe("legendary");
    expect(old).not.toHaveProperty("tier");
  });
  it.each([NaN, Infinity, -1, 1024 ** 3 + 1])("rejects invalid bytes %s", (bytes) => {
    expect(canSealEngraving(loaded(bytes), "manual")).toBe(false);
  });
  it.each([{ locked: true }, { status: "vaulted" as const }, { kind: "media" as const },
    { fillState: "spent" as const }, { fillState: "sealed" as const }, { payloadEntries: [] }])(
    "rejects ineligible containers %j", (change) => {
      expect(canSealEngraving({ ...loaded(5_000_000), ...change }, "manual")).toBe(false);
    });
  it("does not automatically seal below 5 MB", () => {
    expect(canSealEngraving(loaded(4_999_999), "idle", Date.parse("2027-01-01"))).toBe(false);
  });
  it("prevents stress-only sealing of loaded containers", () => {
    const coin = loaded(5_000_000);
    expect(tickCoin(coin, 1000, 1000)).toEqual(coin);
  });
  it("preserves an existing seal on repeat calls", () => {
    const sealed = applySeal(loaded(10_000_000), "2026-11-12T00:00:00Z");
    expect(applySeal(sealed, "2027-01-01T00:00:00Z")).toBe(sealed);
  });
});