import { describe, it, expect } from "vitest";
import { creatorVaultBacking } from "../creatorVaultBacking";
import type { CreatorVault } from "../types";

const vault: CreatorVault = {
  tokenId: "token", creatorUserId: "creator", buybackReserve: 40,
  stabilityFloor: 40, creatorEarnings: 15, communityContributed: 5,
  totalDeposited: 100, lifetimeBuybacks: 0, circulatingSupply: 100,
  currentTier: 0, updatedAt: "2026-10-20T22:07:00Z",
};

describe("Coin Vault layer backing", () => {
  it("allows 15 SWARM earnings only when all 40/40/15/5 layers are backed", () => {
    expect(creatorVaultBacking(vault, 100)).toMatchObject({ required: 100, backed: true, claimable: 15 });
    expect(creatorVaultBacking(vault, 15)).toMatchObject({ backed: false, claimable: 0, shortfall: 85 });
  });
  it("does not count lifetime deposits again after a payout", () => {
    expect(creatorVaultBacking({ ...vault, creatorEarnings: 10 }, 95).claimable).toBe(10);
  });
  it("rejects non-finite custody and incomplete legacy layers", () => {
    expect(creatorVaultBacking(vault, NaN).backed).toBe(false);
    expect(creatorVaultBacking({ ...vault, stabilityFloor: NaN }, 100).claimable).toBe(0);
  });
});