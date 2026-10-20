import { describe, it, expect, vi, beforeEach } from "vitest";

const stores = new Map<string, Map<string, unknown>>();
const s = (n: string) => {
  if (!stores.has(n)) stores.set(n, new Map());
  return stores.get(n)!;
};

vi.mock("@/lib/store", () => ({
  put: async (n: string, v: { tokenId?: string; id?: string }) => {
    s(n).set((v.tokenId ?? v.id) as string, v);
  },
  get: async (n: string, k: string) => s(n).get(k),
  getAll: async (n: string) => Array.from(s(n).values()),
  remove: async (n: string, k: string) => { s(n).delete(k); },
}));

const txs: Array<Record<string, unknown>> = [];
vi.mock("../chain", () => ({
  getSwarmChain: () => ({
    addTransaction: (tx: Record<string, unknown>) => { txs.push(tx); },
    whenReady: async () => {},
  }),
}));

let swarmBalance = 100;
const burns: number[] = [];
vi.mock("../token", () => ({
  getSwarmBalance: async () => swarmBalance,
  burnSwarm: async ({ amount }: { amount: number }) => { burns.push(amount); swarmBalance -= amount; },
}));

vi.mock("../storage", () => ({
  getRewardPool: async () => s("rewardPool").get("global") ?? null,
  saveRewardPool: async (p: unknown) => { s("rewardPool").set("global", p); },
}));

import { addVaultLiquidity, splitTopUp } from "../creatorVaultLiquidity";
import type { CreatorVault } from "../types";

function seedVault(): CreatorVault {
  const vault: CreatorVault = {
    tokenId: "tok-1",
    creatorUserId: "user-1",
    buybackReserve: 20,
    stabilityFloor: 20,
    creatorEarnings: 7.5,
    communityContributed: 2.5,
    totalDeposited: 50,
    lifetimeBuybacks: 0,
    circulatingSupply: 100,
    currentTier: 0,
    updatedAt: new Date().toISOString(),
  };
  s("creatorVaults").set("tok-1", vault);
  return vault;
}

beforeEach(() => {
  stores.clear();
  txs.length = 0;
  burns.length = 0;
  swarmBalance = 100;
});

describe("Creator Vault top-ups follow the layers", () => {
  it("splits a top-up 40/40/15/5 like a purchase", async () => {
    seedVault();
    const { vault, split } = await addVaultLiquidity({ creatorId: "user-1", tokenId: "tok-1", amount: 10 });

    expect(split).toEqual({ buyback: 4, stability: 4, creator: 1.5, community: 0.5 });
    expect(vault.buybackReserve).toBe(24);
    expect(vault.stabilityFloor).toBe(24);
    expect(vault.creatorEarnings).toBe(9);
    expect(vault.communityContributed).toBe(3);
    expect(vault.totalDeposited).toBe(60);
    expect(burns).toEqual([10]);
  });

  it("forwards the 5% community share to the reward pool and records the split on chain", async () => {
    seedVault();
    await addVaultLiquidity({ creatorId: "user-1", tokenId: "tok-1", amount: 10 });

    const pool = s("rewardPool").get("global") as { balance: number; contributors: Record<string, number> };
    expect(pool.balance).toBe(0.5);
    expect(pool.contributors["user-1"]).toBe(0.5);

    const tx = txs.find((t) => (t.meta as Record<string, unknown>).liquidityTopUp === true)!;
    expect((tx.meta as Record<string, unknown>).split).toEqual({ buyback: 4, stability: 4, creator: 1.5, community: 0.5 });
  });

  it("rejects top-ups from non-creators and empty vaults", async () => {
    seedVault();
    await expect(addVaultLiquidity({ creatorId: "intruder", tokenId: "tok-1", amount: 5 })).rejects.toThrow("Only the creator");
    await expect(addVaultLiquidity({ creatorId: "user-1", tokenId: "missing", amount: 5 })).rejects.toThrow("Vault not initialized");
    expect(burns).toEqual([]);
  });

  it("splitTopUp always sums back to the amount", () => {
    for (const amt of [1, 7.77, 123.456789]) {
      const { buyback, stability, creator, community } = splitTopUp(amt);
      expect(Math.abs(buyback + stability + creator + community - amt)).toBeLessThan(1e-5);
    }
  });
});
