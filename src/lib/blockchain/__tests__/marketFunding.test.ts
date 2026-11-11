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
}));
vi.mock("@/lib/store", () => ({ getAll: async () => [] }));
import { donateToRewardPool } from "../creditWrapping";

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