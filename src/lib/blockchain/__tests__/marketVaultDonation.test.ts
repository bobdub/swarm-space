import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SwarmTransaction } from "../types";

const state = vi.hoisted(() => ({ added: [] as SwarmTransaction[], available: 10, user: "member" as string | null, swarm: 10 }));
vi.mock("../../auth", () => ({ getCurrentUser: () => (state.user ? { id: state.user } : null) }));
vi.mock("../chain", () => ({ getSwarmChain: () => ({
  addTransaction: (tx: SwarmTransaction) => state.added.push(tx), whenReady: async () => {},
  getChain: () => [], getPendingTransactions: () => state.added,
}) }));
vi.mock("../token", () => ({
  getSwarmBalance: async () => state.swarm,
  transferSwarm: async (p: { from: string; to: string; amount: number; meta: Record<string, unknown> }) => {
    state.added.push({ id: `swarm-${state.added.length}`, type: "token_transfer", from: p.from, to: p.to, amount: p.amount, meta: p.meta } as SwarmTransaction);
  },
}));
vi.mock("../storage", () => ({ derivePoolFromChain: async () => {} }));
const credits = vi.hoisted(() => ({ deduct: vi.fn(), award: vi.fn() }));
vi.mock("../../credits", () => ({ deductCredits: credits.deduct, awardVaultCredits: credits.award }));
vi.mock("../deposits/customTokens", () => ({
  getAvailableTokenBalance: () => state.available,
  tokenCurrency: (a: string) => `MINTME:${a.toLowerCase()}`,
  listCustomTokens: () => [{ address: "0x634340447220BCAAA09A5505D71CA62B644A1A82", symbol: "DREAMS", decimals: 18, addedAt: 0 }],
}));

const { donateCreditsToVault, donateTokenToVault, sellSwarmForCredits, vaultCreditReserve } = await import("../marketVault");
const { quoteSwarmForCredits } = await import("../marketVaultPricing");
const contract = "0x634340447220BCAAA09A5505D71CA62B644A1A82";

describe("donating MintMe tokens to the Market Vault", () => {
  beforeEach(() => { state.added = []; state.available = 10; state.user = "member"; });

  it("moves synced Dreams into the vault's holdings", async () => {
    await donateTokenToVault("member", contract, 4);
    expect(state.added).toHaveLength(1);
    expect(state.added[0]).toMatchObject({ type: "custom_token_transfer", from: "member", to: "community-pool", amount: 4,
      meta: { currency: `MINTME:${contract.toLowerCase()}`, marketVault: true, direction: "donation", ticker: "DREAMS" } });
  });

  it("refuses more than the synced balance, zero amounts and other accounts", async () => {
    await expect(donateTokenToVault("member", contract, 11)).rejects.toThrow("available");
    await expect(donateTokenToVault("member", contract, 0)).rejects.toThrow("above zero");
    state.user = "someone-else";
    await expect(donateTokenToVault("member", contract, 1)).rejects.toThrow("Sign in");
    expect(state.added).toHaveLength(0);
  });
});

describe("donating Credits to the Market Vault", () => {
  beforeEach(() => { credits.deduct.mockReset(); credits.award.mockReset(); state.user = "member"; state.added = []; state.swarm = 10; });

  it("moves whole Credits from the donor into the vault's Credits reserve", async () => {
    await donateCreditsToVault("member", 25);
    expect(credits.deduct).toHaveBeenCalledWith("member", 25, "Market Vault donation: 25 credits");
    expect(vaultCreditReserve(state.added)).toBe(25);
  });

  it("refuses fractions, zero and other accounts", async () => {
    await expect(donateCreditsToVault("member", 2.5)).rejects.toThrow("whole number");
    await expect(donateCreditsToVault("member", 0)).rejects.toThrow("whole number");
    state.user = "someone-else";
    await expect(donateCreditsToVault("member", 5)).rejects.toThrow("Sign in");
    expect(credits.deduct).not.toHaveBeenCalled();
  });
});

describe("selling SWARM to the vault for Credits", () => {
  beforeEach(() => { credits.deduct.mockReset(); credits.award.mockReset(); state.user = "member"; state.added = []; state.swarm = 10; });

  it("counts Credits paid for vault buys and donations, minus payouts", () => {
    const buy = { id: "b", type: "credit_lock", from: "community-pool", to: "x", amount: 1,
      meta: { marketVault: true, direction: "vault-buy", paidAsset: "Credits", paidAmount: 150, creditsLocked: 150 } } as SwarmTransaction;
    const tokenBuy = { ...buy, id: "t", meta: { ...buy.meta, paidAsset: "MINTME:0xabc", paidAmount: 9 } } as SwarmTransaction;
    const payout = { id: "p", type: "custom_token_transfer", from: "community-pool", to: "x", amount: 40, meta: { marketVault: true, currency: "CREDITS" } } as SwarmTransaction;
    expect(vaultCreditReserve([buy, buy, tokenBuy, payout])).toBe(110);
  });

  it("never pays more than the base rate, caps each trade at 10% of the reserve, and needs a reserve", () => {
    expect(quoteSwarmForCredits(100_000, 1, 5)).toEqual({ out: 99, error: null });
    expect(quoteSwarmForCredits(1_000, 5, 5).error).toMatch("10%");
    expect(quoteSwarmForCredits(0, 1, 5).error).toMatch("no Credits");
    expect(quoteSwarmForCredits(100_000, 6, 5).error).toMatch("Not enough SWARM");
  });

  it("takes the SWARM, pays Credits from the reserve and records the payout", async () => {
    await donateCreditsToVault("member", 100_000);
    const q = await sellSwarmForCredits("member", 1);
    expect(q.out).toBe(99);
    expect(credits.award).toHaveBeenCalledWith("member", 99, "Market Vault: sold 1 SWARM for 99 credits");
    expect(state.added.some(tx => tx.type === "token_transfer" && tx.from === "member" && tx.to === "community-pool" && tx.amount === 1)).toBe(true);
    expect(vaultCreditReserve(state.added)).toBe(100_000 - 99);
  });
});
