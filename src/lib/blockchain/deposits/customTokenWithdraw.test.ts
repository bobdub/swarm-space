import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SwarmTransaction } from "../types";

const mocks = vi.hoisted(() => ({
  transactions: [] as SwarmTransaction[], add: vi.fn(),
  account: "" as string, link: null as { address: string } | null, connect: vi.fn(),
  authority: null as { kind: string } | null,
  send: vi.fn(), coldAddress: `0x${"aa".repeat(20)}`,
}));
vi.mock("../chain", () => ({ getSwarmChain: () => ({ whenReady: async () => {}, addTransaction: mocks.add }) }));
vi.mock("../wallets/walletLink", () => ({
  getLinkedWallet: () => mocks.link,
  _allTransactionsForExternalLedger: () => mocks.transactions,
}));
vi.mock("../wallets/metaMaskBridge", () => ({
  getMetaMaskAccount: async () => mocks.account || null,
  connectMetaMask: mocks.connect,
  requestMetaMask: vi.fn(),
}));
vi.mock("../wallets/mintmeNetwork", () => ({
  MINTME_CHAIN_ID_HEX: "0x609e", isMintMeChain: (id: string) => id === "0x609e", readMintMeChainId: async () => "0x609e", switchToMintMeNetwork: async () => {},
}));
vi.mock("../wallets/coldKey", () => ({
  deriveColdKey: async () => ({ address: mocks.coldAddress, wallet: {} }),
  getColdKeyReceivingAddress: async () => mocks.coldAddress,
  getColdKeyAuthority: async () => mocks.authority,
  sendColdKeyTokenTransfer: mocks.send,
}));
import { withdrawCustomToken } from "./customTokens";

const token = { address: `0x${"ab".repeat(20)}`, symbol: "ABC", decimals: 18, addedAt: 0 };
const DEST = `0x${"cd".repeat(20)}`;
const TX_HASH = `0x${"01".repeat(32)}`;
function seedDeposit(amount: number) {
  mocks.transactions.push({
    id: "dep1", type: "external_deposit", from: DEST, to: "u", amount,
    timestamp: new Date().toISOString(), signature: TX_HASH, publicKey: DEST, nonce: 1, fee: 0,
    meta: { kind: "external_deposit", currency: `MINTME:${token.address}`, txHash: TX_HASH },
  } as SwarmTransaction);
}
beforeEach(() => {
  mocks.transactions = []; mocks.add.mockReset(); mocks.connect.mockReset(); mocks.send.mockReset();
  mocks.account = DEST; mocks.link = null; mocks.authority = { kind: "engraved" };
  mocks.add.mockImplementation((tx: SwarmTransaction) => mocks.transactions.push(tx));
});

describe("cold-key withdrawal", () => {
  it("refuses without key authority and never broadcasts or debits", async () => {
    seedDeposit(100);
    mocks.authority = null;
    await expect(withdrawCustomToken({ swarmId: "u", token, amount: 10, to: DEST })).rejects.toThrow("cold-wallet key");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("refuses more than the recorded native balance", async () => {
    seedDeposit(5);
    await expect(withdrawCustomToken({ swarmId: "u", token, amount: 10, to: DEST })).rejects.toThrow("not enough");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("refuses an invalid destination address", async () => {
    seedDeposit(100);
    await expect(withdrawCustomToken({ swarmId: "u", token, amount: 10, to: "not-an-address" })).rejects.toThrow("0x");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("keeps the native balance when the MintMe broadcast fails", async () => {
    seedDeposit(100);
    mocks.send.mockRejectedValue(new Error("no MINTME for gas"));
    await expect(withdrawCustomToken({ swarmId: "u", token, amount: 10, to: DEST })).rejects.toThrow("gas");
    expect(mocks.add).not.toHaveBeenCalled();
    const { getRecordedTokenBalance } = await import("./customTokens");
    expect(getRecordedTokenBalance("u", token.address)).toBe(100);
  });
  it("sends the exact amount from the cold key to the chosen destination, then debits the ledger", async () => {
    seedDeposit(100);
    mocks.send.mockResolvedValue(TX_HASH);
    const tx = await withdrawCustomToken({ swarmId: "u", token, amount: 40, to: DEST });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const sent = mocks.send.mock.calls[0][0] as { to: string; units: bigint; tokenAddress: string };
    expect(sent.to).toBe(DEST);
    expect(sent.units).toBe(40n * 10n ** 18n);
    expect(sent.tokenAddress).toBe(token.address);
    expect(tx.type).toBe("external_withdraw");
    expect(tx.signature).toBe(TX_HASH);
    expect(tx.from).toBe("u");
    expect((tx.meta as Record<string, unknown>).destination).toBe(DEST);
    expect((tx.meta as Record<string, unknown>).coldKeyAddress).toBe(mocks.coldAddress);
    const { getRecordedTokenBalance } = await import("./customTokens");
    expect(getRecordedTokenBalance("u", token.address)).toBe(60);
  });
  it("prompts MetaMask to connect when the session was lost", async () => {
    seedDeposit(100);
    mocks.account = "";
    mocks.connect.mockResolvedValue({ address: DEST, chainId: "0x609e" });
    mocks.send.mockResolvedValue(TX_HASH);
    await withdrawCustomToken({ swarmId: "u", token, amount: 10, to: DEST });
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });
  it("rejects when the connected account differs from an existing verified link", async () => {
    seedDeposit(100);
    mocks.link = { address: `0x${"ef".repeat(20)}` };
    await expect(withdrawCustomToken({ swarmId: "u", token, amount: 10, to: DEST })).rejects.toThrow("different account");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });
});
