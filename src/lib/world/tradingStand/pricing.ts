/**
 * Trading Stand pricing — pure rules, no I/O.
 *
 * A Trading Stand buys and sells gathered goods for SWARM or Credits. It
 * follows the Market Vault's liquidity layers (`marketVaultPricing.ts`):
 *   • 40% of the stand vault's SWARM (and of its Credits) is a protected
 *     floor no trade ever spends; quotes use the 60% liquid layer.
 *   • One trade may take at most 10% of that liquid layer, or 10% of a
 *     good's stock.
 *   • Credits follow the live market spot (`spotCreditsPerSwarm`), so a sale
 *     for Credits is worth exactly a sale for SWARM.
 *
 * Each good has a base value (its price when the stand holds none) and a
 * virtual reserve K. The unit price at stock s is
 *     p(s) = base · K / (s + K)
 * so a good gets dearer as the stand runs short and cheaper as players sell
 * more of it. Trades integrate that curve:
 *     buy  q from s:  base · K · ln((s + K) / (s − q + K))
 *     sell q into s:  base · K · ln((s + q + K) / (s + K))
 * A buy can take at most 10% of the stock (at least one unit while two or
 * more remain), so stock falls geometrically and never reaches zero.
 */
import {
  MARKET_VAULT_FLOOR_SHARE,
  MARKET_VAULT_MAX_TRADE_SHARE,
  marketVaultLayers,
  spotCreditsPerSwarm,
  type MarketVaultState,
} from '@/lib/blockchain/marketVaultPricing';

export { MARKET_VAULT_FLOOR_SHARE as STAND_FLOOR_SHARE, MARKET_VAULT_MAX_TRADE_SHARE as STAND_MAX_TRADE_SHARE };

export type TradingGood =
  | 'wood' | 'water' | 'stone' | 'gem' | 'food' | 'egg' | 'chicken' | 'fish' | 'shark' | 'honey' | 'fibre';
export type StandCurrency = 'SWARM' | 'CREDITS';

export interface TradingGoodSpec {
  id: TradingGood;
  label: string;
  icon: string;
  /** SWARM per unit when the stand holds none of it (the scarce price). */
  baseSwarm: number;
  /** Virtual reserve: how much stock halves the price. */
  virtualReserve: number;
}

export const TRADING_GOODS: readonly TradingGoodSpec[] = [
  { id: 'wood',  label: 'Wood',  icon: '🪵', baseSwarm: 0.02,  virtualReserve: 200 },
  { id: 'water', label: 'Water', icon: '💧', baseSwarm: 0.01,  virtualReserve: 300 },
  { id: 'stone', label: 'Stone', icon: '🪨', baseSwarm: 0.025, virtualReserve: 200 },
  { id: 'gem',   label: 'Gems',  icon: '💎', baseSwarm: 0.25,  virtualReserve: 25 },
  // `food` is the bag's Food material; at the stand it is sold as Fruit.
  { id: 'food',  label: 'Fruit', icon: '🍎', baseSwarm: 0.02,  virtualReserve: 200 },
  { id: 'egg',   label: 'Eggs',  icon: '🥚', baseSwarm: 0.03,  virtualReserve: 120 },
  { id: 'chicken', label: 'Chickens', icon: '🐔', baseSwarm: 0.09, virtualReserve: 60 },
  { id: 'fish',  label: 'Fish',  icon: '🐟', baseSwarm: 0.04,  virtualReserve: 120 },
  { id: 'shark', label: 'Sharks', icon: '🦈', baseSwarm: 0.4,  virtualReserve: 12 },
  { id: 'honey', label: 'Honey', icon: '🍯', baseSwarm: 0.05,  virtualReserve: 80 },
  { id: 'fibre', label: 'Fibre', icon: '🧵', baseSwarm: 0.015, virtualReserve: 200 },
];

const GOOD_BY_ID = new Map(TRADING_GOODS.map((g) => [g.id, g]));

export function getTradingGood(id: string): TradingGoodSpec | undefined {
  return GOOD_BY_ID.get(id as TradingGood);
}

