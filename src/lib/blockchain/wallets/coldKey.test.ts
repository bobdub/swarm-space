import { beforeEach, describe, expect, it, vi } from "vitest";
import { Wallet, keccak256, toUtf8Bytes } from "ethers";

const mocks = vi.hoisted(() => ({
  owner: "mike", key: "test-identity-key" as string | null,
  rows: new Map<string, unknown>(), readKey: vi.fn(),
}));
vi.mock("../../auth", () => ({
  getCurrentUser: () => ({ id: mocks.owner }),
  getCachedPrivateKey: async () => { mocks.readKey(); return mocks.key; },
}));
vi.mock("../../store", () => ({
  get: async (_store: string, key: string) => mocks.rows.get(key),
  put: async (_store: string, row: { k: string }) => { mocks.rows.set(row.k, row); },
}));
import { deriveColdKey, getColdKeyReceivingAddress, rememberColdKeyAddress } from "./coldKey";

beforeEach(() => {
  mocks.owner = "mike"; mocks.key = "test-identity-key";
  mocks.rows.clear(); mocks.readKey.mockClear();
});

describe("public cold-key receiving address", () => {
  it("receives at the original derived address with no signing key after refresh", async () => {
    const expected = new Wallet(keccak256(toUtf8Bytes("swarm-coldkey:test-identity-key"))).address;
    expect(await rememberColdKeyAddress("mike", "test-identity-key")).toBe(expected);
    mocks.key = null;
    expect(await getColdKeyReceivingAddress("mike")).toBe(expected);
    expect(mocks.readKey).not.toHaveBeenCalled();
    expect(mocks.rows.get("cold-key-address:mike")).toEqual({ k: "cold-key-address:mike", v: { userId: "mike", address: expected } });
  });

  it("migrates an older unlocked session without changing its address", async () => {
    const derived = await deriveColdKey("mike");
    mocks.key = null;
    expect(await getColdKeyReceivingAddress("mike")).toBe(derived.address);
  });

  it("rejects another account's receiving and signing requests", async () => {
    await rememberColdKeyAddress("mike", "test-identity-key");
    mocks.owner = "other";
    await expect(getColdKeyReceivingAddress("mike")).rejects.toThrow("active account");
    await expect(deriveColdKey("mike")).rejects.toThrow("active account");
    expect(mocks.readKey).not.toHaveBeenCalled();
  });

  it("still requires real signing authority for withdrawals", async () => {
    await rememberColdKeyAddress("mike", "test-identity-key");
    mocks.key = null;
    await expect(deriveColdKey("mike")).rejects.toThrow("signing vault is locked");
  });
});