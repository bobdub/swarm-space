import { expect, test } from "bun:test";
import { validateWalletTip, type TipAsset } from "./tipRules";
import { genIdentityKeyPair, computeUserId } from "@/lib/crypto";
import { signWalletTip, verifyWalletTip } from "./tipSignature";
import type { SwarmTransaction } from "../types";

test("wallet token tips preserve fractional amounts instead of applying credit limits", () => {
  const asset: TipAsset = { id: "chain:SWARM", kind: "chain", ticker: "SWARM", name: "SWARM", balance: 1000 };
  expect(() => validateWalletTip(asset, 0.25)).not.toThrow();
  expect(() => validateWalletTip(asset, 600)).not.toThrow();
  expect(() => validateWalletTip(asset, 1001)).toThrow("Insufficient SWARM");
});
test("game credit tips remain whole credits", () => {
  const asset: TipAsset = { id: "credits", kind: "credits", ticker: "Credits", name: "Game credits", balance: 100 };
  expect(() => validateWalletTip(asset, 1)).not.toThrow();
  expect(() => validateWalletTip(asset, 1.5)).toThrow("whole credits");
});
test("unsupported external asset tips fail without claiming a transfer", () => {
  const asset: TipAsset = { id: "external:BTC", kind: "external", ticker: "BTC", name: "Bitcoin", balance: 1, unavailable: "Bridge unavailable" };
  expect(() => validateWalletTip(asset, 0.1)).toThrow("Bridge unavailable");
});
test("non-finite or negative tips cannot be sent", () => {
  const asset: TipAsset = { id: "creator:a", kind: "creator", ticker: "AAA", name: "Creator", balance: 20 };
  for (const amount of [NaN, Infinity, -1, 0]) expect(() => validateWalletTip(asset, amount)).toThrow();
});
test("native tip signature binds sender, recipient, token and amount", async () => {
  const keys = await genIdentityKeyPair();
  const from = await computeUserId(keys.publicKey);
  const tx: SwarmTransaction = { id: "tip-one", type: "wallet_tip", from, to: "aabbccddeeff0011", amount: 3,
    timestamp: "2026-10-18T21:19:00.000Z", signature: "", publicKey: keys.publicKey, nonce: 1, fee: 0,
    meta: { assetId: "chain:SWARM", ticker: "SWARM" } };
  const signed = await signWalletTip(tx, keys.privateKey);
  expect(await verifyWalletTip(signed)).toBe(true);
  expect(await verifyWalletTip({ ...signed, amount: 4 })).toBe(false);
  expect(await verifyWalletTip({ ...signed, to: "attacker" })).toBe(false);
  expect(await verifyWalletTip({ ...signed, tokenId: "another-token" })).toBe(false);
  expect(await verifyWalletTip({ ...signed, from: "another-user" })).toBe(false);
});