import { describe, it, expect, vi, beforeEach } from "vitest";

const db = new Map<string, unknown>();
const keyOf = (store: string, row: Record<string, unknown>) => `${store}:${String(row.k ?? row.id)}`;
vi.mock("@/lib/store", () => ({
  put: vi.fn(async (store: string, row: Record<string, unknown>) => { db.set(keyOf(store, row), row); }),
  get: vi.fn(async (store: string, k: string) => db.get(`${store}:${k}`)),
  getAll: vi.fn(async () => []),
  remove: vi.fn(async (store: string, k: string) => { db.delete(`${store}:${k}`); }),
}));
vi.mock("@/lib/credits", () => ({ awardGenesisCredits: vi.fn(async () => undefined) }));
vi.mock("@/config/featureFlags", () => ({ setFeatureFlag: vi.fn() }));
vi.mock("@/lib/p2p/connectionState", () => ({ updateConnectionState: vi.fn(), loadConnectionState: vi.fn(() => ({ mode: "swarm" })) }));
vi.mock("@/lib/blockchain/wallets/coldKey", () => ({ rememberColdKeyAddress: vi.fn(async () => "0x") }));

import { genIdentityKeyPair, computeUserId, unwrapPrivateKey } from "@/lib/crypto";
import { sealRecoveryVault, openRecoveryVault } from "../recoveryVault";

beforeEach(() => { db.clear(); localStorage.clear(); sessionStorage.clear(); });

describe("restoreAccountFromVault", () => {
  it("rehydrates the identity under a new local password and signs in", async () => {
    const keys = await genIdentityKeyPair();
    const id = await computeUserId(keys.publicKey);
    const user = { id, username: "mike", displayName: "Mike", publicKey: keys.publicKey, createdAt: "2026-01-01T00:00:00.000Z" };
    const env = await sealRecoveryVault({ privateKey: keys.privateKey, user, version: 2, passphrase: "outer shell phrase" });

    const auth = await import("@/lib/auth");
    const payload = await openRecoveryVault(env, "outer shell phrase");
    const restored = await auth.restoreAccountFromVault(payload, "new-device-pass");

    expect(restored.id).toBe(id);
    expect(auth.getCurrentUser()?.username).toBe("mike");
    const wrapped = db.get(`meta:meta:wrappedKey:${id}`) as { v: { wrapped: string; salt: string; iv: string } };
    expect(await unwrapPrivateKey(wrapped.v, "new-device-pass")).toBe(keys.privateKey);
    await expect(unwrapPrivateKey(wrapped.v, "outer shell phrase")).rejects.toBeTruthy();
    expect(await auth.getCachedPrivateKey()).toBe(keys.privateKey);
  });

  it("refuses a payload whose public key does not hash to its id", async () => {
    const keys = await genIdentityKeyPair();
    const auth = await import("@/lib/auth");
    await expect(auth.restoreAccountFromVault({
      userId: "0000000000000000", privateKey: keys.privateKey,
      user: { id: "0000000000000000", username: "x", publicKey: keys.publicKey, createdAt: "now" },
    }, "password123")).rejects.toThrow();
  });
});
