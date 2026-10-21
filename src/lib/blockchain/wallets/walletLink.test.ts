import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Wallet, getBytes, toUtf8String } from "ethers";

const mocks = vi.hoisted(() => ({ account: vi.fn(), request: vi.fn(), add: vi.fn() }));
vi.mock("../chain", () => ({ getSwarmChain: () => ({ addTransaction: mocks.add }) }));
vi.mock("./metaMaskBridge", () => ({ getMetaMaskAccount: mocks.account, requestMetaMask: mocks.request }));
import { buildLinkMessage, linkMetaMaskWallet } from "./walletLink";

describe("MetaMask linking", () => {
  // Deterministic public fixture; never used for funds.
  const wallet = new Wallet(`0x${"11".repeat(32)}`);
  beforeEach(() => { vi.resetAllMocks(); mocks.account.mockResolvedValue(wallet.address); });
  afterEach(() => vi.useRealTimers());
  it("signs UTF-8 hex and records the verified plain-text ownership message", async () => {
    mocks.request.mockImplementation(async (method, [data, address]) => {
      expect(method).toBe("personal_sign");
      expect(address).toBe(wallet.address);
      expect(data).toMatch(/^0x/);
      expect(toUtf8String(data)).toContain("Swarm identity: owner");
      return wallet.signMessage(getBytes(data));
    });
    const link = await linkMetaMaskWallet("owner");
    expect(link.address).toBe(wallet.address.toLowerCase());
    expect(mocks.add).toHaveBeenCalledTimes(1);
  });
  it("waits for a delayed account before prompting a signature", async () => {
    vi.useFakeTimers();
    mocks.account.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(wallet.address), 120_000)));
    mocks.request.mockImplementation(async (_, [data]) => wallet.signMessage(getBytes(data)));
    const result = linkMetaMaskWallet("owner");
    await vi.advanceTimersByTimeAsync(119_999);
    expect(mocks.request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ swarmId: "owner" });
  });
  it("ends a silent signature wait at five minutes without recording a link", async () => {
    vi.useFakeTimers();
    mocks.request.mockReturnValue(new Promise(() => {}));
    const result = expect(linkMetaMaskWallet("owner")).rejects.toThrow("signature request");
    await vi.advanceTimersByTimeAsync(300_000);
    await result;
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("does not record a signature delivered after dismissal", async () => {
    const controller = new AbortController();
    let deliver: ((value: string) => void) | undefined;
    mocks.request.mockImplementation(() => new Promise<string>((resolve) => { deliver = resolve; }));
    const result = expect(linkMetaMaskWallet("owner", controller.signal)).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalled());
    const message = buildLinkMessage("owner", wallet.address, Date.now());
    controller.abort();
    await result;
    deliver?.(await wallet.signMessage(message));
    await Promise.resolve();
    expect(mocks.add).not.toHaveBeenCalled();
  });
});