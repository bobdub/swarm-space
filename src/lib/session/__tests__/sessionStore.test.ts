import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasIntentionalSignOut: vi.fn(),
  restoreSessionAttempt: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  hasIntentionalSignOut: mocks.hasIntentionalSignOut,
  restoreSessionAttempt: mocks.restoreSessionAttempt,
}));

import {
  ensureSessionRestore,
  getSessionSnapshot,
  __resetSessionStoreForTests,
} from "../sessionStore";

const USER = { id: "u1", username: "mike", publicKey: "pk", wrappedKeyRef: "r", createdAt: "now" };

describe("sessionStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetSessionStoreForTests();
    mocks.getCurrentUser.mockReset().mockReturnValue(null);
    mocks.hasIntentionalSignOut.mockReset().mockReturnValue(false);
    mocks.restoreSessionAttempt.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("signs in from the quick session entry without touching storage", async () => {
    mocks.getCurrentUser.mockReturnValue(USER);
    const snap = await ensureSessionRestore();
    expect(snap.status).toBe("signed-in");
    expect(mocks.restoreSessionAttempt).not.toHaveBeenCalled();
  });

  it("stays 'unknown' when local storage is unavailable (never signed-out)", async () => {
    mocks.restoreSessionAttempt.mockResolvedValue({ status: "unavailable", reason: "blocked" });
    await ensureSessionRestore();
    expect(getSessionSnapshot().status).toBe("unknown");
    expect(getSessionSnapshot().storageUnavailable).toBe(true);
  });

  it("recovers on retry once storage becomes readable", async () => {
    mocks.restoreSessionAttempt
      .mockResolvedValueOnce({ status: "unavailable", reason: "blocked" })
      .mockResolvedValueOnce({ status: "restored", user: USER });

    await ensureSessionRestore();
    expect(getSessionSnapshot().status).toBe("unknown");

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    expect(getSessionSnapshot().status).toBe("signed-in");
    expect(getSessionSnapshot().user?.id).toBe("u1");
  });

  it("does not auto-restore after an intentional sign-out", async () => {
    mocks.hasIntentionalSignOut.mockReturnValue(true);
    const snap = await ensureSessionRestore();
    expect(snap.status).toBe("signed-out");
    expect(mocks.restoreSessionAttempt).not.toHaveBeenCalled();
  });

  it("reports signed-out when no accounts exist", async () => {
    mocks.restoreSessionAttempt.mockResolvedValue({ status: "none" });
    const snap = await ensureSessionRestore();
    expect(snap.status).toBe("signed-out");
  });

  it("preserves a guest created while durable restore is pending", async () => {
    let finish: ((result: { status: string }) => void) | undefined;
    mocks.restoreSessionAttempt.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const restoring = ensureSessionRestore();
    mocks.getCurrentUser.mockReturnValue({ ...USER, _guest: true });
    window.dispatchEvent(new Event('user-login'));
    finish?.({ status: 'none' });
    const restored = await restoring;
    expect(restored.status).toBe('signed-in');
    expect(restored.user?.id).toBe('u1');
  });
});
