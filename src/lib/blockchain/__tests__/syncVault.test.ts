import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/store", () => {
  const stores = new Map<string, Map<string, unknown>>();
  const s = (n: string) => {
    if (!stores.has(n)) stores.set(n, new Map());
    return stores.get(n)!;
  };
  return {
    put: async (n: string, v: { peerId?: string; coinId?: string }) => {
      s(n).set((v.peerId ?? v.coinId) as string, v);
    },
    get: async (n: string, k: string) => s(n).get(k),
    getAll: async (n: string) => Array.from(s(n).values()),
    remove: async (n: string, k: string) => { s(n).delete(k); },
    getChunk: async () => null,
  };
});

import {
  ensureVault,
  allocateVaultCoin,
  getOrRolloverReceiverCoin,
  recordVaultEntry,
  findVaultEntry,
  VAULT_COIN_CAPACITY_BYTES,
  VAULT_ROLLOVER_FRACTION,
} from "../syncVault";
import type { SwarmCoin } from "../types";

function sealedCoin(id: string): SwarmCoin {
  return {
    coinId: id,
    weight: 0,
    maxWeight: 100,
    wrappedTokens: [],
    ownerId: "me",
    status: "wallet",
    minedAt: new Date().toISOString(),
    fillState: "sealed",
    fill: 1,
  };
}

describe("syncVault", () => {
  it("ensures a vault and allocates a sealed coin as container", async () => {
    const v = await ensureVault("peer-A");
    expect(v.peerId).toBe("peer-A");
    const ref = await allocateVaultCoin("peer-A", "receiver", [sealedCoin("c1")]);
    expect(ref?.coinId).toBe("c1");
    expect(ref?.role).toBe("receiver");
  });

  it("rolls over to a fresh coin past 80% fill", async () => {
    const coins = [sealedCoin("c-x"), sealedCoin("c-y")];
    const first = await getOrRolloverReceiverCoin("peer-B", coins);
    expect(first?.coinId).toBe("c-x");
    const big = Math.floor(VAULT_COIN_CAPACITY_BYTES * (VAULT_ROLLOVER_FRACTION + 0.05));
    await recordVaultEntry("peer-B", "h1", { coinId: "c-x", offset: 0, length: big, ref: "h1" });
    const next = await getOrRolloverReceiverCoin("peer-B", coins);
    expect(next?.coinId).toBe("c-y");
  });

  it("indexes entries and looks them up across vaults", async () => {
    const coins = [sealedCoin("c-z")];
    await getOrRolloverReceiverCoin("peer-C", coins);
    await recordVaultEntry("peer-C", "h42", { coinId: "c-z", offset: 0, length: 128, ref: "h42" });
    const found = await findVaultEntry("h42");
    expect(found?.vault.peerId).toBe("peer-C");
    expect(found?.entry.length).toBe(128);
  });
});