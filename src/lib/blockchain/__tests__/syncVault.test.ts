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
  enrollVaultEntry,
  ensureVault,
  recordVaultEntry,
  findVaultEntry,
  engraveFileOntoCoin,
  getVault,
  reconcileLegacyVaultCoins,
  reconcileVaultCoinState,
  saveVault,
} from "../syncVault";
import { enforceVaultSeeding } from "../vaultSeeder";
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

  it("enrolled files sit in files[] until a real mined coin engraves them", async () => {
    await enrollVaultEntry("peer-C", { contentHash: "h42", ref: "h42", name: "n", size: 128 });
    const v = await getVault("peer-C");
    expect(v?.files.map((f) => f.contentHash)).toContain("h42");
    expect(v?.coins).toHaveLength(0);
    await engraveFileOntoCoin("peer-C", { contentHash: "h42", walletCoinId: "wallet-1", size: 128 });
    const after = await getVault("peer-C");
    expect(after?.files.some((f) => f.contentHash === "h42")).toBe(false);
    const found = await findVaultEntry("h42");
    expect(found?.vault.peerId).toBe("peer-C");
    expect(found?.entry.coinId).toBe("wallet-1");
  });

  it("engraver refuses synthetic (fabricated) coin ids", async () => {
    await enrollVaultEntry("peer-fake", { contentHash: "hh", ref: "hh", name: "n", size: 10 });
    const ok = await engraveFileOntoCoin("peer-fake", { contentHash: "hh", walletCoinId: "archive:media:peer-fake:0:abc", size: 10 });
    expect(ok).toBe(false);
  });

  it("reconciles legacy fabricated coins by demoting entries back to files[]", async () => {
    const v = await ensureVault("peer-legacy");
    v.coins.push({
      coinId: "archive:media:peer-legacy:0:abc",
      // biome-ignore lint: legacy role
      role: "receiver" as any,
      fillBytes: 42,
      capacityBytes: 100 * 1024 * 1024,
      createdAt: new Date().toISOString(),
      // biome-ignore lint: legacy sealed hint
      sealed: false as any,
      // biome-ignore lint: legacy wrapped hint
      wrapped: false as any,
    });
    v.index["h-legacy"] = { coinId: "archive:media:peer-legacy:0:abc", offset: 0, length: 42, ref: "h-legacy", storedAt: new Date().toISOString() };
    await saveVault(v);
    const n = await reconcileLegacyVaultCoins();
    expect(n).toBeGreaterThanOrEqual(1);
    const after = await getVault("peer-legacy");
    expect(after?.coins).toHaveLength(0);
    expect(after?.index["h-legacy"]).toBeUndefined();
    expect(after?.files.some((f) => f.contentHash === "h-legacy" && f.size === 42)).toBe(true);
  });

  it("real mined coin refs are normalized to sealed media on reconcile", async () => {
    const v = await ensureVault("peer-real");
    const now = new Date().toISOString();
    v.coins.push({
      coinId: "wallet-real-1",
      // biome-ignore lint: legacy role/flags absent
      role: "media" as any,
      fillBytes: 1024,
      capacityBytes: 100 * 1024 * 1024,
      createdAt: now,
      // biome-ignore lint: not yet sealed
      sealed: false as any,
      // biome-ignore lint: not yet wrapped
      wrapped: false as any,
    });
    await saveVault(v);
    const n = await reconcileVaultCoinState();
    expect(n).toBeGreaterThanOrEqual(1);
    const after = await getVault("peer-real");
    const coin = after?.coins.find((c) => c.coinId === "wallet-real-1");
    expect(coin?.sealed).toBe(true);
    expect(coin?.wrapped).toBe(true);
    expect(coin?.capacityBytes).toBe(MEDIA_COIN_CAPACITY_BYTES);
  });

  it("atomic enrollment queues concurrent files without fabricating coins", async () => {
    const chunk = 10 * 1024 * 1024;
    await Promise.all(Array.from({ length: 12 }, (_, i) => enrollVaultEntry("peer-concurrent", {
      contentHash: `concurrent-${i}`,
      name: `file-${i}`,
      ref: `concurrent-${i}`,
      size: chunk,
      completedAt: new Date().toISOString(),
    })));

    const vault = await getVault("peer-concurrent");
    expect(vault?.coins).toHaveLength(0);
    expect(vault?.files).toHaveLength(12);
    expect(Object.keys(vault?.index ?? {})).toHaveLength(0);
  });

  it("keeps wrapped entries resolved when pending updates run", async () => {
    const now = new Date().toISOString();
    const v = await ensureVault("peer-wrapped");
    v.coins.push({
      coinId: "wallet-media-1",
      role: "media",
      fillBytes: 2048,
      capacityBytes: MEDIA_COIN_CAPACITY_BYTES,
      createdAt: now,
      sealed: true,
      wrapped: true,
    });
    v.index["wrapped-hash"] = {
      coinId: "wallet-media-1",
      offset: 0,
      length: 2048,
      ref: "wrapped-hash",
      storedAt: now,
      completedAt: now,
      pending: false,
    };
    await saveVault(v);
    await enforceVaultSeeding();
    const after = await getVault("peer-wrapped");
    expect(after?.index["wrapped-hash"].pending).toBe(false);
  });
});

// keep sealedCoin helper referenced to avoid unused warning
void sealedCoin;
// silence unused param variables
void recordVaultEntry;