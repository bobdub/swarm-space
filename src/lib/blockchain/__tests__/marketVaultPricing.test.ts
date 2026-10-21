import { describe, expect, it } from "vitest";
import { marketVaultLayers, quoteVaultBuy, spotCreditsPerSwarm } from "../marketVaultPricing";

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
