import { expect, test, vi } from "vitest";
import type { SwarmTransaction } from "../types";

vi.mock("../storage", () => ({ getChainState: async () => null, saveChainState: async () => {}, saveBlock: async () => {} }));
vi.mock("../chainHealthBridge", () => ({ recordBlockAccepted: () => {}, bootstrapChainBridge: () => {} }));

const { SwarmChain } = await import("../chain");
const { genIdentityKeyPair, computeUserId } = await import("@/lib/crypto");
const { signWalletTip, verifyWalletTip } = await import("../wallets/tipSignature");
const { CUSTOM_TOKEN_CUSTODY } = await import("./customTokenCustody");
const { customTipAssetId, customTipUnits, customTokenBalanceUnits } = await import("./customTokenTips");

const contract = "0x634340447220bcaaa09a5505d71ca62b644a1a82";
const currency = `MINTME:${contract}`;
const cold = `0x${"34".repeat(20)}`;

function syncRecord(owner: string, units: bigint): SwarmTransaction {
  return { id: `token-sync:${contract}:${cold}:${units}`, type: "external_deposit", from: cold, to: owner,
    amount: Number(units) / 1e12, fee: 0, nonce: 0, publicKey: cold, signature: "0x", timestamp: new Date().toISOString(),
    chainId: "SWARM", meta: { currency, custody: CUSTOM_TOKEN_CUSTODY, custodyAddress: cold, contract, decimals: 12,
      amountUnits: units.toString(), cumulativeUnits: units.toString() } };
}

async function tip(keys: { publicKey: string; privateKey: string }, from: string, amount: number, id: string, meta: Record<string, unknown> = {}) {
  return signWalletTip({ id, type: "wallet_tip", from, to: "aabbccddeeff0011", amount, fee: 0, nonce: Number(id.length) + amount,
    publicKey: keys.publicKey, signature: "", timestamp: new Date().toISOString(),
    meta: { assetId: customTipAssetId(contract), ticker: "DREAMS", currency, decimals: 12,
      amountUnits: customTipUnits(amount, 12).toString(), ...meta } }, keys.privateKey);
}

test("Dreams tips move the recorded token balance in exact units and never touch SWARM", async () => {
  const chain = new SwarmChain();
  await chain.whenReady();
  const keys = await genIdentityKeyPair();
  const from = await computeUserId(keys.publicKey);
  (chain as unknown as { pendingTransactions: SwarmTransaction[] }).pendingTransactions.push(syncRecord(from, 10_000_000_000_000n));

  const first = await tip(keys, from, 4, "dreams-tip");
  expect(await verifyWalletTip(first)).toBe(true);
  expect(await chain.acceptWalletTip(first)).toBe(true);
  const ledger = [...chain.getPendingTransactions()];
  expect(customTokenBalanceUnits(ledger, from, contract, 12)).toBe(6_000_000_000_000n);
  expect(customTokenBalanceUnits(ledger, first.to, contract, 12)).toBe(4_000_000_000_000n);
  expect(chain.getBalance(from)).toBe(0);
  expect(chain.getBalance(first.to)).toBe(0);

  expect(await chain.acceptWalletTip(await tip(keys, from, 7, "overspend"))).toBe(false);
  // Claiming other decimals than the on-chain proven ones cannot inflate the amount.
  expect(await chain.acceptWalletTip(await tip(keys, from, 1, "wrong-decimals", { decimals: 6, amountUnits: "1000000" }))).toBe(false);
});

test("tips of a token with no proven custody are refused", async () => {
  const chain = new SwarmChain();
  await chain.whenReady();
  const keys = await genIdentityKeyPair();
  const from = await computeUserId(keys.publicKey);
  expect(await chain.acceptWalletTip(await tip(keys, from, 1, "unbacked"))).toBe(false);
});

test("malformed custom tips fail signature-level checks", async () => {
  const keys = await genIdentityKeyPair();
  const from = await computeUserId(keys.publicKey);
  expect(await verifyWalletTip(await tip(keys, from, 2, "units-mismatch", { amountUnits: "1" }))).toBe(false);
  expect(await verifyWalletTip(await tip(keys, from, 2, "currency-mismatch", { currency: "MINTME" }))).toBe(false);
  expect(() => customTipUnits(0.0000000000001, 12)).toThrow("decimal places");
});
