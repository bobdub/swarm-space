import { describe, expect, it } from "vitest";
import { marketVaultLayers, quoteVaultBuy, spotCreditsPerSwarm, quoteCreatorTokenForSwarm } from "../marketVaultPricing";
import { priceAtSupply } from "../creatorVault";

describe("market vault pricing", () => {
  it("keeps 40% of the community pool as an untouchable floor", () => {
    const l = marketVaultLayers({ poolBalance: 1000, knownMined: 1000 });
    expect(l.floor).toBe(400);
    expect(l.liquid).toBe(600);
  });

  it("never prices below 100 Credits per SWARM", () => {
    expect(spotCreditsPerSwarm({ poolBalance: 1e9, knownMined: 1 })).toBeGreaterThanOrEqual(100);
  });

  it("limits one trade to 10% of the liquid layer", () => {
    const q = quoteVaultBuy({ poolBalance: 1000, knownMined: 1000 }, 61, 1e9);
    expect(q.error).toMatch(/at most/);
  });

  it("rejects buys beyond the user's Credits", () => {
    const q = quoteVaultBuy({ poolBalance: 1000, knownMined: 1000 }, 1, 50);
    expect(q.error).toMatch(/Credits/);
  });

  it("rejects buys when nothing is above the floor", () => {
    expect(quoteVaultBuy({ poolBalance: 0, knownMined: 10 }, 1, 1e6).error).toMatch(/floor/);
  });
});

import { quoteSwarmForToken, quoteTokenForSwarm } from "../marketVaultPricing";

describe("native token trades", () => {
  const s = { poolBalance: 1000, knownMined: 1000 }; // 600 liquid
  it("values tokens against the 5,000,000 ceiling plus vault holdings", () => {
    expect(quoteTokenForSwarm(s, 0, 1000, 1000).out).toBeCloseTo((600 * 1000) / 5_001_000, 5);
  });
  it("refuses more than the synced balance", () => {
    expect(quoteTokenForSwarm(s, 0, 100, 50).error).toMatch(/available/);
  });
  it("cannot sell SWARM for a token the vault doesn't hold", () => {
    expect(quoteSwarmForToken(s, 0, 1, 10).error).toMatch(/none/);
  });
});

describe("creator-token live profile rate", () => {
  const state = { poolBalance: 1000, knownMined: 1000 };
  it("pays the live profile price rather than the fixed 10:1 ratio", () => {
    expect(quoteCreatorTokenForSwarm(state, priceAtSupply(100), 10, 10)).toEqual({ out: 2, error: null });
    expect(quoteCreatorTokenForSwarm(state, priceAtSupply(200), 10, 10).out).toBe(3);
  });
  it("retains the 40% floor and 10% liquid trade cap", () => {
    expect(quoteCreatorTokenForSwarm(state, 1, 61, 100).error).toMatch(/at most 60/);
  });
  it("refuses tokens not held in Native", () => {
    expect(quoteCreatorTokenForSwarm(state, 1, 10, 0).error).toMatch(/Native balance/);
  });
  it("refuses unavailable rates", () => {
    expect(quoteCreatorTokenForSwarm(state, NaN, 1, 10).error).toMatch(/unavailable/);
  });
  it("never pays for quantities smaller than the ownership record precision", () => {
    expect(quoteCreatorTokenForSwarm(state, 1000, 0.0000001, 10).error).toMatch(/six decimal/);
  });
});
