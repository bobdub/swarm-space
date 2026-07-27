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
  recordVaultEntry,
  findVaultEntry,
  getOrCreateMediaCoin,
  forceSealCompletedMediaCoin,
  getVault,
  reconcileLegacyVaultCoins,
  saveVault,
} from "../syncVault";
import { MEDIA_COIN_CAPACITY_BYTES, type SwarmCoin } from "../types";

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
  it("ensures a vault", async () => {
    const v = await ensureVault("peer-A");
    expect(v.peerId).toBe("peer-A");
  });

  it("indexes entries and looks them up across vaults", async () => {
    const ref = await getOrCreateMediaCoin("peer-C", 128);
    await recordVaultEntry("peer-C", "h42", { coinId: ref.coinId, offset: 0, length: 128, ref: "h42" });
    const found = await findVaultEntry("h42");
    expect(found?.vault.peerId).toBe("peer-C");
    expect(found?.entry.length).toBe(128);
  });

  it("force-seals a completed oversized media coin without adding seal bytes", async () => {
    const size = MEDIA_COIN_CAPACITY_BYTES * 2;
    const ref = await getOrCreateMediaCoin("peer-large", size);
    expect(ref.capacityBytes).toBe(size);
    await recordVaultEntry("peer-large", "big-file", {
      coinId: ref.coinId,
      offset: 0,
      length: size,
      ref: "big-file",
      completedAt: new Date().toISOString(),
    });
    const sealed = await forceSealCompletedMediaCoin("peer-large", ref.coinId, "oversized-complete");
    expect(sealed).toBe(true);
    const vault = await getVault("peer-large");
    const coin = vault?.coins.find((c) => c.coinId === ref.coinId);
    expect(coin?.sealed).toBe(true);
    expect(coin?.phase).toBe("sealed");
    expect(coin?.sealReason).toBe("oversized-complete");
    expect(coin?.fillBytes).toBe(size);
  });

  it("reconciles legacy receiver/archive coin roles into sealed media", async () => {
    const v = await ensureVault("peer-legacy");
    v.coins.push({
      coinId: "legacy-1",
      // biome-ignore lint: legacy role
      role: "receiver" as any,
      fillBytes: 42,
      capacityBytes: 100 * 1024 * 1024,
      createdAt: new Date().toISOString(),
    });
    v.index["h-legacy"] = { coinId: "legacy-1", offset: 0, length: 42, ref: "h-legacy", storedAt: new Date().toISOString() };
    await saveVault(v);
    const n = await reconcileLegacyVaultCoins();
    expect(n).toBeGreaterThanOrEqual(1);
    const after = await getVault("peer-legacy");
    const c = after?.coins.find((c) => c.coinId === "legacy-1");
    expect(c?.role).toBe("media");
    expect(c?.sealed).toBe(true);
  });
});

// keep sealedCoin helper referenced to avoid unused warning
void sealedCoin;