import { describe, expect, it } from "vitest";
import type { SwarmBlock, SwarmTransaction } from "../types";
import { sharedMarketVaultState, spendablePoolBalance, unminedVaultTransactions, type VaultLedgerSource } from "../poolLedger";
import { marketVaultLayers, spotCreditsPerSwarm } from "../marketVaultPricing";

const tx = (id: string, fields: Partial<SwarmTransaction>): SwarmTransaction =>
  ({ id, type: "pool_donate", from: "member", to: "community-pool", amount: 0, timestamp: "", signature: "", publicKey: "", nonce: 0, fee: 0, ...fields }) as SwarmTransaction;

/** A chain view whose balance is the plain sum of pool inflows and outflows, as the shared chain's would be. */
function peer(blocks: SwarmTransaction[][], pending: SwarmTransaction[] = []): VaultLedgerSource {
  const chain = blocks.map((transactions, index) => ({ index, transactions }) as SwarmBlock);
  const net = (txs: SwarmTransaction[]) => txs.reduce((sum, t) => sum + (t.to === "community-pool" ? t.amount : 0) - (t.from === "community-pool" ? t.amount : 0), 0);
  const mined = blocks.flat();
  return {
    getChain: () => chain,
    getPendingTransactions: () => pending,
    getConfirmedBalance: () => net(mined),
    getBalance: () => Math.max(0, net([...mined, ...pending])),
    getTotalSupply: () => 10_000,
  };
}

const blocks = [[tx("d1", { amount: 600 })], [tx("d2", { amount: 400 })]];
const figures = (source: VaultLedgerSource) => {
  const state = sharedMarketVaultState(source);
  const { pool, floor, liquid } = marketVaultLayers(state);
  return { pool, floor, liquid, spot: spotCreditsPerSwarm(state) };
};

describe("Market Vault figures shared by every peer", () => {
  it("match between peers on the same chain tip whatever each holds unmined", () => {
    const trader = peer(blocks, [tx("buy", { type: "credit_lock", from: "community-pool", to: "trader", amount: 5, meta: { marketVault: true, direction: "vault-buy" } })]);
    const donor = peer(blocks, [tx("gift", { amount: 50 })]);
    const legacy = peer(blocks, [tx("tax", { from: "system", amount: 3 })]);
    const idle = peer(blocks);
    expect(figures(trader)).toEqual(figures(idle));
    expect(figures(donor)).toEqual(figures(idle));
    expect(figures(legacy)).toEqual(figures(idle));
    expect(figures(idle)).toMatchObject({ pool: 1000, floor: 400, liquid: 600 });
  });

  it("pick up a trade once a block carries it", () => {
    const sale = tx("buy", { type: "credit_lock", from: "community-pool", to: "trader", amount: 5, meta: { marketVault: true } });
    expect(figures(peer([...blocks, [sale]])).pool).toBe(995);
  });

  it("still keep a device from releasing pool SWARM it has already promised", () => {
    const sale = tx("buy", { type: "credit_lock", from: "community-pool", to: "trader", amount: 5, meta: { marketVault: true } });
    expect(spendablePoolBalance(peer(blocks, [sale]))).toBe(995);
    // An unmined inflow is not spendable before peers can see it.
    expect(spendablePoolBalance(peer(blocks, [tx("gift", { amount: 50 })]))).toBe(1000);
  });

  it("counts this device's unmined vault entries but not local system top-ups", () => {
    const pending = [tx("buy", { type: "credit_lock", from: "community-pool", to: "t", amount: 1, meta: { marketVault: true } }), tx("tax", { from: "system", amount: 1 })];
    expect(unminedVaultTransactions(peer(blocks, pending)).map((t) => t.id)).toEqual(["buy"]);
  });
});
