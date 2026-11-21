import { expect, test, vi } from "vitest";

vi.mock("../storage", () => ({ getChainState: async () => null, saveChainState: async () => {}, saveBlock: async () => {} }));
vi.mock("../chainHealthBridge", () => ({ recordBlockAccepted: () => {}, bootstrapChainBridge: () => {} }));

const { SwarmChain } = await import("../chain");
const { genIdentityKeyPair, computeUserId } = await import("@/lib/crypto");
const { signWalletTip } = await import("./tipSignature");

test("signed SWARM tips debit once and reject overspending at ledger acceptance", async () => {
  const chain = new SwarmChain();
  await chain.whenReady();
  const keys = await genIdentityKeyPair();
  const from = await computeUserId(keys.publicKey);
  chain.addTransaction({ id: "funding", type: "token_transfer", from: "faucet", to: from, amount: 5,
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
test("the tip weight is signed: format-2 tiers verify, tampering and unknown tiers do not", async () => {
  const { verifyWalletTip } = await import("./tipSignature");
  const keys = await genIdentityKeyPair();
  const from = await computeUserId(keys.publicKey);
  const tip = await signWalletTip({ id: "weighted-tip", type: "wallet_tip", from, to: "aabbccddeeff0011",
    amount: 5, fee: 0, nonce: 1, publicKey: keys.publicKey, signature: "", timestamp: new Date().toISOString(),
    meta: { assetId: "chain:SWARM", tipFormat: 2, weight: "rare" } }, keys.privateKey);
  expect(await verifyWalletTip(tip)).toBe(true);
  expect(await verifyWalletTip({ ...tip, meta: { ...tip.meta, weight: "legendary" } })).toBe(false);
  const unknown = await signWalletTip({ ...tip, id: "bad-tier", meta: { ...tip.meta, weight: "gold" } }, keys.privateKey);
  expect(await verifyWalletTip(unknown)).toBe(false);
});
