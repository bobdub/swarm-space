/**
 * The bar tab — drinks bought at the counter of The Green Cat & Red Dragon.
 *
 * A drink is paid in SWARM into the same Market Vault as a Support the Vault
 * donation: an ordinary signed `pool_donate`, so the vault balance, peer
 * gossip and the signature checks are exactly the same. What sets it apart is
 * the signed `barTab` marker in its meta, which names the drink and how many.
 *
 * Drinks are their own record and their own game. They never count on the
 * Donor Leaderboard (`donationFromTx` skips them), and this tab never counts
 * a plain donation. Every peer folds the same ledger, so every peer pours the
 * same tab.
 */
import type { SwarmTransaction } from "../types";

/** The Market Vault's ledger account, as a pool donation names it. */
const VAULT = "community-pool";

/** Version of the signed `barTab` marker. */
export const BAR_TAB_VERSION = 1;

/** Most drinks one order can pour. */
export const MAX_DRINKS_PER_ORDER = 6;

export interface BarDrink {
  id: string;
  name: string;
  /** Price of one, in SWARM. */
  price: number;
  /** One line for the menu. */
  blurb: string;
  emoji: string;
}

/** What's behind the bar, cheapest first. Prices are in SWARM. */
export const DRINKS_MENU: readonly BarDrink[] = [
  { id: "spring-water", name: "Spring Water", price: 0.5, blurb: "Drawn from the village pond. Mostly.", emoji: "💧" },
  { id: "green-cat-ale", name: "Green Cat Ale", price: 1, blurb: "The house pale. Light, hoppy, faintly purring.", emoji: "🍺" },
  { id: "orchard-cider", name: "Orchard Cider", price: 1.5, blurb: "Cloudy, crisp and a touch too easy.", emoji: "🍏" },
  { id: "red-dragon-stout", name: "Red Dragon Stout", price: 2, blurb: "Dark as the crater, warm as the vent.", emoji: "🐉" },
  { id: "honey-mead", name: "Hive Honey Mead", price: 3, blurb: "Brewed from the hive out back.", emoji: "🍯" },
  { id: "dragonfire-whisky", name: "Dragonfire Whisky", price: 5, blurb: "A single measure. Sip it slowly.", emoji: "🥃" },
] as const;

export function findDrink(id: string): BarDrink | undefined {
  return DRINKS_MENU.find((d) => d.id === id);
}

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

/** The SWARM an order of `qty` of `drink` costs. */
export function orderCost(drink: BarDrink, qty: number): number {
  return round6(drink.price * qty);
}

/** The signed meta a drink order carries on its `pool_donate`. */
export function barTabMeta(drink: BarDrink, qty: number): Record<string, unknown> {
  return { barTab: BAR_TAB_VERSION, drink: drink.id, drinkName: drink.name, qty };
}

export interface BarOrder {
  txId: string;
  drinkId: string;
  /** The drink's name as it was ordered (menus change; the record doesn't). */
  name: string;
  qty: number;
  /** SWARM paid into the vault. */
  amount: number;
  at: string;
}

/** True when `tx` carries the bar tab marker, well formed or not. Such a tx is never a leaderboard donation. */
export function isBarTabTx(tx: Pick<SwarmTransaction, "meta"> | null | undefined): boolean {
  return tx?.meta?.barTab !== undefined && tx.meta.barTab !== null && tx.meta.barTab !== false;
}

