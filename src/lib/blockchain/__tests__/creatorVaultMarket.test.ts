import { describe, it, expect, vi, beforeEach } from "vitest";

const stores = new Map<string, Map<string, unknown>>();
const s = (n: string) => {
  if (!stores.has(n)) stores.set(n, new Map());
  const store = stores.get(n);
  if (!store) throw new Error("Missing test store");
  return store;
};

vi.mock("@/lib/store", () => ({
  put: async (n: string, v: { tokenId?: string; id?: string; coinId?: string; userId?: string }) => {
    const key = (v.tokenId ?? v.id ?? v.coinId ?? (n === "profileTokenHoldings" ? (v as { id?: string }).id : undefined)) as string;
    s(n).set(key, v);
  },
  get: async (n: string, k: string) => s(n).get(k),
  getAll: async (n: string) => Array.from(s(n).values()),
  remove: async (n: string, k: string) => { s(n).delete(k); },
}));

const balances = new Map<string, number>();
vi.mock("../token", () => ({
  getSwarmBalance: async (addr: string) => balances.get(addr) ?? 0,
  transferSwarm: async ({ from, to, amount }: { from: string; to: string; amount: number }) => {
    const bal = balances.get(from) ?? 0;
    if (bal < amount) throw new Error("Insufficient SWARM balance");
    balances.set(from, bal - amount);
    balances.set(to, (balances.get(to) ?? 0) + amount);
  },
}));

vi.mock("../chain", () => ({
  getSwarmChain: () => ({ addTransaction: () => true, whenReady: async () => {} }),
}));

const holdings = new Map<string, { userId: string; tokenId: string; ticker: string; creatorUserId: string; amount: number; lastUpdated: string }>();
vi.mock("../profileTokenBalance", () => ({
  addProfileTokens: async ({ userId, tokenId, ticker, creatorUserId, amount }: { userId: string; tokenId: string; ticker: string; creatorUserId: string; amount: number }) => {
    const key = `${userId}-${tokenId}`;
    const h = holdings.get(key) ?? { userId, tokenId, ticker, creatorUserId, amount: 0, lastUpdated: "" };
    h.amount += amount;
    holdings.set(key, h);
  },
  getProfileTokenHolding: async (userId: string, tokenId: string) => holdings.get(`${userId}-${tokenId}`) ?? null,
  saveProfileTokenHolding: async (h: { userId: string; tokenId: string }) => { holdings.set(`${h.userId}-${h.tokenId}`, h as never); },
}));

vi.mock("../storage", () => ({
  getProfileToken: async () => null,
  getRewardPool: async () => s("rewardPool").get("global") ?? null,
  saveRewardPool: async (p: unknown) => { s("rewardPool").set("global", p); },
}));

vi.mock("../coin.bus", () => ({ emitCoinFill: () => {} }));

import { buyCreatorTokens, sellCreatorTokens, getCreatorVault, withdrawCreatorEarnings } from "../creatorVault";
import { creatorVaultAddress } from "../creatorVaultCustody";

beforeEach(() => {
  stores.clear();
  holdings.clear();
  balances.clear();
  s("profileTokens").set("tok-1", {
    tokenId: "tok-1", userId: "creator-1", ticker: "AAA", name: "AAA",
    supply: 4000, maxSupply: 10000,
  });
});

