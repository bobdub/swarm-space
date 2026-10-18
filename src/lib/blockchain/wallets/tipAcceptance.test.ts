import { expect, test, mock } from "bun:test";

mock.module("../storage", () => ({ getChainState: async () => null, saveChainState: async () => {}, saveBlock: async () => {} }));
mock.module("../chainHealthBridge", () => ({ recordBlockAccepted: () => {}, bootstrapChainBridge: () => {} }));

const { SwarmChain } = await import("../chain");
const { genIdentityKeyPair, computeUserId } = await import("@/lib/crypto");
const { signWalletTip } = await import("./tipSignature");

test("signed SWARM tips debit once and reject overspending at ledger acceptance", async () => {
  const chain = new SwarmChain();
  await chain.whenReady();
  const keys = await genIdentityKeyPair();
  const from = await computeUserId(keys.publicKey);
  chain.addTransaction({ id: "funding", type: "token_mint", from: "system", to: from, amount: 5,
    fee: 0, nonce: 0, publicKey: "", signature: "", timestamp: new Date().toISOString() });
  const tip = await signWalletTip({ id: "signed-tip", type: "wallet_tip", from, to: "aabbccddeeff0011",
    amount: 3, fee: 0, nonce: 1, publicKey: keys.publicKey, signature: "", timestamp: new Date().toISOString(),
    meta: { assetId: "chain:SWARM" } }, keys.privateKey);
  expect(await chain.acceptWalletTip(tip)).toBe(true);
  expect(await chain.acceptWalletTip(tip)).toBe(true);
  expect(chain.getBalance(from)).toBe(2);
  expect(chain.getBalance(tip.to)).toBe(3);
  const second = await signWalletTip({ ...tip, id: "overspend" }, keys.privateKey);
  expect(await chain.acceptWalletTip(second)).toBe(false);
  expect(chain.getBalance(tip.to)).toBe(3);
  expect(() => chain.addTransaction({ ...tip, id: "bypass" })).toThrow("verified acceptance");
});