import { expect, test, vi } from "vitest";
import type { SwarmTransaction } from "../types";

vi.mock("../storage", () => ({ getChainState: async () => null, saveChainState: async () => {}, saveBlock: async () => {} }));
vi.mock("../chainHealthBridge", () => ({ recordBlockAccepted: () => {}, bootstrapChainBridge: () => {} }));

const { SwarmChain } = await import("../chain");
const { genIdentityKeyPair, computeUserId } = await import("@/lib/crypto");
const { signWalletTip, verifyWalletTip } = await import("./tipSignature");
const { NATIVE_ETH_ASSET_ID, NATIVE_ETH_CUSTODY, ethUnits } = await import("./nativeEth");

const cold = `0x${"34".repeat(20)}`;
const syncRecord = (owner: string, units: bigint): SwarmTransaction => ({
  id: `eth-sync:${cold}:${units}`, type: "external_deposit", from: cold, to: owner, amount: Number(units) / 1e18,
  fee: 0, nonce: 0, publicKey: cold, signature: "0x", timestamp: new Date().toISOString(), chainId: "SWARM",
  meta: { currency: "ETH", custody: NATIVE_ETH_CUSTODY, custodyAddress: cold, mode: "sync", amountUnits: units.toString(), cumulativeUnits: units.toString() },
});

test("ETH tips settle against deposited ETH and never touch SWARM", async () => {
  const chain = new SwarmChain();
  await chain.whenReady();
  const keys = await genIdentityKeyPair();
  const from = await computeUserId(keys.publicKey);
  expect(() => chain.addTransaction(syncRecord(from, 10n ** 18n))).toThrow("ETH custody requires verified acceptance");
  (chain as unknown as { pendingTransactions: SwarmTransaction[] }).pendingTransactions.push(syncRecord(from, 10n ** 18n));

  const tip = (amount: number, id: string) => signWalletTip({ id, type: "wallet_tip", from, to: "aabbccddeeff0011", amount, fee: 0,
    nonce: amount * 1000, publicKey: keys.publicKey, signature: "", timestamp: new Date().toISOString(),
    meta: { assetId: NATIVE_ETH_ASSET_ID, ticker: "ETH", currency: "ETH", amountUnits: ethUnits(amount).toString() } }, keys.privateKey);

  const first = await tip(0.25, "eth-tip");
  expect(await verifyWalletTip(first)).toBe(true);
  expect(await chain.acceptWalletTip(first)).toBe(true);
  expect(chain.getNativeEthBalanceUnits(from)).toBe(ethUnits(0.75));
  expect(chain.getNativeEthBalanceUnits(first.to)).toBe(ethUnits(0.25));
  expect(chain.getBalance(from)).toBe(0);
  expect(chain.getBalance(first.to)).toBe(0);
  expect(await chain.acceptWalletTip(await tip(0.9, "overspend"))).toBe(false);
});
