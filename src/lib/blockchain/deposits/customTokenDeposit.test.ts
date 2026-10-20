import { beforeEach, describe, expect, it, vi } from "vitest";
import { Interface, Wallet } from "ethers";
import type { SwarmTransaction } from "../types";

const mocks = vi.hoisted(() => ({ transactions: [] as SwarmTransaction[], request: vi.fn(), add: vi.fn(), account: "" }));
vi.mock("../chain", () => ({ getSwarmChain: () => ({ whenReady: async () => {}, addTransaction: mocks.add }) }));
vi.mock("../wallets/walletLink", () => ({
  getLinkedWallet: () => ({ address: mocks.account }),
  _allTransactionsForExternalLedger: () => mocks.transactions,
}));
vi.mock("../wallets/metaMaskBridge", () => ({ getMetaMaskAccount: async () => mocks.account, requestMetaMask: mocks.request }));
vi.mock("../wallets/mintmeNetwork", () => ({
  MINTME_CHAIN_ID_HEX: "0x609e", isMintMeChain: (id: string) => id === "0x609e", readMintMeChainId: async () => "0x609e", switchToMintMeNetwork: async () => {},
}));
import { depositCustomToken } from "./customTokens";

const token = { address: `0x${"ab".repeat(20)}`, symbol: "ABC", decimals: 18, addedAt: 0 };
const abi = new Interface(["function balanceOf(address) view returns (uint256)"]);
beforeEach(() => { mocks.transactions = []; mocks.request.mockReset(); mocks.add.mockReset(); });

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
  it("reads back a signed deposit at the exact ceiling through the native balance path", async () => {
    const wallet = Wallet.createRandom();
    mocks.account = wallet.address.toLowerCase();
    mocks.request.mockImplementation(async (method: string, params: string[]) => {
      if (method === "eth_call") return abi.encodeFunctionResult("balanceOf", [5_000_000n * 10n ** 18n]);
      if (method === "eth_sendTransaction") return `0x${"01".repeat(32)}`;
      if (method === "personal_sign") return wallet.signMessage(params[0]);
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