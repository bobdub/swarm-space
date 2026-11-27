/**
 * Trading Stand pricing — pure rules, no I/O.
 *
 * A Trading Stand buys and sells gathered goods for SWARM or Credits. It
 * follows the Market Vault's liquidity layers (`marketVaultPricing.ts`):
 *   • 40% of the stand vault's SWARM (and of its Credits) is a protected
 *     floor no trade ever spends; quotes use the 60% liquid layer.
 *   • One sale to the stand may take at most 10% of that liquid layer.
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
 * The buy curve is path-independent: buying q units at once costs the same
 * as buying them one at a time (one-by-one can only cost a rounding hair
 * more). So a buy may take every unit but the last in one trade; capping
 * bulk buys would only make players click q times for the same result. The
 * stand always keeps its last unit, so its stock never reaches zero.
 */
import {
  CREATOR_VAULT_COMMUNITY_SHARE,
  CREATOR_VAULT_CREATOR_SHARE,
} from '@/lib/blockchain/types';
import {
  MARKET_VAULT_FLOOR_SHARE,
  MARKET_VAULT_MAX_TRADE_SHARE,
  marketVaultLayers,
  spotCreditsPerSwarm,
  type MarketVaultState,
} from '@/lib/blockchain/marketVaultPricing';

export { MARKET_VAULT_FLOOR_SHARE as STAND_FLOOR_SHARE, MARKET_VAULT_MAX_TRADE_SHARE as STAND_MAX_TRADE_SHARE };

export type TradingGood =
  | 'wood' | 'water' | 'stone' | 'gem' | 'food' | 'egg' | 'chicken' | 'fish' | 'shark' | 'honey' | 'fibre'
  | 'dirt' | 'clay' | 'gold' | 'salt';
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
  // Dug from the Earth's shells; Gold only with a Stone Pick at the vein.
  { id: 'dirt',  label: 'Dirt',  icon: '🟫', baseSwarm: 0.01,  virtualReserve: 400 },
  { id: 'clay',  label: 'Clay',  icon: '🧱', baseSwarm: 0.012, virtualReserve: 250 },
  { id: 'gold',  label: 'Gold',  icon: '🪙', baseSwarm: 0.6,   virtualReserve: 10 },
  // Shovelled from beach sand on the shore.
  { id: 'salt',  label: 'Salt',  icon: '🧂', baseSwarm: 0.015, virtualReserve: 200 },
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
  /**
   * Stock a buy may draw on, as this device's ledger shows it: mined plus this
   * device's unmined stand entries (its own stocking, sales and buys). This is
   * the Stock column the player sees; without it, buys use `stock`.
   */
  buyable?: Partial<Record<TradingGood, number>>;
  /** Live Market Vault figures, for the Credits spot rate. */
  market: MarketVaultState;
  /** Synced tokens the stand vault holds, by ledger currency (`MINTME:0x…`). */
  tokens?: Record<string, number>;
  /** Each held token's Market Vault price, in SWARM per token. */
  tokenPrices?: Record<string, number>;
  /** Display symbol of each held token. */
  tokenSymbols?: Record<string, string>;
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