describe("Creator market — real custody in and out", () => {
  it("a buy locks SWARM into the vault address instead of burning it", async () => {
    balances.set("buyer-1", 100);
    const { cost } = await buyCreatorTokens({ buyerId: "buyer-1", tokenId: "tok-1", tokens: 10 });

    expect(cost).toBeCloseTo(1.05, 6);
    expect(balances.get("buyer-1")).toBeCloseTo(98.95, 6);
    expect(balances.get(creatorVaultAddress("tok-1"))).toBeCloseTo(1.05, 6);

    const coin = s("swarmCoins").get("vault-coin:creator:tok-1") as { status: string; locked: boolean };
    expect(coin.status).toBe("vaulted");
    expect(coin.locked).toBe(true);
  });

  it("a sell pays the holder out of the vault's real holdings instead of minting", async () => {
    balances.set("buyer-1", 100);
    await buyCreatorTokens({ buyerId: "buyer-1", tokenId: "tok-1", tokens: 10 });
    const heldBefore = balances.get(creatorVaultAddress("tok-1")) ?? 0;

    const { proceeds } = await sellCreatorTokens({ sellerId: "buyer-1", tokenId: "tok-1", tokens: 10 });

    expect(proceeds).toBeGreaterThan(0);
    // The payout came out of custody: vault balance dropped by exactly the proceeds.
    expect(balances.get(creatorVaultAddress("tok-1"))).toBeCloseTo(heldBefore - proceeds, 6);
    expect(balances.get("buyer-1")).toBeCloseTo(98.95 + proceeds, 6);
  });

  it("a legacy vault with no engraved custody cannot pay out", async () => {
    // Buckets exist (pre-custody accounting) but the vault address holds nothing.
    s("creatorVaults").set("tok-1", {
      tokenId: "tok-1", creatorUserId: "creator-1",
      buybackReserve: 20, stabilityFloor: 20, creatorEarnings: 7.5, communityContributed: 2.5,
      totalDeposited: 50, lifetimeBuybacks: 0, circulatingSupply: 100, currentTier: 0,
      updatedAt: new Date().toISOString(),
    });
    holdings.set("seller-1-tok-1", {
      userId: "seller-1", tokenId: "tok-1", ticker: "AAA", creatorUserId: "creator-1",
      amount: 10, lastUpdated: "",
    });

    await expect(
      sellCreatorTokens({ sellerId: "seller-1", tokenId: "tok-1", tokens: 1 }),
    ).rejects.toThrow("no engraved funds");

    const vault = await getCreatorVault("tok-1");
    expect(vault?.buybackReserve).toBe(20); // untouched by the failed payout
  });

  it("claims only the creator's earnings from real custody, leaving other layers unchanged", async () => {
    balances.set("buyer-1", 100);
    await buyCreatorTokens({ buyerId: "buyer-1", tokenId: "tok-1", tokens: 10 });
    const before = { ...await getCreatorVault("tok-1") };
    const held = balances.get(creatorVaultAddress("tok-1")) ?? 0;
    const vault = await withdrawCreatorEarnings({ creatorId: "creator-1", tokenId: "tok-1", amount: 0.1 });
    expect(vault.creatorEarnings).toBeCloseTo(0.0575, 6);
    expect(vault.buybackReserve).toBe(before.buybackReserve);
    expect(vault.stabilityFloor).toBe(before.stabilityFloor);
    expect(vault.communityContributed).toBe(before.communityContributed);
    expect(balances.get("creator-1")).toBeCloseTo(0.1, 6);
    expect(balances.get(creatorVaultAddress("tok-1"))).toBeCloseTo(held - 0.1, 6);
  });

  it("refuses another user's earnings claim", async () => {
    balances.set("buyer-1", 100);
    await buyCreatorTokens({ buyerId: "buyer-1", tokenId: "tok-1", tokens: 10 });
    await expect(withdrawCreatorEarnings({ creatorId: "other", tokenId: "tok-1", amount: 0.1 })).rejects.toThrow("Only the creator");
    expect((await getCreatorVault("tok-1"))?.creatorEarnings).toBeCloseTo(0.1575, 6);
  });

  it("refuses earnings above the layer balance and non-finite amounts", async () => {
    balances.set("buyer-1", 100);
    await buyCreatorTokens({ buyerId: "buyer-1", tokenId: "tok-1", tokens: 10 });
    await expect(withdrawCreatorEarnings({ creatorId: "creator-1", tokenId: "tok-1", amount: 0.2 })).rejects.toThrow("Insufficient earnings");
    await expect(withdrawCreatorEarnings({ creatorId: "creator-1", tokenId: "tok-1", amount: NaN })).rejects.toThrow("finite");
  });

  it("keeps legacy earnings unchanged when no funds exist in custody", async () => {
    s("creatorVaults").set("tok-1", { tokenId: "tok-1", creatorUserId: "creator-1", creatorEarnings: 7.5 });
    await expect(withdrawCreatorEarnings({ creatorId: "creator-1", tokenId: "tok-1", amount: 1 })).rejects.toThrow("no engraved funds");
    expect((await getCreatorVault("tok-1"))?.creatorEarnings).toBe(7.5);
  });

  it("rejects a simultaneous second earnings claim", async () => {
    balances.set("buyer-1", 100);
    await buyCreatorTokens({ buyerId: "buyer-1", tokenId: "tok-1", tokens: 10 });
    const first = withdrawCreatorEarnings({ creatorId: "creator-1", tokenId: "tok-1", amount: 0.1 });
    await expect(withdrawCreatorEarnings({ creatorId: "creator-1", tokenId: "tok-1", amount: 0.1 })).rejects.toThrow("already in progress");
    await first;
    expect(balances.get("creator-1")).toBeCloseTo(0.1, 6);
  });
});
