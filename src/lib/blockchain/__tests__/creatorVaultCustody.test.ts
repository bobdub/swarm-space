import { describe, it, expect, vi, beforeEach } from "vitest";

const stores = new Map<string, Map<string, unknown>>();
const s = (n: string) => {
  if (!stores.has(n)) stores.set(n, new Map());
  return stores.get(n)!;
};

vi.mock("@/lib/store", () => ({
  put: async (n: string, v: { tokenId?: string; id?: string; coinId?: string }) => {
    s(n).set((v.tokenId ?? v.id ?? v.coinId) as string, v);
  },
  get: async (n: string, k: string) => s(n).get(k),
  getAll: async (n: string) => Array.from(s(n).values()),
  remove: async (n: string, k: string) => { s(n).delete(k); },
}));

// Ledger balances keyed by address; transfers move real value.
const balances = new Map<string, number>();
const transfers: Array<{ from: string; to: string; amount: number; meta?: Record<string, unknown> }> = [];
vi.mock("../token", () => ({
  getSwarmBalance: async (addr: string) => balances.get(addr) ?? 0,
  transferSwarm: async ({ from, to, amount, meta }: { from: string; to: string; amount: number; meta?: Record<string, unknown> }) => {
    const bal = balances.get(from) ?? 0;
    if (bal < amount) throw new Error("Insufficient SWARM balance");
    balances.set(from, bal - amount);
    balances.set(to, (balances.get(to) ?? 0) + amount);
    transfers.push({ from, to, amount, meta });
  },
}));

import {
  creatorVaultAddress,
  creatorVaultCoinId,
  ensureCreatorVaultCoin,
  lockIntoCreatorVault,
  releaseFromCreatorVault,
  getCreatorVaultCoin,
} from "../creatorVaultCustody";

const SPLIT = { buyback: 4, stability: 4, creator: 1.5, community: 0.5 };

beforeEach(() => {
  stores.clear();
  balances.clear();
  transfers.length = 0;
});

describe("Creator Vault custody — engravings, not burns", () => {
  it("locks deposits into the vault address and engraves the vault coin", async () => {
    balances.set("user-1", 100);
    await lockIntoCreatorVault({
      fromId: "user-1", tokenId: "tok-1", creatorUserId: "user-1",
      amount: 10, split: SPLIT, reason: "Vault liquidity top-up (tok-1)",
    });

    expect(balances.get("user-1")).toBe(90);
    expect(balances.get(creatorVaultAddress("tok-1"))).toBe(10);
    expect(transfers[0].meta).toMatchObject({ vaultCustody: true, direction: "lock", split: SPLIT });

    const coin = (await getCreatorVaultCoin("tok-1"))!;
    expect(coin.coinId).toBe(creatorVaultCoinId("tok-1"));
    expect(coin.status).toBe("vaulted");
    expect(coin.locked).toBe(true);
    expect(coin.ownerId).toBe(creatorVaultAddress("tok-1"));
    expect(coin.custodyChain).toHaveLength(2); // engraving + deposit
  });

  it("refuses to lock more than the payer holds", async () => {
    balances.set("user-1", 5);
    await expect(
      lockIntoCreatorVault({
        fromId: "user-1", tokenId: "tok-1", creatorUserId: "user-1",
        amount: 10, split: SPLIT, reason: "top-up",
      }),
    ).rejects.toThrow("Insufficient SWARM");
    expect(balances.get("user-1")).toBe(5);
  });

  it("releases payouts from the vault's real holdings and engraves them", async () => {
    balances.set("user-1", 100);
    await lockIntoCreatorVault({
      fromId: "user-1", tokenId: "tok-1", creatorUserId: "user-1",
      amount: 10, split: SPLIT, reason: "top-up",
    });
    await releaseFromCreatorVault({
      tokenId: "tok-1", creatorUserId: "user-1", toId: "buyer-2",
      amount: 4, layer: "reserve", reason: "Buyback 10 AAA",
    });

    expect(balances.get(creatorVaultAddress("tok-1"))).toBe(6);
    expect(balances.get("buyer-2")).toBe(4);
    const coin = (await getCreatorVaultCoin("tok-1"))!;
    expect(coin.custodyChain).toHaveLength(3);
    expect(coin.custodyChain!.at(-1)!.reason).toContain("Buyback");
  });

  it("refuses to release funds the vault does not physically hold", async () => {
    // Legacy vault: buckets may claim deposits, but no custody exists.
    await expect(
      releaseFromCreatorVault({
        tokenId: "tok-legacy", creatorUserId: "user-1", toId: "user-1",
        amount: 1, layer: "creator-earnings", reason: "withdraw",
      }),
    ).rejects.toThrow("no engraved funds");
    expect(transfers).toEqual([]);
  });

  it("ensureCreatorVaultCoin is idempotent and the coin is unspendable", async () => {
    const a = await ensureCreatorVaultCoin("tok-1", "user-1");
    const b = await ensureCreatorVaultCoin("tok-1", "user-1");
    expect(b.coinId).toBe(a.coinId);
    expect(b.custodyChain).toHaveLength(1); // not re-engraved

    const { isSpendable, isVaultLocked } = await import("../coinSpend");
    expect(isVaultLocked(b)).toBe(true);
    expect(isSpendable(b)).toBe(false);
  });
});
