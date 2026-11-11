import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SwarmTransaction } from "../types";

const state = vi.hoisted(() => ({ txs: [] as SwarmTransaction[], pool: null as null | Record<string, unknown> }));
vi.mock("../chain", () => ({ getSwarmChain: () => ({
  whenReady: async () => {},
  addTransaction: (tx: SwarmTransaction) => state.txs.push(tx),
  getChain: () => [], getPendingTransactions: () => state.txs,
}) }));
vi.mock("../token", () => ({
  getSwarmBalance: async () => 100,
  burnSwarm: async (p: { from: string; amount: number }) => state.txs.push({ ...p, type: "token_burn" } as SwarmTransaction),
}));
vi.mock("../storage", async (original) => ({
  ...await original<object>(),
  getRewardPool: async () => state.pool,
  saveRewardPool: async (pool: Record<string, unknown>) => { state.pool = pool; },
  derivePoolFromChain: async () => { state.pool = { balance: state.txs.filter(tx => tx.type === "pool_donate").reduce((sum, tx) => sum + (tx.amount ?? 0), 0) }; },
}));
vi.mock("@/lib/store", () => ({ getAll: async () => [] }));
vi.mock("../coinWrap", () => ({ createEmptyPoolCoin: () => ({ coinId: "test" }) }));
import { donateToRewardPool } from "../creditWrapping";
import { rewardTransactionProcessing } from "../miningRewards";
import { poolDeltaFromTx } from "../storage";

beforeEach(() => { state.txs = []; state.pool = null; });
describe("Market Vault donations", () => {
  it("moves a 10 SWARM donation once, without burning another 10", async () => {
    await donateToRewardPool("member", 10);
    expect(state.txs.filter(tx => tx.from === "member").reduce((sum, tx) => sum + (tx.amount ?? 0), 0)).toBe(10);
    expect(state.txs.some(tx => tx.type === "token_burn")).toBe(false);
    expect(state.txs.find(tx => tx.type === "pool_donate")).toMatchObject({ to: "community-pool", amount: 10 });
    expect(state.pool?.balance).toBe(10);
  });
});
describe("community funding rules", () => {
  it("credits 5% of 10 SWARM confirmed mining work to the Market Vault", async () => {
    await rewardTransactionProcessing("member", 100);
    expect(state.txs.find(tx => tx.type === "pool_donate")).toMatchObject({ amount: 0.5, to: "community-pool", meta: { marketVaultFunding: "swarm-mining" } });
  });
  it("counts a sale's 10 SWARM pool inflow but not its token payout", () => {
    const base = { id: "sale", type: "token_transfer", from: "member", to: "community-pool", amount: 10, meta: { marketVault: true, direction: "vault-sell" } } as SwarmTransaction;
    expect(poolDeltaFromTx(base)).toBe(10);
    expect(poolDeltaFromTx({ ...base, type: "custom_token_transfer", from: "community-pool", to: "member" })).toBe(0);
  });
});