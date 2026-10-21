import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Interface } from "ethers";

const wallet = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }));
vi.mock("../wallets/metaMaskBridge", () => ({ getMetaMaskChainId: wallet.read, requestMetaMask: wallet.request }));
vi.mock("../chain", () => ({ getSwarmChain: vi.fn() }));
vi.mock("../wallets/walletLink", () => ({ _allTransactionsForExternalLedger: () => [], getLinkedWallet: vi.fn() }));
import { importCustomTokenFromMetaMask, listCustomTokens, readTokenDetails, unitsToNumber } from "./customTokens";
import { switchOrAddMintMeNetwork } from "../wallets/mintmeNetwork";

const token = { address: `0x${"ab".repeat(20)}`, symbol: "ABC", decimals: 18 };
const owner = `0x${"cd".repeat(20)}`;
const abi = new Interface(["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"]);

describe("patient MetaMask token import", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); localStorage.clear(); wallet.read.mockResolvedValue("0x609e"); });
  afterEach(() => vi.useRealTimers());

  it("reads a delayed balance on an already-added MintMe network without switching or sending", async () => {
    wallet.read.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("0x609e"), 120_000)));
    wallet.request.mockImplementation(async (method: string, params: { data: string }[]) => {
      if (method !== "eth_call") throw new Error("No approval or transaction expected");
      await new Promise((resolve) => setTimeout(resolve, 240_000));
      const name = abi.parseTransaction({ data: params[0].data })?.name;
      if (name === "symbol") return abi.encodeFunctionResult("symbol", ["ABC"]);
      if (name === "decimals") return abi.encodeFunctionResult("decimals", [18]);
      return abi.encodeFunctionResult("balanceOf", [42n * 10n ** 18n]);
    });
    const flow = (async () => { await switchOrAddMintMeNetwork(); return readTokenDetails(token.address, owner); })();
    await vi.advanceTimersByTimeAsync(480_000);
    const result = await flow;
    expect(result.symbol).toBe("ABC");
    expect(unitsToNumber(result.rawBalance ?? -1n, result.decimals ?? 0)).toBe(42);
    expect(wallet.request.mock.calls.map((c) => c[0])).toEqual(["eth_call", "eth_call", "eth_call"]);
  });

  it("saves a zero-balance token only after a four-minute tracking approval", async () => {
    wallet.request.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(true), 240_000)));
    const flow = importCustomTokenFromMetaMask("u", token);
    await vi.advanceTimersByTimeAsync(239_999);
    expect(listCustomTokens("u")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await flow;
    expect(listCustomTokens("u")[0]?.address).toBe(token.address);
    expect(wallet.request.mock.calls.map((c) => c[0])).toEqual(["wallet_watchAsset"]);
  });

  it("does not save when MetaMask declines tracking", async () => {
    wallet.request.mockResolvedValue(false);
    await expect(importCustomTokenFromMetaMask("u", token)).rejects.toThrow("Nothing was saved");
    expect(listCustomTokens("u")).toEqual([]);
  });

  it("keeps a silent approval pending for five minutes and never saves a late result", async () => {
    let approve: (v: boolean) => void = () => {};
    wallet.request.mockImplementation(() => new Promise<boolean>((resolve) => { approve = resolve; }));
    const flow = importCustomTokenFromMetaMask("u", token);
    const failure = expect(flow).rejects.toThrow("did not confirm");
    await vi.advanceTimersByTimeAsync(299_999);
    expect(listCustomTokens("u")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await failure;
    approve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(listCustomTokens("u")).toEqual([]);
  });
});