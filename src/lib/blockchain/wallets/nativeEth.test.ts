import { beforeEach, describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";
import type { SwarmTransaction } from "../types";

const state = vi.hoisted(() => ({
  ledger: [] as SwarmTransaction[], settled: 0n, current: 0n, chainId: 1n,
}));
const cold = new Wallet(`0x${"03".repeat(32)}`);
const address = cold.address.toLowerCase();
const member = "aabbccddeeff0011";

vi.mock("./ethereumRpc", () => ({ ethereumFallbackProvider: () => ({
  getNetwork: async () => ({ chainId: state.chainId }), getBlockNumber: async () => 1000,
  getBalance: async (_a: string, tag?: number) => (tag === undefined ? state.current : state.settled),
  destroy: vi.fn(),
}) }));
vi.mock("./coldKey", () => ({
  getColdKeyReceivingAddress: async () => address,
  deriveColdKey: async () => ({ address: cold.address, wallet: cold }),
}));
vi.mock("@/lib/p2p/swarmMesh.standalone", () => ({ getSwarmMeshStandalone: () => ({ broadcast: vi.fn() }) }));
vi.mock("../chain", () => ({ getSwarmChain: () => ({
  whenReady: async () => {},
  getChain: () => [], getPendingTransactions: () => state.ledger,
  acceptNativeEthCustody: async (tx: SwarmTransaction) => {
    const { verifyNativeEthCustody } = await import("./nativeEth");
    if (!await verifyNativeEthCustody(tx, state.ledger, true)) return false;
    state.ledger.push(tx); return true;
  },
}) }));

import { ethUnits, isNativeEthTip, nativeEthBalanceUnits, NATIVE_ETH_ASSET_ID, syncNativeEthDeposits, verifyNativeEthCustody } from "./nativeEth";

const ETH = 10n ** 18n;
beforeEach(() => { state.ledger = []; state.settled = ETH / 2n; state.current = ETH / 2n; state.chainId = 1n; });

describe("native ETH deposits", () => {
  it("credits confirmed ETH once, to the member's native wallet", async () => {
    expect(await syncNativeEthDeposits(member)).toBe(0.5);
    expect(nativeEthBalanceUnits(state.ledger, member)).toBe(ETH / 2n);
    expect(state.ledger[0].meta).toMatchObject({ currency: "ETH", mode: "sync", custodyAddress: address });
    expect(await syncNativeEthDeposits(member)).toBe(0);
    state.settled = ETH; state.current = ETH;
    expect(await syncNativeEthDeposits(member)).toBe(0.5);
    expect(nativeEthBalanceUnits(state.ledger, member)).toBe(ETH);
  });

  it("waits for 12 confirmations before crediting", async () => {
    state.settled = 0n; state.current = ETH;
    expect(await syncNativeEthDeposits(member)).toBe(0);
    expect(state.ledger).toHaveLength(0);
  });

  it("refuses a node on another chain and a forged or rebound receipt", async () => {
    state.chainId = 24734n;
    await expect(syncNativeEthDeposits(member)).rejects.toThrow("Ethereum");
    state.chainId = 1n;
    await syncNativeEthDeposits(member);
    const [tx] = state.ledger;
    expect(await verifyNativeEthCustody({ ...tx, amount: 5 }, [], false)).toBe(false);
    expect(await verifyNativeEthCustody({ ...tx, to: "1122334455667788" }, [], false)).toBe(false);
    expect(await verifyNativeEthCustody(tx, [], false)).toBe(true);
    // More than the address holds on Ethereum is never accepted live.
    state.current = 0n;
    expect(await verifyNativeEthCustody(tx, [], true)).toBe(false);
  });

  it("moves ETH between members with tips in exact wei", async () => {
    await syncNativeEthDeposits(member);
    const tip = { id: "t", type: "wallet_tip", from: member, to: "1122334455667788", amount: 0.2,
      meta: { assetId: NATIVE_ETH_ASSET_ID, currency: "ETH", amountUnits: ethUnits(0.2).toString() } } as unknown as SwarmTransaction;
    expect(isNativeEthTip(tip)).toBe(true);
    const ledger = [...state.ledger, tip];
    expect(nativeEthBalanceUnits(ledger, member)).toBe(ETH / 2n - ethUnits(0.2));
    expect(nativeEthBalanceUnits(ledger, "1122334455667788")).toBe(ethUnits(0.2));
    expect(isNativeEthTip({ ...tip, meta: { ...tip.meta, currency: "MINTME" } })).toBe(false);
  });
});
