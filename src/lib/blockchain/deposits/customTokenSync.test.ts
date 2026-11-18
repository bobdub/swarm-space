import { beforeEach, describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";
import type { SwarmTransaction } from "../types";

const state = vi.hoisted(() => ({
  ledger: [] as SwarmTransaction[], held: 10_000_000_000_000n, decimals: 12,
  sign: vi.fn(), broadcast: vi.fn(), balance: vi.fn(), receipt: vi.fn(), transaction: vi.fn(), locked: false,
}));
const wallet = new Wallet(`0x${"01".repeat(32)}`);
const address = wallet.address.toLowerCase();
const contract = "0x634340447220bcaaa09a5505d71ca62b644a1a82";
vi.mock("ethers", async importOriginal => {
  const actual = await importOriginal<typeof import("ethers")>();
  return { ...actual, Contract: class {
    decimals = async () => state.decimals;
    balanceOf = async () => { state.balance(); return state.held; };
  } };
});
vi.mock("../wallets/nativeMintmeCustody", () => ({ mintMeReadProvider: () => ({
  getNetwork: async () => ({ chainId: 24734n }), getBlockNumber: async () => 100,
  getTransactionReceipt: state.receipt, getTransaction: state.transaction, destroy: vi.fn(),
}) }));
vi.mock("../wallets/walletLink", () => ({ _allTransactionsForExternalLedger: () => state.ledger }));
vi.mock("../wallets/coldKey", () => ({
  getColdKeyReceivingAddress: async () => address,
  deriveColdKey: async () => {
    if (state.locked) throw new Error("Wallet locked");
    return { address, wallet: { signMessage: async (message: string) => { state.sign(message); return wallet.signMessage(message); } } };
  }, getColdKeyAuthority: vi.fn(), sendColdKeyTokenTransfer: vi.fn(),
}));
vi.mock("@/lib/p2p/swarmMesh.standalone", () => ({ getSwarmMeshStandalone: () => ({ broadcast: state.broadcast }) }));
vi.mock("./depositSync", () => ({ isDepositSynced: () => true, connectedPeerCount: async () => 1, markDepositsSynced: async () => true }));
vi.mock("../../store", () => ({ get: async () => undefined, put: async () => {} }));
vi.mock("../chain", () => ({ getSwarmChain: () => ({
  whenReady: async () => {},
  acceptCustomTokenDeposit: async (tx: SwarmTransaction) => {
    const { verifyCustomTokenSync } = await import("./customTokenCustody");
    if (!await verifyCustomTokenSync(tx, state.ledger, true)) return false;
    state.ledger.push(tx); return true;
  },
}) }));
import { addCustomToken, getRecordedTokenBalance, syncCustomTokenDeposits } from "./customTokens";
import { customTokenCustodyFlows, verifyCustomTokenSync } from "./customTokenCustody";

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); state.ledger = []; state.held = 10_000_000_000_000n;
  state.decimals = 12; state.locked = false;
  addCustomToken("member", { address: contract, symbol: "Dreams", decimals: 12 });
});
describe("confirmed imported token deposits", () => {
  it("credits exactly 10 Dreams with 12 decimals, signs and broadcasts once, and never repeats", async () => {
    expect(await syncCustomTokenDeposits("member", contract)).toBe(10);
    expect(getRecordedTokenBalance("member", contract)).toBe(10);
    expect(state.ledger[0].meta?.amountUnits).toBe("10000000000000");
    expect(state.sign).toHaveBeenCalledOnce(); expect(state.broadcast).toHaveBeenCalledWith("wallet-tips", state.ledger[0]);
    expect(await syncCustomTokenDeposits("member", contract)).toBe(0);
    expect(state.ledger).toHaveLength(1);
  });
  it("coalesces simultaneous manual and automatic checks", async () => {
    await Promise.all([syncCustomTokenDeposits("member", contract), syncCustomTokenDeposits("member", contract)]);
    expect(state.ledger).toHaveLength(1); expect(state.sign).toHaveBeenCalledOnce();
  });
  it("does not recreate tokens after a native peer transfer", async () => {
    await syncCustomTokenDeposits("member", contract);
    state.ledger.push({ ...state.ledger[0], id: "peer-transfer", type: "custom_token_transfer", from: "member", to: "other", amount: 4 });
    expect(await syncCustomTokenDeposits("member", contract)).toBe(0);
    expect(getRecordedTokenBalance("member", contract)).toBe(6);
  });
  it("enforces the 5,000,000 lifetime ceiling across owners", async () => {
    state.ledger.push({ id: "prior", type: "external_deposit", from: "x", to: "other", amount: 4_999_995, meta: { currency: `MINTME:${contract}` } } as SwarmTransaction);
    await expect(syncCustomTokenDeposits("member", contract)).rejects.toThrow("5,000,000");
    expect(state.sign).not.toHaveBeenCalled();
  });
  it("rejects wrong decimals and locked signing without crediting", async () => {
    state.decimals = 18;
    await expect(syncCustomTokenDeposits("member", contract)).rejects.toThrow("metadata");
    state.decimals = 12; state.locked = true;
    await expect(syncCustomTokenDeposits("member", contract)).rejects.toThrow("locked");
    expect(state.ledger).toHaveLength(0);
  });
  it("rejects a forged receipt or changed recipient", async () => {
    await syncCustomTokenDeposits("member", contract);
    expect(await verifyCustomTokenSync({ ...state.ledger[0], to: "other" }, [], true)).toBe(false);
    expect(await verifyCustomTokenSync({ ...state.ledger[0], amount: 20 }, [], true)).toBe(false);
  });
  it("counts historical custody inflows and outflows without counting native transfers or duplicate records", () => {
    const tx = { id: "old", type: "external_deposit", to: "member", amount: 10, meta: { currency: `MINTME:${contract}`, address } } as SwarmTransaction;
    const withdrawal = { ...tx, id: "out", type: "external_withdraw", from: "member", amount: 4 } as SwarmTransaction;
    expect(customTokenCustodyFlows([tx, tx, withdrawal], "member", address, contract, 12)).toEqual({ inflow: 10_000_000_000_000n, outflow: 4_000_000_000_000n });
  });
  it("does not re-credit a broadcast withdrawal until MintMe confirms it", async () => {
    await syncCustomTokenDeposits("member", contract);
    state.ledger.push({ ...state.ledger[0], id: "pending-out", type: "external_withdraw", from: "member", to: `0x${"ab".repeat(20)}`, amount: 4,
      meta: { currency: `MINTME:${contract}`, coldKeyAddress: address, txHash: `0x${"ab".repeat(32)}` } });
    state.receipt.mockResolvedValue(null); state.transaction.mockResolvedValue(null);
    expect(await syncCustomTokenDeposits("member", contract)).toBe(0);
    expect(state.ledger).toHaveLength(2);
  });
});