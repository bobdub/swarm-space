import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeUserId, genIdentityKeyPair } from "@/lib/crypto";
import { signerFromKeys } from "../blockHeader";
import { memoryCellChainStorage } from "../cellChain/cellChain";
import { CellChains } from "../cellChain/cellChains";
import { rosterSignerFromKeys, type TextSigner } from "../cellChain/roster";
import type { DeployedCoin } from "../types";

const db = new Map<string, Map<string, unknown>>();
vi.mock("../../store", () => ({
  get: async (store: string, id: string) => db.get(store)?.get(id) ?? undefined,
  put: async (store: string, value: { id: string }) => {
    if (!db.has(store)) db.set(store, new Map());
    db.get(store)!.set(value.id, value);
  },
  getAll: async (store: string) => [...(db.get(store)?.values() ?? [])],
}));

import { acceptChainOffer, listChainOffers, receiveCoinShare, signCoinShare, verifyCoinShare } from "../coinChainShare";
import { coinChainCellId, ensureOwnedCoinChain } from "../coinChainMining";

async function newAccount() {
  const keys = await genIdentityKeyPair();
  const userId = await computeUserId(keys.publicKey);
  return { userId, keys, text: rosterSignerFromKeys(userId, keys.publicKey, keys.privateKey) as TextSigner };
}

function coinFor(userId: string, over: Partial<DeployedCoin> = {}): DeployedCoin {
  return {
    coinId: "coin-abc", deployerUserId: userId, chainName: "ArtVerse", ticker: "ART",
    projectGoal: "Powering a shared art studio", totalSupply: 0, maxSupply: 21_000_000,
    deployedAt: "2026-11-01T00:00:00.000Z", deploymentTxId: "tx-1", status: "active",
    bridgeAddress: "swarm-bridge://coin-abc", lockedLiquidity: 5000, ...over,
  };
}

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

beforeEach(() => {
  db.clear();
  localStorage.clear();
});

describe("Share my Chain", () => {
  it("accepts a share signed by the coin's deployer", async () => {
    const alice = await newAccount();
    const msg = await signCoinShare(coinFor(alice.userId), "Alice", alice.text);
    expect(await verifyCoinShare(msg)).not.toBeNull();
  });

  it("refuses tampered cards, other signers and future dates", async () => {
    const alice = await newAccount();
    const mallory = await newAccount();
    const msg = await signCoinShare(coinFor(alice.userId), "Alice", alice.text);
    expect(await verifyCoinShare({ ...msg, coin: { ...msg.coin, ticker: "FAKE" } })).toBeNull();
    // Mallory signs a card naming Alice as deployer: the key doesn't name Alice.
    const forged = await signCoinShare(coinFor(mallory.userId), "Alice", mallory.text);
    expect(await verifyCoinShare({ ...forged, coin: { ...forged.coin, deployerUserId: alice.userId } })).toBeNull();
    const future = await signCoinShare(coinFor(alice.userId), "Alice", alice.text, Date.now() + 60 * 60 * 1000);
    expect(await verifyCoinShare(future)).toBeNull();
    await expect(signCoinShare(coinFor(alice.userId), "Mallory", mallory.text)).rejects.toThrow();
  });

  it("keeps one offer per coin and adds it to the wallet on accept", async () => {
    const alice = await newAccount();
    const bob = await newAccount();
    const msg = await signCoinShare(coinFor(alice.userId), "Alice", alice.text);
    expect(await receiveCoinShare(bob.userId, msg)).not.toBeNull();
    expect(await receiveCoinShare(bob.userId, msg)).toBeNull();
    expect(await receiveCoinShare(alice.userId, msg)).toBeNull();
    expect(listChainOffers(bob.userId)).toHaveLength(1);

    const coin = await acceptChainOffer(bob.userId, "coin-abc");
    expect(coin?.ticker).toBe("ART");
    expect(db.get("deployedCoins")?.get("coin-abc")).toMatchObject({ deployerUserId: alice.userId, status: "active" });
    expect(listChainOffers(bob.userId)).toHaveLength(0);
    // Already in the wallet: a second share doesn't come back as an offer.
    expect(await receiveCoinShare(bob.userId, msg)).toBeNull();
  });
});

describe("one chain per account", () => {
  it("refuses a second deployment", async () => {
    vi.doMock("../mineHealthValidator", () => ({ validateMineHealth: async () => ({ healthy: true }) }));
    const { deployCoin } = await import("../coinDeployment");
    await db.set("deployedCoins", new Map([["coin-abc", { ...coinFor("u1"), id: "coin-abc" }]]));
    await expect(deployCoin({ userId: "u1", chainName: "Second", ticker: "TWO", projectGoal: "Another chain please" }))
      .rejects.toThrow(/already have a chain/);
  });
});

describe("Start Mining my coin", () => {
  it("signs a genesis with the coin's ticker that only the deployer can mine", async () => {
    const alice = await newAccount();
    const bob = await newAccount();
    const T0 = Date.parse("2026-12-01T00:00:00Z");
    const chains = new CellChains(memoryStore(), { storage: memoryCellChainStorage(), difficulty: 1, now: () => T0 + 60_000 });
    const coin = coinFor(alice.userId);

    expect(await ensureOwnedCoinChain(coin, chains, bob.text)).toBeNull();
    const chain = (await ensureOwnedCoinChain(coin, chains, alice.text))!;
    expect(chain).not.toBeNull();
    expect(chain.cellId).toBe(coinChainCellId(coin.coinId));
    expect(chain.ticker).toBe("ART");
    expect(chain.getRoster().owner).toBe(alice.userId);

    expect(await chain.mine(signerFromKeys(bob.userId, bob.keys.publicKey, bob.keys.privateKey))).toBeNull();
    const block = await chain.mine(signerFromKeys(alice.userId, alice.keys.publicKey, alice.keys.privateKey));
    expect(block).not.toBeNull();
    expect(chain.getTotalSupply()).toBeGreaterThan(0);
  });
});
