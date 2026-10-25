import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/store", () => ({
  put: vi.fn(async () => undefined),
  get: vi.fn(async () => ({ k: "meta:wrappedKey:u1", v: { wrapped: "secret-private-key", salt: null, iv: null, rawStored: true } })),
  getAll: vi.fn(async () => []),
}));
vi.mock("@/lib/credits", () => ({ awardGenesisCredits: vi.fn(async () => undefined) }));
vi.mock("@/config/featureFlags", () => ({ setFeatureFlag: vi.fn() }));
vi.mock("@/lib/p2p/connectionState", () => ({ updateConnectionState: vi.fn(), loadConnectionState: vi.fn(() => ({ mode: "swarm" })) }));

const USER = { id: "u1", username: "mike", publicKey: "pk", wrappedKeyRef: "meta:wrappedKey:u1", createdAt: "now" };
const OTHER = { ...USER, id: "u2", username: "other" };

async function freshAuth() {
  vi.resetModules();
  return await import("@/lib/auth");
}

describe("tab-session vault persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("me", JSON.stringify(USER));
  });

  it("restores the unlocked key after a page refresh (new module instance)", async () => {
    let auth = await freshAuth();
    await auth.loginUser();
    expect(await auth.getCachedPrivateKey()).toBe("secret-private-key");

    // Simulate a refresh: module state is gone, sessionStorage survives.
    auth = await freshAuth();
    expect(await auth.getCachedPrivateKey()).toBe("secret-private-key");
  });

  it("never restores a key for a different account than the active session", async () => {
    let auth = await freshAuth();
    await auth.loginUser();
    expect(await auth.getCachedPrivateKey()).toBe("secret-private-key");

    localStorage.setItem("me", JSON.stringify(OTHER));
    auth = await freshAuth();
    expect(await auth.getCachedPrivateKey()).toBeNull();
  });

  it("never returns the in-memory key after switching accounts without refreshing", async () => {
    const auth = await freshAuth();
    await auth.loginUser();
    localStorage.setItem("me", JSON.stringify(OTHER));
    expect(await auth.getCachedPrivateKey()).toBeNull();
  });

  it("does not invent signing authority for an older session without a seal", async () => {
    const auth = await freshAuth();
    expect(await auth.getCachedPrivateKey()).toBeNull();
  });

  it("clears the session seal on intentional sign-out", async () => {
    let auth = await freshAuth();
    await auth.loginUser();
    auth.logoutUser();

    localStorage.setItem("me", JSON.stringify(USER));
    auth = await freshAuth();
    expect(await auth.getCachedPrivateKey()).toBeNull();
  });
});
