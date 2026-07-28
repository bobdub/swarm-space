import { describe, it, expect, vi, beforeEach } from "vitest";

const stores = new Map<string, Map<string, unknown>>();
const s = (n: string) => {
  if (!stores.has(n)) stores.set(n, new Map());
  return stores.get(n)!;
};

vi.mock("@/lib/store", () => ({
  put: async (n: string, v: { peerId?: string; coinId?: string }) => {
    s(n).set((v.peerId ?? v.coinId) as string, v);
  },
  get: async (n: string, k: string) => s(n).get(k),
  getAll: async (n: string) => Array.from(s(n).values()),
  remove: async (n: string, k: string) => { s(n).delete(k); },
  getChunk: async () => null,
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: () => ({ id: "user-1" }),
}));

const txs: Array<Record<string, unknown>> = [];
vi.mock("../chain", () => ({
  getSwarmChain: () => ({
    addTransaction: (tx: Record<string, unknown>) => { txs.push(tx); },
    whenReady: async () => {},
    getPendingTransactions: () => [],
    getChain: () => [],
  }),
}));

import { enrollVaultEntry, getVault, peerVaultAddress, ARCHIVE_VAULT_ADDRESS } from "../syncVault";
import { runWrapSweep } from "../mediaCoinWrapSweep";
import { isSpendable, spendBlockedReason } from "../coinSpend";
import type { SwarmCoin } from "../types";

function minedCoin(id: string): SwarmCoin {
  return {
    coinId: id,
    weight: 0,
    maxWeight: 100,
    wrappedTokens: [],
    ownerId: "user-1",
    status: "wallet",
    minedAt: new Date().toISOString(),
  };
}

async function coins(): Promise<SwarmCoin[]> {
  return Array.from(s("swarmCoins").values()) as SwarmCoin[];
}

beforeEach(() => {
  stores.clear();
  txs.length = 0;
});

describe("Vault Transfer Protocol", () => {
  it("transfers an engraved coin into the peer vault and locks it", async () => {
    await s("swarmCoins").set("mined-1", minedCoin("mined-1"));
    await enrollVaultEntry("peer-alpha", {
      contentHash: "hash-1",
      size: 1024,
      name: "clip.mp4",
      ownerPeerId: "peer-alpha",
    });

    const res = await runWrapSweep();
    expect(res.engraved).toBe(1);

    const coin = (await coins()).find((c) => c.coinId === "mined-1")!;
    expect(coin.ownerId).toBe(peerVaultAddress("peer-alpha"));
    expect(coin.status).toBe("vaulted");
    expect(coin.locked).toBe(true);
    expect(coin.kind).toBe("media");
    expect(coin.custodyChain?.[0]).toMatchObject({ from: "user-1", to: peerVaultAddress("peer-alpha") });

    const transfers = txs.filter((t) => t.type === "coin_transfer");
    expect(transfers).toHaveLength(1);
    expect(transfers[0].meta).toMatchObject({
      reason: "vault_transfer",
      coinId: "mined-1",
      peerId: "peer-alpha",
      contentHash: "hash-1",
    });
    expect(txs.some((t) => t.type === "token_burn")).toBe(false);

    expect(isSpendable(coin)).toBe(false);
    expect(spendBlockedReason(coin)).toBe("vaulted");

    // Coin is no longer a free container: a second file must wait.
    await enrollVaultEntry("peer-alpha", { contentHash: "hash-2", size: 10, ownerPeerId: "peer-alpha" });
    const second = await runWrapSweep();
    expect(second.engraved).toBe(0);
  });

  it("routes unverifiable peer ids to the global archive vault", async () => {
    await s("swarmCoins").set("mined-2", minedCoin("mined-2"));
    await enrollVaultEntry("archive:global", { contentHash: "hash-a", size: 64 });

    const res = await runWrapSweep();
    expect(res.engraved).toBe(1);

    const coin = (await coins()).find((c) => c.coinId === "mined-2")!;
    expect(coin.ownerId).toBe(ARCHIVE_VAULT_ADDRESS);
    expect(coin.status).toBe("vaulted");
  });

  it("does not transfer when engraving is a no-op (duplicate content)", async () => {
    await s("swarmCoins").set("mined-3", minedCoin("mined-3"));
    await enrollVaultEntry("peer-beta", { contentHash: "dup", size: 8, ownerPeerId: "peer-beta" });
    await runWrapSweep();

    // Re-queue the same hash directly into files[] to simulate a stale entry.
    const v = (await getVault("peer-beta"))!;
    v.files.push({ contentHash: "dup", size: 8, ownerPeerId: "peer-beta", receivedAt: new Date().toISOString() });
    s("syncVaults").set("peer-beta", v);

    await s("swarmCoins").set("mined-4", minedCoin("mined-4"));
    txs.length = 0;
    await runWrapSweep();

    const coin = (await coins()).find((c) => c.coinId === "mined-4")!;
    expect(coin.status).toBe("wallet");
    expect(coin.locked).toBeUndefined();
    expect(txs.filter((t) => t.type === "coin_transfer")).toHaveLength(0);
  });
});
