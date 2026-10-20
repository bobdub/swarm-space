import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  lock: vi.fn(), release: vi.fn(), deduct: vi.fn(), saveToken: vi.fn(),
  addTransaction: vi.fn(), saveVault: vi.fn(), addHolding: vi.fn(), existing: null as unknown,
}));
vi.mock("../storage", () => ({
  getProfileToken: async () => state.existing,
  saveProfileToken: state.saveToken,
  derivePoolFromChain: async () => ({}),
}));
vi.mock("@/lib/credits", () => ({ getCreditBalance: async () => 1000, deductCredits: state.deduct }));
vi.mock("../deployPricing", () => ({ getDeployPricing: async () => ({ creatorTokenCredits: 25, creatorTokenSwarm: 5 }) }));
vi.mock("../token", () => ({ getSwarmBalance: async () => 100 }));
vi.mock("../creatorVaultCustody", () => ({ lockIntoCreatorVault: state.lock, releaseFromCreatorVault: state.release }));
vi.mock("../chain", () => ({ getSwarmChain: () => ({ addTransaction: state.addTransaction }) }));
vi.mock("../crypto", () => ({ generateTokenId: () => "new-token", generateTransactionId: () => "deploy-tx" }));
vi.mock("../creatorVault", () => ({
  ensureCreatorVault: async () => ({ buybackReserve: 0, stabilityFloor: 0, creatorEarnings: 0, communityContributed: 0, totalDeposited: 0, circulatingSupply: 0 }),
  saveCreatorVault: state.saveVault, computeTier: () => 1,
}));
vi.mock("../profileTokenBalance", () => ({ addProfileTokens: state.addHolding }));
vi.mock("../profileTokenUnlock", () => ({ recordTokenDeploymentCredits: async () => {} }));
vi.mock("@/lib/p2p/swarmMesh.standalone", () => ({ getSwarmMeshStandalone: () => ({ broadcastMarketSnapshot: async () => {} }) }));

import { deployProfileToken } from "../profileToken";
const input = { userId: "creator", name: "Creator", ticker: "CRT" };

beforeEach(() => { vi.clearAllMocks(); state.existing = null; state.lock.mockResolvedValue(undefined); state.deduct.mockResolvedValue(undefined); });
describe("Market deployment ordering", () => {
  it("invalid ticker cannot consume credits, custody or create a token", async () => {
    await expect(deployProfileToken({ ...input, ticker: "bad" })).rejects.toThrow("Ticker");
    expect(state.deduct).not.toHaveBeenCalled();
    expect(state.lock).not.toHaveBeenCalled();
    expect(state.saveToken).not.toHaveBeenCalled();
  });
  it("custody failure does not charge credits or publish deployment", async () => {
    state.lock.mockRejectedValueOnce(new Error("Custody unavailable"));
    await expect(deployProfileToken(input)).rejects.toThrow("Custody unavailable");
    expect(state.deduct).not.toHaveBeenCalled();
    expect(state.saveToken).not.toHaveBeenCalled();
    expect(state.addTransaction).not.toHaveBeenCalled();
    expect(state.addHolding).not.toHaveBeenCalled();
  });
  it("failed credit payment refunds the 5 SWARM launch custody before returning", async () => {
    state.deduct.mockRejectedValueOnce(new Error("Credits unavailable"));
    await expect(deployProfileToken(input)).rejects.toThrow("Credits unavailable");
    expect(state.release).toHaveBeenCalledWith(expect.objectContaining({ amount: 5, toId: "creator", layer: "deployment-refund" }));
    expect(state.saveToken).not.toHaveBeenCalled();
    expect(state.addTransaction).not.toHaveBeenCalled();
  });
  it("successful launch keeps the configured 40/40/15/5 layers", async () => {
    await deployProfileToken(input);
    expect(state.lock).toHaveBeenCalledWith(expect.objectContaining({ amount: 5, split: { buyback: 2, stability: 2, creator: 0.75, community: 0.25 } }));
    expect(state.deduct).toHaveBeenCalledWith("creator", 25, "Creator Token Deployment");
    expect(state.saveVault).toHaveBeenCalledWith(expect.objectContaining({ buybackReserve: 2, stabilityFloor: 2, creatorEarnings: 0.75, communityContributed: 0.25 }));
  });
});