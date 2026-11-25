import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SwarmTransaction } from "../types";

const state = vi.hoisted(() => ({
  txs: [] as SwarmTransaction[], pool: null as null | Record<string, unknown>,
  user: null as null | { id: string; publicKey: string }, privateKey: null as null | string,
}));
vi.mock("../../auth", () => ({ getCurrentUser: () => state.user, getCachedPrivateKey: async () => state.privateKey }));
vi.mock("../chain", () => ({ getSwarmChain: () => ({
  whenReady: async () => {},
  addTransaction: (tx: SwarmTransaction) => state.txs.push(tx),
  getChain: () => [], getPendingTransactions: () => state.txs,
}) }));
vi.mock("../token", () => ({
  getSwarmBalance: async () => 100,
  mintSwarm: async (p: { to: string; amount: number }) => state.txs.push({ ...p, from: "system", type: "token_mint" } as SwarmTransaction),
  burnSwarm: async (p: { from: string; amount: number }) => state.txs.push({ ...p, type: "token_burn" } as SwarmTransaction),
}));
vi.mock("../storage", async (original) => ({
  ...await original<object>(),
  getRewardPool: async () => state.pool,
  saveRewardPool: async (pool: Record<string, unknown>) => { state.pool = pool; },
  derivePoolFromChain: async () => { state.pool = { balance: state.txs.filter(tx => tx.type === "pool_donate").reduce((sum, tx) => sum + (tx.amount ?? 0), 0) }; },
}));
vi.mock("@/lib/store", () => ({ getAll: async () => [], put: async () => {} }));
vi.mock("../coinWrap", () => ({ createEmptyPoolCoin: () => ({ coinId: "test" }) }));
import { donateToRewardPool } from "../creditWrapping";
import { rewardTransactionProcessing } from "../miningRewards";
import { poolDeltaFromTx } from "../storage";
import { loadDonorLeaderboard } from "../infinity/donorLeaderboard";
import { verifyPoolDonation } from "../wallets/tipSignature";
import { arrayBufferToBase64, computeUserId } from "@/lib/crypto";

let member = "";
async function signIn() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = arrayBufferToBase64(await crypto.subtle.exportKey("spki", pair.publicKey));
  state.privateKey = arrayBufferToBase64(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  member = await computeUserId(publicKey);
  state.user = { id: member, publicKey };
}

beforeEach(async () => { state.txs = []; state.pool = null; await signIn(); });
describe("Market Vault donations", () => {
  it("moves a 10 SWARM donation once, without burning another 10", async () => {
    await donateToRewardPool(member, 10);
    expect(state.txs.filter(tx => tx.from === member).reduce((sum, tx) => sum + (tx.amount ?? 0), 0)).toBe(10);
    expect(state.txs.some(tx => tx.type === "token_burn")).toBe(false);
    expect(state.txs.find(tx => tx.type === "pool_donate")).toMatchObject({ to: "community-pool", amount: 10 });
    expect(state.pool?.balance).toBe(10);
  });

  it("puts a Support the Vault donor on the donor leaderboard", async () => {
    await donateToRewardPool(member, 10);
    const board = await loadDonorLeaderboard();
    expect(board.donors).toMatchObject([{ userId: member, amounts: { SWARM: 10 }, donations: 1 }]);
    expect(board.totals).toEqual({ SWARM: 10 });
  });

  it("signs the donation with the donor's identity key so peers can verify it", async () => {
    await donateToRewardPool(member, 10);
    const tx = state.txs.find(t => t.type === "pool_donate")!;
    expect(await verifyPoolDonation(tx)).toBe(true);
    expect(await verifyPoolDonation({ ...tx, amount: 1000 })).toBe(false);
    expect(await verifyPoolDonation({ ...tx, from: "0123456789abcdef" })).toBe(false);
    expect(await verifyPoolDonation({ ...tx, signature: "" })).toBe(false);
  });

  it("refuses to donate while the wallet is locked", async () => {
    state.privateKey = null;
    await expect(donateToRewardPool(member, 10)).rejects.toThrow(/locked/);
    expect(state.txs).toEqual([]);
  });
});
describe("community funding rules", () => {
  it("credits 5% of 10 SWARM confirmed mining work to the Market Vault", async () => {
    await rewardTransactionProcessing("member", 100);
    expect(state.txs.find(tx => tx.type === "pool_donate")).toMatchObject({ amount: 0.5, to: "community-pool", meta: { marketVaultFunding: "swarm-mining" } });
    expect(state.txs.find(tx => tx.type === "token_mint")).toMatchObject({ to: "member", amount: 9.5 });
  });
  it("counts a sale's 10 SWARM pool inflow but not its token payout", () => {
    const base = { id: "sale", type: "token_transfer", from: "member", to: "community-pool", amount: 10, meta: { marketVault: true, direction: "vault-sell" } } as SwarmTransaction;
    expect(poolDeltaFromTx(base)).toBe(10);
    expect(poolDeltaFromTx({ ...base, type: "custom_token_transfer", from: "community-pool", to: "member" })).toBe(0);
  });
  it("counts the pool's block-reward output by its amount, with or without poolTax metadata", () => {
    const reward = { id: "r", type: "mining_reward", from: "system", to: "community-pool", amount: 2.5 } as SwarmTransaction;
    expect(poolDeltaFromTx(reward)).toBe(2.5);
    expect(poolDeltaFromTx({ ...reward, meta: { poolTax: 2.5 } })).toBe(2.5);
    expect(poolDeltaFromTx({ ...reward, to: "miner", amount: 47.5 })).toBe(0);
  });
});