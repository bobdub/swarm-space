import { beforeEach, describe, expect, it, vi } from "vitest";
import { Interface } from "ethers";
import type { SwarmTransaction } from "../types";

const mocks = vi.hoisted(() => ({
  transactions: [] as SwarmTransaction[], request: vi.fn(), add: vi.fn(),
  account: "" as string, link: null as { address: string } | null, connect: vi.fn(),
}));
vi.mock("../chain", () => ({ getSwarmChain: () => ({ whenReady: async () => {}, addTransaction: mocks.add }) }));
vi.mock("../wallets/walletLink", () => ({
  getLinkedWallet: () => mocks.link,
  _allTransactionsForExternalLedger: () => mocks.transactions,
}));
vi.mock("../wallets/metaMaskBridge", () => ({
  getMetaMaskAccount: async () => mocks.account || null,
  connectMetaMask: mocks.connect,
  requestMetaMask: mocks.request,
}));
vi.mock("../wallets/mintmeNetwork", () => ({
  MINTME_CHAIN_ID_HEX: "0x609e", isMintMeChain: (id: string) => id === "0x609e", readMintMeChainId: async () => "0x609e", switchToMintMeNetwork: async () => {},
}));
import { depositCustomToken } from "./customTokens";

const token = { address: `0x${"ab".repeat(20)}`, symbol: "ABC", decimals: 18, addedAt: 0 };
const abi = new Interface(["function balanceOf(address) view returns (uint256)"]);
const TX_HASH = `0x${"01".repeat(32)}`;
beforeEach(() => {
  mocks.transactions = []; mocks.request.mockReset(); mocks.add.mockReset(); mocks.connect.mockReset();
  mocks.account = ""; mocks.link = null;
});

describe("deposit guard execution", () => {
  it("blocks over-cap requests before asking MetaMask to move anything", async () => {
    await expect(depositCustomToken({ swarmId: "u", token, amount: 5_000_001 })).rejects.toThrow("5,000,000");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("blocks unreadable holdings before a transfer", async () => {
    mocks.account = `0x${"cd".repeat(20)}`;
    mocks.request.mockRejectedValue(new Error("Unavailable"));
    await expect(depositCustomToken({ swarmId: "u", token, amount: 1 })).rejects.toThrow("Could not verify");
    expect(mocks.request.mock.calls.map((call) => call[0])).toEqual(["eth_call"]);
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("reads back a deposit at the exact ceiling through the native balance path", async () => {
    mocks.account = `0x${"cd".repeat(20)}`;
    mocks.link = { address: mocks.account };
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "eth_call") return abi.encodeFunctionResult("balanceOf", [5_000_000n * 10n ** 18n]);
      if (method === "eth_sendTransaction") return TX_HASH;
      throw new Error("Unexpected wallet method");
    });
    mocks.add.mockImplementation((tx: SwarmTransaction) => mocks.transactions.push(tx));
    const tx = await depositCustomToken({ swarmId: "u", token, amount: 5_000_000 });
    expect(tx.amount).toBe(5_000_000);
    const { getRecordedTokenBalance, getCustomTokenDepositCapacity } = await import("./customTokens");
    expect(getRecordedTokenBalance("u", token.address)).toBe(5_000_000);
    expect(getCustomTokenDepositCapacity(token.address).remaining).toBe(0);
    await expect(depositCustomToken({ swarmId: "other", token, amount: 1 })).rejects.toThrow("remaining");
    expect(mocks.add).toHaveBeenCalledTimes(1);
  });
});

describe("single-confirmation deposit", () => {
  it("deposits with no linked wallet using only the transfer confirmation — no personal_sign", async () => {
    mocks.account = `0x${"cd".repeat(20)}`;
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "eth_call") return abi.encodeFunctionResult("balanceOf", [100n * 10n ** 18n]);
      if (method === "eth_sendTransaction") return TX_HASH;
      throw new Error(`Unexpected wallet method: ${method}`);
    });
    mocks.add.mockImplementation((tx: SwarmTransaction) => mocks.transactions.push(tx));
    const tx = await depositCustomToken({ swarmId: "u", token, amount: 10 });
    expect(mocks.request.mock.calls.map((call) => call[0])).toEqual(["eth_call", "eth_sendTransaction"]);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(tx.signature).toBe(TX_HASH);
    expect(tx.from).toBe(mocks.account);
    expect((tx.meta as Record<string, unknown>).txHash).toBe(TX_HASH);
  });
  it("prompts MetaMask to connect when the session was lost, then deposits", async () => {
    const address = `0x${"ef".repeat(20)}`;
    mocks.connect.mockResolvedValue({ address, chainId: "0x609e" });
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "eth_call") return abi.encodeFunctionResult("balanceOf", [50n * 10n ** 18n]);
      if (method === "eth_sendTransaction") return TX_HASH;
      throw new Error(`Unexpected wallet method: ${method}`);
    });
    const tx = await depositCustomToken({ swarmId: "u", token, amount: 5 });
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(tx.from).toBe(address);
  });
  it("still rejects when the connected account differs from an existing verified link", async () => {
    mocks.account = `0x${"cd".repeat(20)}`;
    mocks.link = { address: `0x${"ef".repeat(20)}` };
    await expect(depositCustomToken({ swarmId: "u", token, amount: 1 })).rejects.toThrow("different account");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });
});
