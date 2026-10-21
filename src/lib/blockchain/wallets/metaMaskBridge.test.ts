import { describe, expect, it, vi, beforeEach } from "vitest";
const providers = vi.hoisted(() => ({ external: vi.fn(), sync: vi.fn(), local: vi.fn(), request: vi.fn() }));
vi.mock("./metaMaskSdk", () => ({
  getExternalMetaMaskProvider: providers.external,
  getExternalMetaMaskProviderSync: providers.sync,
  getMetaMaskProvider: providers.local,
  hasInjectedMetaMask: () => true,
  isMobileDevice: () => false,
}));
import { getMetaMaskAccount, getMetaMaskChainId, requestMetaMask } from "./metaMaskBridge";
describe("external MetaMask chain and requests", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    providers.external.mockResolvedValue({ request: providers.request });
    providers.sync.mockReturnValue(null);
    providers.request.mockResolvedValue("0x609e");
  });
  it("awaits the external provider even when synchronous detection is unavailable", async () => {
    expect(await getMetaMaskChainId()).toBe("0x609e");
    expect(providers.request).toHaveBeenCalledWith({ method: "eth_chainId" });
    expect(providers.sync).not.toHaveBeenCalled();
  });
  it("reads authorized accounts from the asynchronous external provider", async () => {
    providers.request.mockResolvedValue(["0x123"]);
    expect(await getMetaMaskAccount()).toBe("0x123");
    expect(providers.sync).not.toHaveBeenCalled();
  });
  it("sends switch requests to the same external provider, never the local gateway", async () => {
    await requestMetaMask("wallet_switchEthereumChain", [{ chainId: "0x609e" }]);
    expect(providers.external).toHaveBeenCalledTimes(1);
    expect(providers.local).not.toHaveBeenCalled();
    expect(providers.request).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x609e" }] });
  });
});