import { describe, expect, it, vi } from "vitest";

vi.mock("../storage", () => ({ getChainState: async () => null, saveChainState: async () => {}, saveBlock: async () => {} }));
vi.mock("../chainHealthBridge", () => ({ recordBlockAccepted: () => {}, bootstrapChainBridge: () => {} }));

const { SwarmChain } = await import("../chain");
const { genIdentityKeyPair, computeUserId } = await import("@/lib/crypto");
const { signWalletTip, verifyWalletTip } = await import("./tipSignature");
const {
  canSettleCreatorTokenTip, creatorTokenBalanceUnits, creatorTokenUnits, creatorTipMove, holdingUnits, planCreatorTokenTip,
} = await import("./creatorTokenTips");
import type { SwarmTransaction } from "../types";

const TOKEN = "nft-1700000000000-abc123xyz";
const CREATOR = "c0ffee00c0ffee00";
const u = (n: number) => creatorTokenUnits(n);

async function member() {
  const keys = await genIdentityKeyPair();
  return { ...keys, id: await computeUserId(keys.publicKey) };
}

async function creatorTip(from: Awaited<ReturnType<typeof member>>, to: string, amount: number, opening: number, id: string, nonce = 1) {
  return signWalletTip({
    id, type: "wallet_tip", from: from.id, to, amount, tokenId: TOKEN, chainId: "SWARM",
    fee: 0, nonce, publicKey: from.publicKey, signature: "", timestamp: new Date().toISOString(),
    meta: { assetId: `creator:${TOKEN}`, ticker: "TOK", creatorUserId: CREATOR, intent: "tip", message: null,
      amountUnits: u(amount).toString(), openingUnits: u(opening).toString() },
  }, from.privateKey);
}

describe("creator-token tips", () => {
  it("are signed tips that name their token and refuse tampering", async () => {
    const alice = await member();
    const tip = await creatorTip(alice, "aabbccddeeff0011", 5, 100, "t1");
    expect(await verifyWalletTip(tip)).toBe(true);
    expect(await verifyWalletTip({ ...tip, meta: { ...tip.meta, openingUnits: u(9000).toString() } })).toBe(false);
    expect(await verifyWalletTip({ ...tip, tokenId: "nft-other" })).toBe(false);
    const mismatched = await signWalletTip({ ...tip, id: "t2", amount: 6 }, alice.privateKey);
    expect(await verifyWalletTip(mismatched)).toBe(false);
    const overSupply = await creatorTip(alice, "aabbccddeeff0011", 5, 10_001, "t3");
    expect(await verifyWalletTip(overSupply)).toBe(false);
  });

  it("settle against the sender's signed opening and conserve tokens across tips", async () => {
    const chain = new SwarmChain();
    await chain.whenReady();
    const alice = await member();
    const bob = await member();
    expect(await chain.acceptWalletTip(await creatorTip(alice, bob.id, 60, 100, "a1"))).toBe(true);
    // The same 100 tokens cannot be spent twice, whatever opening a later tip repeats.
    expect(await chain.acceptWalletTip(await creatorTip(alice, bob.id, 50, 100, "a2", 2))).toBe(false);
    // A lower opening never lowers the one signed before: the remaining 40 still move.
    expect(await chain.acceptWalletTip(await creatorTip(alice, bob.id, 40, 0, "a3", 3))).toBe(true);
    const ledger = () => chain.getPendingTransactions();
    expect(creatorTokenBalanceUnits(ledger(), alice.id, TOKEN)).toBe(0n);
    expect(creatorTokenBalanceUnits(ledger(), bob.id, TOKEN)).toBe(u(100));
    // Bob's tokens came by tip, so he spends them with no opening of his own.
    expect(await chain.acceptWalletTip(await creatorTip(bob, alice.id, 100, 0, "b1"))).toBe(true);
    expect(await chain.acceptWalletTip(await creatorTip(bob, alice.id, 1, 0, "b2", 2))).toBe(false);
    // Creator tips never move SWARM.
    expect(chain.getBalance(alice.id)).toBe(0);
    expect(chain.getBalance(bob.id)).toBe(0);
  });

  it("plans the opening from the holding this device keeps, never more than is held", () => {
    const tip = (id: string, from: string, to: string, amount: number, opening: number) => ({
      id, type: "wallet_tip", from, to, amount, tokenId: TOKEN, chainId: "SWARM", fee: 0, nonce: 1, publicKey: "", signature: "",
      timestamp: "2026-01-01T00:00:00Z",
      meta: { assetId: `creator:${TOKEN}`, ticker: "TOK", creatorUserId: CREATOR, amountUnits: u(amount).toString(), openingUnits: u(opening).toString() },
    }) as SwarmTransaction;
    const a = "aaaaaaaaaaaaaaaa";
    const b = "bbbbbbbbbbbbbbbb";
    // First tip: the whole market holding becomes the opening.
    expect(planCreatorTokenTip([], a, TOKEN, u(100))).toEqual({ openingUnits: u(100), spendableUnits: u(100) });
    const ledger = [tip("x1", a, b, 30, 100), tip("x2", b, a, 5, 0)];
    // Holds 75 here (100 − 30 + 5) and buys 20 more: the opening rises to 120.
    expect(planCreatorTokenTip(ledger, a, TOKEN, u(95))).toEqual({ openingUnits: u(120), spendableUnits: u(95) });
    // Sold 50 on the market: the opening stays at 100, and only the 25 held can move.
    expect(planCreatorTokenTip(ledger, a, TOKEN, u(25))).toEqual({ openingUnits: u(100), spendableUnits: u(25) });
    expect(canSettleCreatorTokenTip(ledger, tip("x3", a, b, 75, 100))).toBe(true);
    expect(canSettleCreatorTokenTip(ledger, tip("x4", a, b, 75.000001, 100))).toBe(false);
    expect(creatorTipMove(ledger[0])).toMatchObject({ from: a, to: b, tokenId: TOKEN, amount: 30, ticker: "TOK" });
    expect(holdingUnits(12.3456789)).toBe(u(12.345678));
    expect(() => creatorTokenUnits(1.0000001)).toThrow(/decimal/);
  });
});
