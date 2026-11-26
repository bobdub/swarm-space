import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  lock: vi.fn(), release: vi.fn(), deduct: vi.fn(), refund: vi.fn(), saveToken: vi.fn(),
  addTransaction: vi.fn(), saveVault: vi.fn(), addHolding: vi.fn(), existing: null as unknown,
  credits: 10_000, swarm: 0, creditRead: vi.fn(), swarmRead: vi.fn(),
  // Live Market Vault quote for the launch's 100 SWARM; the app never charges below 10,000 Credits.
  marketQuote: { credits: 10_000, error: null as string | null },
}));
vi.mock("../storage", () => ({
  getProfileToken: async () => state.existing,
  saveProfileToken: state.saveToken,
  derivePoolFromChain: async () => ({}),
}));
vi.mock("@/lib/credits", () => ({ getCreditBalance: async () => { state.creditRead(); return state.credits; }, deductCredits: state.deduct, awardVaultCredits: state.refund }));
vi.mock("../token", () => ({ getSwarmBalance: async () => { state.swarmRead(); return state.swarm; } }));
vi.mock("../creatorVaultCustody", () => ({ lockIntoCreatorVault: state.lock, releaseFromCreatorVault: state.release }));
vi.mock("../chain", () => ({ getSwarmChain: () => ({ addTransaction: state.addTransaction }) }));
vi.mock("../crypto", () => ({ generateTokenId: () => "new-token", generateTransactionId: () => "deploy-tx" }));
vi.mock("../creatorVault", () => ({
  ensureCreatorVault: async () => ({ buybackReserve: 0, stabilityFloor: 0, creatorEarnings: 0, communityContributed: 0, totalDeposited: 0, circulatingSupply: 0 }),
  saveCreatorVault: state.saveVault, computeTier: () => 1,
}));
// Deployment rechecks the live Market Vault price before payment; keep it off the real chain.
vi.mock("../marketVault", () => ({ getMarketVaultState: async () => ({ poolBalance: 1_000_000, knownMined: 1_000_000 }) }));
vi.mock("../marketVaultPricing", () => ({ quoteVaultBuy: (_state: unknown, swarm: number) => ({ swarm, avgCreditsPerSwarm: state.marketQuote.credits / swarm, maxSwarm: swarm, ...state.marketQuote }) }));
vi.mock("../profileTokenBalance", () => ({ addProfileTokens: state.addHolding }));
vi.mock("../profileTokenUnlock", () => ({ recordTokenDeploymentCredits: async () => {} }));
vi.mock("@/lib/p2p/swarmMesh.standalone", () => ({ getSwarmMeshStandalone: () => ({ broadcastMarketSnapshot: async () => {} }) }));

import { deployProfileToken } from "../profileToken";
const input = { userId: "creator", name: "Creator", ticker: "CRT" };

beforeEach(() => { vi.clearAllMocks(); state.existing = null; state.credits = 10_000; state.swarm = 0; state.marketQuote = { credits: 10_000, error: null }; state.lock.mockResolvedValue(undefined); state.deduct.mockResolvedValue(undefined); });
describe("Market deployment ordering", () => {
  it("invalid ticker cannot consume credits, custody or create a token", async () => {
    await expect(deployProfileToken({ ...input, ticker: "bad" })).rejects.toThrow("Ticker");
    expect(state.deduct).not.toHaveBeenCalled();
    expect(state.lock).not.toHaveBeenCalled();
    expect(state.saveToken).not.toHaveBeenCalled();
  });
  it("custody failure returns all 10,000 Credits and does not publish deployment", async () => {
    state.lock.mockRejectedValueOnce(new Error("Custody unavailable"));
    await expect(deployProfileToken(input)).rejects.toThrow("Custody unavailable");
    expect(state.deduct).toHaveBeenCalledWith("creator", 10_000, "Creator Token Deployment");
    expect(state.refund).toHaveBeenCalledWith("creator", 10_000, "Creator Token deployment refund");
    expect(state.saveToken).not.toHaveBeenCalled();
    expect(state.addTransaction).not.toHaveBeenCalled();
    expect(state.addHolding).not.toHaveBeenCalled();
  });
  it("failed Credit payment releases no pool SWARM", async () => {
    state.deduct.mockRejectedValueOnce(new Error("Credits unavailable"));
    await expect(deployProfileToken(input)).rejects.toThrow("Credits unavailable");
    expect(state.lock).not.toHaveBeenCalled();
    expect(state.saveToken).not.toHaveBeenCalled();
    expect(state.addTransaction).not.toHaveBeenCalled();
  });
  it("10,000 Credits launch the 10,000-token market with zero user SWARM", async () => {
    await deployProfileToken(input);
    expect(state.swarmRead).not.toHaveBeenCalled();
    expect(state.lock).toHaveBeenCalledWith(expect.objectContaining({ fromId: "community-pool", creditsLocked: 10_000, amount: 100, split: { buyback: 40, stability: 40, creator: 15, community: 5 } }));
    expect(state.deduct).toHaveBeenCalledWith("creator", 10_000, "Creator Token Deployment");
    expect(state.saveToken).toHaveBeenCalledWith(expect.objectContaining({ maxSupply: 10_000 }));
    expect(state.saveVault).toHaveBeenCalledWith(expect.objectContaining({ buybackReserve: 40, stabilityFloor: 40, creatorEarnings: 15, communityContributed: 5 }));
    expect(state.addTransaction).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ seedSwarm: 100, paymentAsset: "credits", paidAmount: 10_000 }) }));
  });
  it("100 SWARM launch with zero Credits and never debit Credits", async () => {
    state.credits = 0; state.swarm = 100;
    await deployProfileToken({ ...input, paymentAsset: "swarm" });
    expect(state.creditRead).not.toHaveBeenCalled();
    expect(state.deduct).not.toHaveBeenCalled();
    expect(state.lock).toHaveBeenCalledWith(expect.objectContaining({ fromId: "creator", amount: 100 }));
    expect(state.lock.mock.calls[0][0]).not.toHaveProperty("creditsLocked");
    expect(state.addTransaction).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ paymentAsset: "swarm", paidAmount: 100 }) }));
  });
  it("9,999 Credits cannot pay for deployment even with enough SWARM", async () => {
    state.credits = 9_999; state.swarm = 100;
    await expect(deployProfileToken({ ...input, paymentAsset: "credits" })).rejects.toThrow("10000 Credits");
    expect(state.lock).not.toHaveBeenCalled();
    expect(state.deduct).not.toHaveBeenCalled();
  });
  it("a dearer live Market Vault price raises the Credit cost before anything is charged", async () => {
    state.marketQuote = { credits: 14_000, error: null };
    await expect(deployProfileToken({ ...input, paymentAsset: "credits" })).rejects.toThrow("14000 Credits");
    expect(state.deduct).not.toHaveBeenCalled();
    expect(state.lock).not.toHaveBeenCalled();
  });
  it("99 SWARM cannot pay for deployment even with enough Credits", async () => {
    state.swarm = 99;
    await expect(deployProfileToken({ ...input, paymentAsset: "swarm" })).rejects.toThrow("100 SWARM");
    expect(state.lock).not.toHaveBeenCalled();
  });
  it("Creator launch price remains 10,000 Credits or 100 SWARM as the pool grows", async () => {
    const { getDeployPricing } = await import("../deployPricing");
    const pricing = await getDeployPricing();
    expect(pricing.creatorTokenCredits).toBe(10_000);
    expect(pricing.creatorTokenSwarm).toBe(100);
  });
});