export function isTradingGood(id: unknown): id is TradingGood {
  return typeof id === 'string' && GOOD_BY_ID.has(id as TradingGood);
}

/** A stand vault: what the stand holds, plus the market it takes its Credits spot from. */
export interface StandVaultState {
  /** SWARM the stand vault holds (the Market Vault pool for public stands). */
  swarmPool: number;
  /** Credits the stand vault holds (the Market Vault Credits reserve for public stands). */
  creditReserve: number;
  /** Whole units of each good the stand holds. */
  stock: Partial<Record<TradingGood, number>>;
  /** Live Market Vault figures, for the Credits spot rate. */
  market: MarketVaultState;
}

const clean = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
const floor6 = (n: number) => Math.floor(n * 1e6 + 1e-9) / 1e6;
const ceil6 = (n: number) => Math.ceil(n * 1e6 - 1e-9) / 1e6;

/** Floor and liquid layers of the stand's SWARM and Credits, the Market Vault's way. */
export function standLayers(state: StandVaultState) {
  const swarm = marketVaultLayers({ poolBalance: clean(state.swarmPool), knownMined: clean(state.swarmPool) });
  const credits = marketVaultLayers({ poolBalance: clean(state.creditReserve), knownMined: clean(state.creditReserve) });
  return {
    swarmFloor: swarm.floor,
    swarmLiquid: swarm.liquid,
    swarmTradeCap: swarm.liquid * MARKET_VAULT_MAX_TRADE_SHARE,
    creditFloor: credits.floor,
    creditLiquid: credits.liquid,
    creditTradeCap: Math.floor(credits.liquid * MARKET_VAULT_MAX_TRADE_SHARE),
  };
}

/** Credits per SWARM at the live market spot. */
export function standCreditsPerSwarm(state: StandVaultState): number {
  return spotCreditsPerSwarm(state.market);
}

export function stockOf(state: StandVaultState, good: TradingGood): number {
  return Math.floor(clean(state.stock[good]));
}

/** SWARM per unit at the current stock (first unit, before the curve moves). */
export function unitPriceSwarm(good: TradingGood, stock: number): number {
  const g = GOOD_BY_ID.get(good);
  if (!g) return 0;
  const s = clean(stock);
  return (g.baseSwarm * g.virtualReserve) / (s + g.virtualReserve);
}

/** Most units one buy may take: 10% of stock, at least one while two or more remain. */
export function maxBuyQty(stock: number): number {
  const s = Math.floor(clean(stock));
  if (s < 2) return 0;
  return Math.max(1, Math.floor(s * MARKET_VAULT_MAX_TRADE_SHARE));
}

export interface StandQuote {
  good: TradingGood;
  qty: number;
  currency: StandCurrency;
  /** SWARM value of the trade (paid for a buy, received for a sell). */
  swarm: number;
  /** Credits value of the trade at the live spot. */
  credits: number;
  /** What the player pays (buy) or receives (sell), in `currency`. */
  amount: number;
  /** Credits per SWARM used. */
  spot: number;
  error: string | null;
}

function validQty(qty: number): string | null {
  if (!Number.isSafeInteger(qty) || qty <= 0) return 'Enter a whole number of units.';
  return null;
}

/**
 * Player buys `qty` of `good` from the stand. Rounded up in the stand's
 * favour: SWARM to six places, Credits to whole Credits.
 */
