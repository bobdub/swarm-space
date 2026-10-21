import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }));
vi.mock("./metaMaskBridge", () => ({ getMetaMaskChainId: wallet.read, requestMetaMask: wallet.request }));
import { addMintMeToMetaMask, switchOrAddMintMeNetwork, isMintMeChain, MINTME_CHAIN_ID_HEX, MINTME_NETWORK, MintMeNetworkMissingError, switchToMintMeNetwork } from "./mintmeNetwork";

describe("verified MintMe network decisions", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); });
  afterEach(() => vi.useRealTimers());

  it("asks MetaMask to add the correct missing network in the same action and verifies arrival", async () => {
    let chain = "0x1";
    let added = false;
    wallet.read.mockImplementation(async () => chain);
    wallet.request.mockImplementation(async (method: string) => {
      if (method === "wallet_addEthereumChain") { added = true; return null; }
      if (!added) throw { code: 4902 };
      chain = "0x609e";
      return null;
    });
    const flow = switchOrAddMintMeNetwork();
    await vi.advanceTimersByTimeAsync(6_000);
    await flow;
    expect(wallet.request.mock.calls).toEqual([
      ["wallet_switchEthereumChain", [{ chainId: "0x609e" }]],
      ["wallet_addEthereumChain", [MINTME_NETWORK]],
      ["wallet_switchEthereumChain", [{ chainId: "0x609e" }]],
    ]);
    expect(chain).toBe("0x609e");
  });

  it("the combined action never adds when already on MintMe", async () => {
    wallet.read.mockResolvedValue("0x609e");
    await switchOrAddMintMeNetwork();
    expect(wallet.request).not.toHaveBeenCalled();
  });

  it("waits for a slow MetaMask response and proceeds without switching or adding", async () => {
    wallet.read.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("0x609e"), 12_000)));
    let ready = false;
    const flow = switchOrAddMintMeNetwork().then(() => { ready = true; });
    await vi.advanceTimersByTimeAsync(1_001);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(10_999);
    await flow;
    expect(ready).toBe(true);
    expect(wallet.read).toHaveBeenCalledTimes(1);
    expect(wallet.request).not.toHaveBeenCalled();
  });

  it("stops after 15 seconds of silence without requesting a switch or addition", async () => {
    wallet.read.mockReturnValue(new Promise(() => {}));
    let settled = false;
    const flow = switchOrAddMintMeNetwork().finally(() => { settled = true; });
    const result = expect(flow).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(settled).toBe(true);
    expect(wallet.request).not.toHaveBeenCalled();
  });

  it("the combined action never adds after a rejected switch", async () => {
    wallet.read.mockResolvedValue("0x1");
    wallet.request.mockRejectedValue({ code: 4001 });
    const result = expect(switchOrAddMintMeNetwork()).rejects.toEqual({ code: 4001 });
    await vi.advanceTimersByTimeAsync(6_000);
    await result;
    expect(wallet.request.mock.calls.map((call) => call[0])).toEqual(["wallet_switchEthereumChain"]);
  });

  it("uses chain 24734, hexadecimal 0x609e, not 24750", () => {
    expect(MINTME_CHAIN_ID_HEX).toBe("0x609e");
    expect(Number(MINTME_NETWORK.chainId)).toBe(24734);
    expect(isMintMeChain("0x60ae")).toBe(false);
  });
  it("recognizes decimal and hexadecimal MintMe responses without partial parsing", () => {
    for (const id of [24734, "24734", "0x609e", "0X609E", "0x0609e"]) expect(isMintMeChain(id)).toBe(true);
    for (const id of [null, "24734wrong", "0x609eZZ", "", 24750]) expect(isMintMeChain(id)).toBe(false);
  });
  it("does not switch or add when already on MintMe", async () => {
    wallet.read.mockResolvedValue("0x609e");
    await switchToMintMeNetwork();
    expect(wallet.request).not.toHaveBeenCalled();
  });
  it("waits for chain confirmation after a switch acknowledgement", async () => {
    wallet.read.mockResolvedValueOnce("0x1").mockResolvedValueOnce("0x1").mockResolvedValue("0x609e");
    wallet.request.mockResolvedValue(null);
    let arrived = false;
    const flow = switchToMintMeNetwork().then(() => { arrived = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(arrived).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    await flow;
    expect(arrived).toBe(true);
    expect(wallet.request.mock.calls).toEqual([["wallet_switchEthereumChain", [{ chainId: "0x609e" }]]]);
  });
  it("does not suggest adding if a switch error arrives after the actual switch", async () => {
    wallet.read.mockResolvedValueOnce("0x1").mockResolvedValue("0x609e");
    wallet.request.mockRejectedValue({ code: 4902 });
    await switchToMintMeNetwork();
    expect(wallet.request).toHaveBeenCalledTimes(1);
  });
  it("suggests adding only for 4902 while still on another network; never adds automatically", async () => {
    wallet.read.mockResolvedValue("0x1");
    wallet.request.mockRejectedValue({ code: 4902 });
    const result = expect(switchToMintMeNetwork()).rejects.toBeInstanceOf(MintMeNetworkMissingError);
    await vi.advanceTimersByTimeAsync(6_000);
    await result;
    expect(wallet.request).toHaveBeenCalledTimes(1);
  });
  it("does not treat rejection as a missing network", async () => {
    wallet.read.mockResolvedValue("0x1");
    const rejected = { code: 4001 };
    wallet.request.mockRejectedValue(rejected);
    const result = expect(switchToMintMeNetwork()).rejects.toBe(rejected);
    await vi.advanceTimersByTimeAsync(6_000);
    await result;
    expect(wallet.request).toHaveBeenCalledTimes(1);
  });
  it("does not assume a successful request changed the chain", async () => {
    wallet.read.mockResolvedValue("0x1");
    wallet.request.mockResolvedValue(null);
    const result = expect(switchToMintMeNetwork()).rejects.toThrow("has not switched");
    await vi.advanceTimersByTimeAsync(6_000);
    await result;
    expect(wallet.request).toHaveBeenCalledTimes(1);
  });
  it("fails closed without network requests when the initial chain is unreadable", async () => {
    wallet.read.mockResolvedValue(null);
    await expect(switchToMintMeNetwork()).rejects.toThrow("Could not read");
    expect(wallet.request).not.toHaveBeenCalled();
  });
  it("bounds a silent wallet without suggesting a network addition", async () => {
    wallet.read.mockResolvedValue("0x1");
    wallet.request.mockReturnValue(new Promise(() => {}));
    const result = expect(switchToMintMeNetwork()).rejects.toThrow("did not answer the switch request");
    await vi.advanceTimersByTimeAsync(66_000);
    await result;
    expect(wallet.request).toHaveBeenCalledTimes(1);
  });
  it("explicit addition is followed by a switch and a confirmed network read", async () => {
    let chain = "0x1";
    wallet.read.mockImplementation(async () => chain);
    wallet.request.mockImplementation(async (method: string) => {
      if (method === "wallet_switchEthereumChain") chain = "0x609e";
      return null;
    });
    await addMintMeToMetaMask();
    expect(wallet.request.mock.calls.map((c) => c[0])).toEqual(["wallet_addEthereumChain", "wallet_switchEthereumChain"]);
    expect(wallet.read).toHaveBeenCalledTimes(3);
  });
  it("explicit add is a no-op if the user switched in MetaMask meanwhile", async () => {
    wallet.read.mockResolvedValue("24734");
    await addMintMeToMetaMask();
    expect(wallet.request).not.toHaveBeenCalled();
  });
});