import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SwarmTransaction } from "../types";

const state = vi.hoisted(() => ({ added: [] as SwarmTransaction[], available: 10, user: "member" as string | null }));
vi.mock("../../auth", () => ({ getCurrentUser: () => (state.user ? { id: state.user } : null) }));
vi.mock("../chain", () => ({ getSwarmChain: () => ({ addTransaction: (tx: SwarmTransaction) => state.added.push(tx) }) }));
vi.mock("../deposits/customTokens", () => ({
  getAvailableTokenBalance: () => state.available,
  tokenCurrency: (a: string) => `MINTME:${a.toLowerCase()}`,
}));

const { donateTokenToVault } = await import("../marketVault");
const contract = "0x634340447220BCAAA09A5505D71CA62B644A1A82";

describe("donating MintMe tokens to the Market Vault", () => {
  beforeEach(() => { state.added = []; state.available = 10; state.user = "member"; });

  it("moves synced Dreams into the vault's holdings", async () => {
    await donateTokenToVault("member", contract, 4);
    expect(state.added).toHaveLength(1);
    expect(state.added[0]).toMatchObject({ type: "custom_token_transfer", from: "member", to: "community-pool", amount: 4,
      meta: { currency: `MINTME:${contract.toLowerCase()}`, marketVault: true, direction: "donation" } });
  });

  it("refuses more than the synced balance, zero amounts and other accounts", async () => {
    await expect(donateTokenToVault("member", contract, 11)).rejects.toThrow("available");
    await expect(donateTokenToVault("member", contract, 0)).rejects.toThrow("above zero");
    state.user = "someone-else";
    await expect(donateTokenToVault("member", contract, 1)).rejects.toThrow("Sign in");
    expect(state.added).toHaveLength(0);
  });
});