export function quoteStandBuy(
  state: StandVaultState,
  good: TradingGood,
  qty: number,
  currency: StandCurrency,
  userBalance: number,
): StandQuote {
  const g = GOOD_BY_ID.get(good);
  const spot = standCreditsPerSwarm(state);
  const base: StandQuote = { good, qty, currency, swarm: 0, credits: 0, amount: 0, spot, error: null };
  if (!g) return { ...base, error: 'The stand does not trade this good.' };
  if (currency !== 'SWARM' && currency !== 'CREDITS') return { ...base, error: 'The stand only settles in SWARM or Credits.' };
  const qtyError = validQty(qty);
  if (qtyError) return { ...base, error: qtyError };
  const s = stockOf(state, good);
  const cap = maxBuyQty(s);
  if (cap <= 0) return { ...base, error: `The stand has no ${g.label.toLowerCase()} to sell yet.` };
  if (qty > cap) return { ...base, error: `One trade can take at most ${cap} ${g.label.toLowerCase()} (10% of the stand's stock).` };
  const K = g.virtualReserve;
  const swarm = ceil6(g.baseSwarm * K * Math.log((s + K) / (s - qty + K)));
  const credits = Math.ceil(swarm * spot - 1e-9);
  const amount = currency === 'SWARM' ? swarm : credits;
  let error: string | null = null;
  if (amount <= 0) error = 'Amount too small to price.';
  else if (!(amount <= (Number.isNaN(userBalance) ? 0 : userBalance) + 1e-9)) error = currency === 'SWARM' ? 'Not enough SWARM in your wallet.' : 'Not enough Credits.';
  return { ...base, swarm, credits, amount, error };
}

/**
 * Player sells `qty` of `good` to the stand. Rounded down in the stand's
 * favour, and paid only from the liquid layer above the protected floor.
 */
export function quoteStandSell(
  state: StandVaultState,
  good: TradingGood,
  qty: number,
  currency: StandCurrency,
  userHeld: number,
): StandQuote {
  const g = GOOD_BY_ID.get(good);
  const spot = standCreditsPerSwarm(state);
  const base: StandQuote = { good, qty, currency, swarm: 0, credits: 0, amount: 0, spot, error: null };
  if (!g) return { ...base, error: 'The stand does not trade this good.' };
  if (currency !== 'SWARM' && currency !== 'CREDITS') return { ...base, error: 'The stand only settles in SWARM or Credits.' };
  const qtyError = validQty(qty);
  if (qtyError) return { ...base, error: qtyError };
  const s = stockOf(state, good);
  const K = g.virtualReserve;
  const swarm = floor6(g.baseSwarm * K * Math.log((s + qty + K) / (s + K)));
  const credits = Math.floor(swarm * spot + 1e-9);
  const amount = currency === 'SWARM' ? swarm : credits;
  const layers = standLayers(state);
  let error: string | null = null;
  if (qty > Math.floor(clean(userHeld))) error = `You don't have ${qty} ${g.label.toLowerCase()}.`;
  else if (currency === 'SWARM' && layers.swarmLiquid <= 0) error = 'The stand vault has no liquid SWARM above its protected floor.';
  else if (currency === 'CREDITS' && layers.creditLiquid < 1) error = 'The stand vault has no liquid Credits above its protected floor.';
  else if (amount <= 0) error = 'Amount too small to receive anything.';
  else if (currency === 'SWARM' && swarm > layers.swarmTradeCap + 1e-9) {
    error = `One trade can take at most ${floor6(layers.swarmTradeCap)} SWARM (10% of the liquid layer).`;
  } else if (currency === 'CREDITS' && credits > layers.creditTradeCap) {
    error = `One trade can take at most ${layers.creditTradeCap.toLocaleString()} Credits (10% of the liquid layer).`;
  }
  return { ...base, swarm, credits, amount, error };
}

/** Live Buy and Sell prices for one unit of every good, in both currencies. */
export interface StandPriceRow {
  good: TradingGoodSpec;
  stock: number;
  buySwarm: number | null;
  buyCredits: number | null;
  sellSwarm: number;
  sellCredits: number;
}

export function standPriceBoard(state: StandVaultState): StandPriceRow[] {
  return TRADING_GOODS.map((g) => {
    const stock = stockOf(state, g.id);
    const buy = quoteStandBuy(state, g.id, 1, 'SWARM', Number.POSITIVE_INFINITY);
    const sell = quoteStandSell(state, g.id, 1, 'SWARM', 1);
    return {
      good: g,
      stock,
      buySwarm: buy.error ? null : buy.swarm,
      buyCredits: buy.error ? null : buy.credits,
      sellSwarm: sell.swarm,
      sellCredits: sell.credits,
    };
  });
}