/** Most units one buy may take: all but the stand's last unit. */
export function maxBuyQty(stock: number): number {
  const s = Math.floor(clean(stock));
  return s < 2 ? 0 : s - 1;
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
  // Buys price and cap on the stock the player sees, so a bulk order can take
  // whatever one-at-a-time buys could, even while a stocking awaits a block.
  const s = state.buyable ? Math.floor(clean(state.buyable[good])) : stockOf(state, good);
  const cap = maxBuyQty(s);
  if (cap <= 0) return { ...base, error: `The stand has no ${g.label.toLowerCase()} to sell yet.` };
  if (qty > cap) return { ...base, error: `The stand has ${cap} ${g.label.toLowerCase()} to sell (it keeps its last one).` };
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

/**
 * A stand is its own market, so every sale splits the way a creator market
 * buy does (`creatorVault.ts`, 40/40/15/5):
 *   • 40% buyback + 40% stability → the stand's own vault (its liquid layer
 *     and protected floor, read with the Market Vault's 40/60 layers),
 *   • 15% → the stand's owner (the creator share),
 *   • 5% → the SWARM community pool (the community share).
 */
export {
  CREATOR_VAULT_BUYBACK_SHARE as STAND_BUYBACK_SHARE,
  CREATOR_VAULT_STABILITY_SHARE as STAND_STABILITY_SHARE,
  CREATOR_VAULT_CREATOR_SHARE as STAND_OWNER_SHARE,
  CREATOR_VAULT_COMMUNITY_SHARE as STAND_COMMUNITY_SHARE,
} from '@/lib/blockchain/types';

export interface StandSplit {
  /** Paid to the stand's owner, in the trade's currency. */
  owner: number;
  /** Paid to the community pool (SWARM) or the Market's Credits reserve (Credits). */
  community: number;
  /** Paid into the stand's own vault: its buyback and stability layers. */
  vault: number;
}

/**
 * Split what a buyer pays. Owner and community parts round down (six places
 * for SWARM, whole Credits) and the vault takes the remainder, so the parts
 * always add up to the price. A stand with no known owner keeps the owner's
 * share in its vault. The owner buying at their own stand still pays the
 * full price; the settlement pays their share back.
 */
export function splitStandPayment(amount: number, currency: StandCurrency, ownerId?: string | null): StandSplit {
  const total = clean(amount);
  if (total <= 0) return { owner: 0, community: 0, vault: 0 };
  const part = (share: number) => (currency === 'CREDITS' ? Math.floor(total * share + 1e-9) : floor6(total * share));
  const owner = ownerId ? part(CREATOR_VAULT_CREATOR_SHARE) : 0;
  const community = part(CREATOR_VAULT_COMMUNITY_SHARE);
  const rest = total - owner - community;
  return { owner, community, vault: currency === 'CREDITS' ? rest : Math.round(rest * 1e6) / 1e6 };
}

// ── Trading in a token the stand holds ───────────────────────────────

const ceil8 = (n: number) => Math.ceil(n * 1e8 - 1e-9) / 1e8;
const floor8 = (n: number) => Math.floor(n * 1e8 + 1e-9) / 1e8;

/** A token held by the stand, at the main Market Vault's price for it. */
export interface StandTokenOption {
  currency: string;
  symbol: string;
  held: number;
  /** SWARM per token at the Market Vault's price. */
  swarmPerToken: number;
}

/** Tokens the stand holds that have a market price, so it can trade in them. */
export function standTokenOptions(state: StandVaultState): StandTokenOption[] {
  const out: StandTokenOption[] = [];
  for (const [currency, raw] of Object.entries(state.tokens ?? {})) {
    const held = clean(raw);
    const price = clean(state.tokenPrices?.[currency]);
    if (held <= 0 || price <= 0) continue;
    out.push({ currency, symbol: state.tokenSymbols?.[currency] ?? currency.split(':')[0], held, swarmPerToken: price });
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * SWARM value of the stand's whole liquid layer: its liquid SWARM plus each
 * held token's liquid layer valued at the Market Vault's price. Each currency
 * still pays out only from what the stand actually holds of it.
 */
export function standLiquidSwarmValue(state: StandVaultState): number {
  let total = standLayers(state).swarmLiquid;
  for (const t of standTokenOptions(state)) total += t.held * (1 - MARKET_VAULT_FLOOR_SHARE) * t.swarmPerToken;
  return floor6(total);
}

export interface StandTokenQuote extends StandQuote {
  /** Token units paid (buy) or received (sell). */
  tokenAmount: number;
  token: string;
}

/** Buy goods paying in a token the stand holds: the SWARM price at the token's market price, rounded up. */
export function quoteStandBuyToken(state: StandVaultState, good: TradingGood, qty: number, token: string, userBalance: number): StandTokenQuote {
  const swarmQuote = quoteStandBuy(state, good, qty, 'SWARM', Number.POSITIVE_INFINITY);
  const opt = standTokenOptions(state).find((t) => t.currency === token);
  const base = { ...swarmQuote, token, tokenAmount: 0 };
  if (!opt) return { ...base, error: base.error ?? 'The stand does not trade in this token.' };
  if (swarmQuote.error) return base;
  const tokenAmount = ceil8(swarmQuote.swarm / opt.swarmPerToken);
  let error: string | null = null;
  if (tokenAmount <= 0) error = 'Amount too small to price.';
  else if (tokenAmount > clean(userBalance) + 1e-9) error = `Not enough ${opt.symbol} in your wallet.`;
  return { ...base, amount: tokenAmount, tokenAmount, error };
}

/**
 * Sell goods for a token the stand holds, at the token's market price,
 * rounded down. Paid only from the token's liquid layer above the 40%
 * floor, at most 10% of that layer in one trade.
 */
export function quoteStandSellToken(state: StandVaultState, good: TradingGood, qty: number, token: string, userHeld: number): StandTokenQuote {
  // The SWARM value of the goods, without the SWARM vault's own payout limits.
  const g = GOOD_BY_ID.get(good);
  const opt = standTokenOptions(state).find((t) => t.currency === token);
  const spot = standCreditsPerSwarm(state);
  const base: StandTokenQuote = { good, qty, currency: 'SWARM', swarm: 0, credits: 0, amount: 0, spot, error: null, token, tokenAmount: 0 };
  if (!g) return { ...base, error: 'The stand does not trade this good.' };
  if (!opt) return { ...base, error: 'The stand does not trade in this token.' };
  const qtyError = validQty(qty);
  if (qtyError) return { ...base, error: qtyError };
  const s = stockOf(state, good);
  const K = g.virtualReserve;
  const swarm = floor6(g.baseSwarm * K * Math.log((s + qty + K) / (s + K)));
  const tokenAmount = floor8(swarm / opt.swarmPerToken);
  const liquid = opt.held * (1 - MARKET_VAULT_FLOOR_SHARE);
  const cap = floor8(liquid * MARKET_VAULT_MAX_TRADE_SHARE);
  let error: string | null = null;
  if (qty > Math.floor(clean(userHeld))) error = `You don't have ${qty} ${g.label.toLowerCase()}.`;
  else if (tokenAmount <= 0) error = 'Amount too small to receive anything.';
  else if (tokenAmount > cap + 1e-9) error = `One trade can take at most ${cap} ${opt.symbol} (10% of the stand's liquid ${opt.symbol}).`;
  return { ...base, swarm, credits: Math.floor(swarm * spot + 1e-9), amount: tokenAmount, tokenAmount, error };
}