/** The drink order `tx` paid for, when it is one, else null. */
export function barOrderFromTx(tx: SwarmTransaction): BarOrder | null {
  if (!tx || tx.type !== "pool_donate" || tx.to !== VAULT || !tx.from || tx.from === "system") return null;
  if (!isBarTabTx(tx)) return null;
  const amount = Number(tx.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const drinkId = typeof tx.meta?.drink === "string" ? tx.meta.drink.trim().slice(0, 48) : "";
  if (!drinkId) return null;
  const rawQty = Number(tx.meta?.qty);
  const qty = Number.isSafeInteger(rawQty) && rawQty > 0 ? Math.min(rawQty, MAX_DRINKS_PER_ORDER) : 1;
  const named = typeof tx.meta?.drinkName === "string" ? tx.meta.drinkName.trim().slice(0, 40) : "";
  const name = named || findDrink(drinkId)?.name || drinkId;
  return { txId: tx.id, drinkId, name, qty, amount, at: tx.timestamp };
}

export interface PatronRecord {
  userId: string;
  /** Drinks poured for this patron, counting each one in a multi-drink order. */
  drinks: number;
  /** Orders placed at the counter. */
  orders: number;
  /** SWARM this patron has paid into the vault at the bar. */
  spent: number;
  /** Drinks poured per drink id. */
  byDrink: Record<string, number>;
  /** The patron's usual: the drink they've had most (latest wins a tie). */
  usual: { drinkId: string; name: string; count: number } | null;
  firstAt: string;
  lastAt: string;
  /** Every order, newest first. */
  history: BarOrder[];
}

export interface BarTab {
  /** Everyone who has drunk here, most recent first. */
  patrons: PatronRecord[];
  drinksPoured: number;
  /** SWARM paid into the vault across every drink. */
  takings: number;
  orderCount: number;
}

/** Fold the ledger into the bar tab. Duplicate tx ids count once. */
export function buildBarTab(txs: Iterable<SwarmTransaction>): BarTab {
  const seen = new Set<string>();
  const byPatron = new Map<string, PatronRecord>();
  const names = new Map<string, string>();
  const lastOf = new Map<string, Map<string, string>>();
  let drinksPoured = 0;
  let takings = 0;
  let orderCount = 0;
  for (const tx of txs) {
    if (!tx || seen.has(tx.id)) continue;
    const order = barOrderFromTx(tx);
    if (!order) continue;
    seen.add(tx.id);
    orderCount++;
    drinksPoured += order.qty;
    takings += order.amount;
    const rec = byPatron.get(tx.from) ?? {
      userId: tx.from, drinks: 0, orders: 0, spent: 0, byDrink: {}, usual: null, firstAt: order.at, lastAt: order.at, history: [],
    };
    rec.drinks += order.qty;
    rec.orders++;
    rec.spent = round6(rec.spent + order.amount);
    rec.byDrink[order.drinkId] = (rec.byDrink[order.drinkId] ?? 0) + order.qty;
    if (order.at < rec.firstAt) rec.firstAt = order.at;
    if (order.at > rec.lastAt) rec.lastAt = order.at;
    rec.history.push(order);
    byPatron.set(tx.from, rec);
    if (!names.has(order.drinkId)) names.set(order.drinkId, order.name);
    const last = lastOf.get(tx.from) ?? new Map<string, string>();
    if (order.at > (last.get(order.drinkId) ?? "")) last.set(order.drinkId, order.at);
    lastOf.set(tx.from, last);
  }
  for (const rec of byPatron.values()) {
    rec.history.sort((a, b) => b.at.localeCompare(a.at) || a.txId.localeCompare(b.txId));
    const last = lastOf.get(rec.userId);
    let best: PatronRecord["usual"] = null;
    for (const [drinkId, count] of Object.entries(rec.byDrink)) {
      const at = last?.get(drinkId) ?? "";
      const bestAt = best ? last?.get(best.drinkId) ?? "" : "";
      if (!best || count > best.count || (count === best.count && at > bestAt)) {
        best = { drinkId, name: findDrink(drinkId)?.name ?? names.get(drinkId) ?? drinkId, count };
      }
    }
    rec.usual = best;
  }
  // A tab, not a ranking: whoever drank most recently is at the top.
  const patrons = [...byPatron.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.userId.localeCompare(b.userId));
  return { patrons, drinksPoured, takings: round6(takings), orderCount };
}

/** Read the bar tab from the local copy of the shared ledger (mined blocks + pending mesh txs). */
export async function loadBarTab(): Promise<BarTab> {
  const { getSwarmChain } = await import("../chain");
  const chain = getSwarmChain();
  await chain.whenReady();
  return buildBarTab([
    ...chain.getChain().flatMap((b) => b.transactions ?? []),
    ...chain.getPendingTransactions(),
  ]);
}

/** "3 drinks" / "1 drink". */
export function formatDrinkCount(n: number): string {
  return `${n.toLocaleString()} drink${n === 1 ? "" : "s"}`;
}

/** "2.5 SWARM". */
export function formatSwarm(n: number): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })} SWARM`;
}
