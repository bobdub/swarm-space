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
  getOrCreateMediaCoin,
  forceSealCompletedMediaCoin,
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
    expect(c?.capacityBytes).toBe(MEDIA_COIN_CAPACITY_BYTES);
  });

  it("repairs duplicate active coins while preserving completed coins", async () => {
    const v = await ensureVault("peer-duplicates");
    const now = new Date().toISOString();
    v.coins.push(
      { coinId: "old-active", role: "media", fillBytes: 1024, capacityBytes: 100 * 1024 * 1024, createdAt: now },
      { coinId: "new-active", role: "media", fillBytes: 0, capacityBytes: MEDIA_COIN_CAPACITY_BYTES, createdAt: new Date(Date.now() + 1).toISOString() },
      { coinId: "done", role: "media", fillBytes: MEDIA_COIN_CAPACITY_BYTES, capacityBytes: MEDIA_COIN_CAPACITY_BYTES, createdAt: now, sealed: true },
    );
    v.index["old-hash"] = { coinId: "old-active", offset: 0, length: 1024, ref: "old-hash", storedAt: now, completedAt: now };
    v.index["done-hash"] = { coinId: "done", offset: 0, length: 2048, ref: "done-hash", storedAt: now, completedAt: now };
    await saveVault(v);

    const n = await reconcileVaultCoinState();
    expect(n).toBeGreaterThanOrEqual(1);
    const after = await getVault("peer-duplicates");
    const active = after?.coins.filter((c) => c.role === "media" && !c.sealed) ?? [];
    expect(active).toHaveLength(1);
    expect(active[0].coinId).toBe("old-active");
    const old = after?.coins.find((c) => c.coinId === "old-active");
    expect(old?.sealed).toBeFalsy();
    expect(old?.capacityBytes).toBe(MEDIA_COIN_CAPACITY_BYTES);
    expect(after?.coins.some((c) => c.coinId === "new-active")).toBe(false);
    expect(after?.coins.find((c) => c.coinId === "done")?.sealed).toBe(true);
  });

  it("atomic enrollment leaves one active filling coin under concurrent writes", async () => {
    const chunk = 10 * 1024 * 1024;
    await Promise.all(Array.from({ length: 12 }, (_, i) => enrollVaultEntry("peer-concurrent", {
      contentHash: `concurrent-${i}`,
      name: `file-${i}`,
      ref: `concurrent-${i}`,
      size: chunk,
      completedAt: new Date().toISOString(),
    })));

    const vault = await getVault("peer-concurrent");
    const active = vault?.coins.filter((c) => c.role === "media" && !c.sealed) ?? [];
    expect(active).toHaveLength(1);
    expect(active[0].capacityBytes).toBe(MEDIA_COIN_CAPACITY_BYTES);
    expect(Object.keys(vault?.index ?? {})).toHaveLength(12);
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