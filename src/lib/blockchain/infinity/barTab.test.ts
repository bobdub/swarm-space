import { describe, expect, it } from "vitest";
import type { SwarmTransaction } from "../types";
import { barOrderFromTx, barTabMeta, buildBarTab, DRINKS_MENU, findDrink, foldMinedBarOrders, isBarTabTx, orderCost } from "./barTab";
import { buildDonorLeaderboard } from "./donorLeaderboard";
import { drinkChatLine } from "@/lib/pub/drinks";

const stout = findDrink("red-dragon-stout")!;
const ale = findDrink("green-cat-ale")!;

const tx = (p: Partial<SwarmTransaction>): SwarmTransaction => ({
  id: crypto.randomUUID(), type: "pool_donate", from: "alice", to: "community-pool", amount: 1,
  timestamp: "2026-11-26T12:00:00Z", signature: "", publicKey: "", nonce: 0, fee: 0, ...p,
});

const drink = (from: string, d = ale, qty = 1, timestamp = "2026-11-26T12:00:00Z") =>
  tx({ from, amount: orderCost(d, qty), timestamp, meta: { ...barTabMeta(d, qty), marketVaultFunding: "donation" } });

describe("bar tab", () => {
  it("reads a drink order from its signed marker", () => {
    expect(barOrderFromTx(drink("alice", stout, 2))).toMatchObject({ drinkId: stout.id, name: stout.name, qty: 2, amount: 4 });
    expect(barOrderFromTx(tx({ meta: { marketVaultFunding: "donation" } }))).toBeNull();
    expect(barOrderFromTx(tx({ from: "system", meta: barTabMeta(ale, 1) }))).toBeNull();
    expect(barOrderFromTx(tx({ type: "wallet_tip", meta: barTabMeta(ale, 1) }))).toBeNull();
  });

  it("keeps each patron's own record, most recent drinker first", () => {
    const tab = buildBarTab([
      drink("alice", ale, 1, "2026-11-26T10:00:00Z"),
      drink("alice", stout, 2, "2026-11-26T11:00:00Z"),
      drink("bob", ale, 3, "2026-11-26T12:00:00Z"),
      tx({ from: "carol", amount: 50 }), // a plain donation is not a drink
    ]);
    expect(tab.patrons.map((p) => p.userId)).toEqual(["bob", "alice"]);
    const alice = tab.patrons[1];
    expect(alice).toMatchObject({ drinks: 3, orders: 2, spent: 5, byDrink: { [ale.id]: 1, [stout.id]: 2 } });
    expect(alice.usual).toMatchObject({ drinkId: stout.id, count: 2 });
    expect(alice.history.map((o) => o.drinkId)).toEqual([stout.id, ale.id]);
    expect(tab).toMatchObject({ drinksPoured: 6, orderCount: 3, takings: 8 });
  });

  it("counts a duplicated tx once", () => {
    const t = drink("alice");
    expect(buildBarTab([t, t]).drinksPoured).toBe(1);
  });

  it("never puts a drink on the Donor Leaderboard", () => {
    const board = buildDonorLeaderboard([
      drink("alice", stout, 3),
      tx({ from: "bob", amount: 10 }),
    ]);
    expect(board.donors.map((d) => d.userId)).toEqual(["bob"]);
    expect(board.totals).toEqual({ SWARM: 10 });
    expect(isBarTabTx(drink("alice"))).toBe(true);
  });

  it("has a priced menu", () => {
    expect(DRINKS_MENU.length).toBeGreaterThan(0);
    for (const d of DRINKS_MENU) expect(d.price).toBeGreaterThan(0);
  });

  it("announces a drink ordered alone at the bar", () => {
    const base = { id: "x", fromPeerId: "p", fromName: "Ada", toPeerIds: ["p"], round: false, ts: 0 };
    expect(drinkChatLine({ ...base, solo: true, drinkName: "Red Dragon Stout", qty: 1 })).toBe("🍺 Ada ordered a Red Dragon Stout at the bar.");
    expect(drinkChatLine({ ...base, solo: true, drinkName: "Green Cat Ale", qty: 2 })).toBe("🍺 Ada ordered 2 × Green Cat Ale at the bar.");
  });
});

describe("foldMinedBarOrders", () => {
  it("scans only new blocks and rescans from a replaced block", () => {
    const a = drink("alice");
    const b = drink("bob");
    const c = drink("carol");
    const first = foldMinedBarOrders([{ hash: "h0", transactions: [a, tx({})] }, { hash: "h1", transactions: [b] }], { hashes: [], orders: [] });
    expect(first.orders.flat().map((t) => t.from)).toEqual(["alice", "bob"]);
    // Same prefix: block h0 is not re-read (its cached list is reused as-is).
    const reused = foldMinedBarOrders([{ hash: "h0", transactions: [] }, { hash: "h1", transactions: [b] }, { hash: "h2", transactions: [c] }], first);
    expect(reused.orders[0]).toBe(first.orders[0]);
    expect(reused.orders.flat().map((t) => t.from)).toEqual(["alice", "bob", "carol"]);
    // A reorg replaces h1: everything from there is read again.
    const reorg = foldMinedBarOrders([{ hash: "h0", transactions: [a] }, { hash: "x1", transactions: [] }], reused);
    expect(reorg.orders.flat().map((t) => t.from)).toEqual(["alice"]);
  });
});
