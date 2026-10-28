import { describe, it, expect, vi } from "vitest";
vi.mock("../storage", () => ({ getChainState: async () => null, saveChainState: async () => {}, saveBlock: async () => {} }));
vi.mock("../chainHealthBridge", () => ({ recordBlockAccepted: () => {}, bootstrapChainBridge: () => {} }));
vi.mock("./nativeMintmeCustody", () => ({ verifyNativeMintMeDeposit: async (tx: { meta?: Record<string, unknown> }) => tx.meta?.verified === true }));
import { SwarmChain } from "../chain";
import { genIdentityKeyPair, computeUserId } from "@/lib/crypto";
import { signWalletTip, verifyWalletTip } from "./tipSignature";
import { NATIVE_MINTME_CUSTODY, nativeMintMeBalanceUnits } from "./nativeMintmeLedger";
import type { SwarmTransaction } from "../types";

async function funded() {
  const chain = new SwarmChain();
  await chain.whenReady();
  const keys = await genIdentityKeyPair();
  const from = await computeUserId(keys.publicKey);
  const deposit: SwarmTransaction = { id: crypto.randomUUID(), type: "external_deposit", from: "pool", to: from,
    amount: 25, fee: 0, nonce: 0, timestamp: new Date().toISOString(), publicKey: "", signature: "",
    meta: { currency: "MINTME", custody: NATIVE_MINTME_CUSTODY, verified: true, amountUnits: "25000000000000000000" } };
  expect(await chain.acceptNativeMintMeDeposit(deposit)).toBe(true);
  const tip = async (id: string, amount: number, units: string, nonce: number) => signWalletTip({
    id, type: "wallet_tip", from, to: "aabbccddeeff0011", amount, fee: 0, nonce,
    timestamp: new Date().toISOString(), publicKey: keys.publicKey, signature: "", chainId: "SWARM",
    meta: { assetId: "external:MINTME", currency: "MINTME", amountUnits: units },
  }, keys.privateKey);
  return { chain, from, tip, deposit };
}

describe("native MINTME settlement", () => {
  it("moves 23.75 MINTME from 25, retaining 1.25 without moving SWARM", async () => {
    const { chain, from, tip } = await funded();
    const tx = await tip("equal-payout", 23.75, "23750000000000000000", 1);
    expect(await chain.acceptWalletTip(tx)).toBe(true);
    expect(chain.getNativeMintMeBalanceUnits(from)).toBe(1250000000000000000n);
    expect(chain.getNativeMintMeBalanceUnits(tx.to)).toBe(23750000000000000000n);
    expect(chain.getBalance(from)).toBe(0);
    expect(chain.getBalance(tx.to)).toBe(0);
    expect(await chain.acceptWalletTip(tx)).toBe(true);
    expect(chain.getNativeMintMeBalanceUnits(tx.to)).toBe(23750000000000000000n);
  });
  it("rejects recipient, asset and atomic amount tampering", async () => {
    const { tip } = await funded();
    const tx = await tip("bound", 1, "1000000000000000000", 2);
    expect(await verifyWalletTip(tx)).toBe(true);
    expect(await verifyWalletTip({ ...tx, to: "0011223344556677" })).toBe(false);
    expect(await verifyWalletTip({ ...tx, meta: { ...tx.meta, assetId: "external:BTC" } })).toBe(false);
    expect(await verifyWalletTip({ ...tx, meta: { ...tx.meta, amountUnits: "2000000000000000000" } })).toBe(false);
  });
  it("cannot overspend when competing receipts arrive together", async () => {
    const { chain, from, tip } = await funded();
    const first = await tip("one", 20, "20000000000000000000", 3);
    const second = await tip("two", 20, "20000000000000000000", 4);
    const results = await Promise.all([chain.acceptWalletTip(first), chain.acceptWalletTip(second)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(chain.getNativeMintMeBalanceUnits(from)).toBe(5000000000000000000n);
  });
  it("rejects a replay with a new id and the same sender/asset nonce", async () => {
    const { chain, tip } = await funded();
    expect(await chain.acceptWalletTip(await tip("original", 1, "1000000000000000000", 5))).toBe(true);
    expect(await chain.acceptWalletTip(await tip("renamed", 1, "1000000000000000000", 5))).toBe(false);
  });
  it("keeps old self-transfer records and migrations out of spendable MINTME", async () => {
    const { chain, deposit } = await funded();
    const legacy = { ...deposit, meta: { currency: "MINTME", source: "local-ledger-migration" } };
    expect(nativeMintMeBalanceUnits([legacy], legacy.to)).toBe(0n);
    expect(() => chain.addTransaction({ ...deposit, id: "bypass" })).toThrow("verified acceptance");
    expect(await chain.acceptNativeMintMeDeposit({ ...deposit, id: "unconfirmed", meta: { ...deposit.meta, verified: false } })).toBe(false);
  });
  it("rejects an unfunded batch without partially paying recipients", async () => {
    const { chain, from, tip } = await funded();
    const first = await tip("batch-one", 20, "20000000000000000000", 6);
    const second = await tip("batch-two", 20, "20000000000000000000", 7);
    expect(await chain.acceptNativeMintMeBatch([first, second])).toBe(false);
    expect(chain.getNativeMintMeBalanceUnits(from)).toBe(25000000000000000000n);
    expect(chain.getNativeMintMeBalanceUnits(first.to)).toBe(0n);
  });
});