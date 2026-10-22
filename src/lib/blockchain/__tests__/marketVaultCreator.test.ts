import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  supply: 100, closed: false, balances: new Map<string, number>(), txs: new Set<string>(),
  release: vi.fn(), transfer: vi.fn(), key: "test-only" as string | null, userId: "mike", sign: vi.fn(),
}));
vi.mock("../creatorVault", () => ({
  getCreatorVault: async () => ({ circulatingSupply: f.supply, closed: f.closed }),
  priceAtSupply: (supply: number) => 0.1 + 0.001 * supply,
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => ({ id: f.userId, publicKey: "public" }), getCachedPrivateKey: async () => f.key }));
vi.mock("../wallets/tipSignature", () => ({ signWalletTip: (...args: unknown[]) => f.sign(...args) }));
vi.mock("../profileTokenBalance", () => ({
  getProfileTokenHolding: async (id: string) => ({ amount: f.balances.get(id) ?? 0, ticker: "MIKE" }),
  transferProfileTokens: (...args: unknown[]) => f.transfer(...args),
}));
vi.mock("../creditWrapping", () => ({ getMinedPoolBalance: async () => 1000, releaseMinedPoolSwarm: (...args: unknown[]) => f.release(...args) }));
vi.mock("../chain", () => ({ getSwarmChain: () => ({
  whenReady: async () => {}, getTotalSupply: () => 1000,
  hasTransaction: (id: string) => f.txs.has(id), addTransaction: (tx: { id: string }) => f.txs.add(tx.id),
}) }));
import { swapCreatorTokenForSwarm } from "../marketVault";

beforeEach(() => {
  f.key = "test-only"; f.userId = "mike";
  f.sign.mockReset().mockImplementation(async (tx: object) => ({ ...tx, signature: "signed-test" }));
  f.supply = 100; f.closed = false; f.balances.clear(); f.txs.clear();
  f.balances.set("mike", 10); f.balances.set("community-pool", 0);
  f.transfer.mockReset().mockImplementation(async (from: string, to: string, _token: string, amount: number) => {
    if ((f.balances.get(from) ?? 0) < amount) throw new Error("Insufficient tokens");
    f.balances.set(from, (f.balances.get(from) ?? 0) - amount);
    f.balances.set(to, (f.balances.get(to) ?? 0) + amount);
  });
  f.release.mockReset().mockImplementation(async (p: { transactionId: string }) => { f.txs.add(p.transactionId); });
});

describe("creator-token Market Vault payment", () => {
  it("signs with the already-unlocked vault without requesting another passphrase", async () => {
    await swapCreatorTokenForSwarm("mike", "token", 5, 0.2);
    expect(f.sign).toHaveBeenCalledWith(expect.objectContaining({ from: "mike", amount: 5 }), "test-only");
    expect(f.balances.get("mike")).toBe(5);
  });
  it("never spends with a restored session but no unlocked signing key", async () => {
    f.key = null;
    await expect(swapCreatorTokenForSwarm("mike", "token", 5, 0.2)).rejects.toThrow("signing vault is locked");
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.transfer).not.toHaveBeenCalled();
    expect(f.release).not.toHaveBeenCalled();
  });
  it("rejects a different signed-in identity before accessing holdings", async () => {
    f.userId = "other";
    await expect(swapCreatorTokenForSwarm("mike", "token", 5, 0.2)).rejects.toThrow("Sign in");
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.transfer).not.toHaveBeenCalled();
  });
  it("moves held tokens into the pool and releases SWARM at the profile live rate", async () => {
    expect(await swapCreatorTokenForSwarm("mike", "token", 10, 0.2)).toEqual({ out: 2, error: null });
    expect(f.balances.get("mike")).toBe(0);
    expect(f.balances.get("community-pool")).toBe(10);
    expect(f.supply).toBe(100);
    expect(f.release).toHaveBeenCalledWith(expect.objectContaining({ amount: 2, to: "mike", creditsLocked: 0 }));
  });
  it("requires a new quote if the profile rate changes", async () => {
    f.supply = 200;
    await expect(swapCreatorTokenForSwarm("mike", "token", 10, 0.2)).rejects.toThrow("rate changed");
    expect(f.transfer).not.toHaveBeenCalled();
  });
  it("returns token ownership if no SWARM payout was accepted", async () => {
    f.release.mockRejectedValue(new Error("Pool unavailable"));
    await expect(swapCreatorTokenForSwarm("mike", "token", 10, 0.2)).rejects.toThrow("Pool unavailable");
    expect(f.balances.get("mike")).toBe(10);
    expect(f.balances.get("community-pool")).toBe(0);
  });
  it("does not refund tokens after a SWARM payout entered the ledger", async () => {
    f.release.mockImplementation(async (p: { transactionId: string }) => { f.txs.add(p.transactionId); throw new Error("Pool record write failed"); });
    await swapCreatorTokenForSwarm("mike", "token", 10, 0.2);
    expect(f.balances.get("mike")).toBe(0);
    expect(f.balances.get("community-pool")).toBe(10);
  });
  it("rejects unavailable or closed creator markets without spending", async () => {
    f.closed = true;
    await expect(swapCreatorTokenForSwarm("mike", "token", 10, 0.2)).rejects.toThrow("unavailable");
    expect(f.transfer).not.toHaveBeenCalled();
  });
  it("rejects more than the Native holding", async () => {
    await expect(swapCreatorTokenForSwarm("mike", "token", 11, 0.2)).rejects.toThrow("Native balance");
    expect(f.transfer).not.toHaveBeenCalled();
  });
});