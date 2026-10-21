/**
 * SWARM Market Vault pricing — pure rules, no I/O.
 * The community pool is the vault. 40% of it is a protected floor that trades
 * never touch; only the liquid 60% can be released. Prices are in Credits and
 * never drop below the base wrap rate (100 Credits = 1 SWARM).
 */
import { CREDIT_TO_SWARM_RATIO } from "./types";

export const MARKET_VAULT_FLOOR_SHARE = 0.4;
/** One trade may take at most this share of the liquid layer. */
export const MARKET_VAULT_MAX_TRADE_SHARE = 0.1;

export interface MarketVaultState {
  poolBalance: number;
  /** Mined SWARM known among this device and its connected peers. */
  knownMined: number;
}

export function marketVaultLayers(state: MarketVaultState) {
  const pool = Math.max(0, Number.isFinite(state.poolBalance) ? state.poolBalance : 0);
  const floor = pool * MARKET_VAULT_FLOOR_SHARE;
  const liquid = Math.max(0, pool - floor);
  const mined = Math.max(pool, Number.isFinite(state.knownMined) ? state.knownMined : 0);
  // Scarcity 0..1: the thinner the liquid layer against known mined supply, the dearer.
  const scarcity = mined > 0 ? 1 - liquid / mined : 1;
  return { pool, floor, liquid, scarcity: Math.min(1, Math.max(0, scarcity)) };
}

/** Credits per SWARM for the first unit (spot). */
export function spotCreditsPerSwarm(state: MarketVaultState): number {
  const { scarcity } = marketVaultLayers(state);
  return CREDIT_TO_SWARM_RATIO * (1 + scarcity);
}

export interface BuyQuote {
  swarm: number;
  credits: number;
  avgCreditsPerSwarm: number;
  maxSwarm: number;
  error: string | null;
}

/**
 * Integrated curve: price(x) = spot · (1 + x / liquid), so the average over a
 * buy of `swarm` is spot · (1 + swarm / (2·liquid)). Rounded up to whole Credits.
 */
export function quoteVaultBuy(state: MarketVaultState, swarm: number, userCredits: number): BuyQuote {
  const { liquid } = marketVaultLayers(state);
  const spot = spotCreditsPerSwarm(state);
  const tradeCap = liquid * MARKET_VAULT_MAX_TRADE_SHARE;
  // Credits throttle: what the user's engagement balance can afford at spot.
  const affordable = Math.max(0, userCredits) / spot;
  const maxSwarm = Math.floor(Math.min(tradeCap, affordable) * 1e6) / 1e6;
  const qty = Number.isFinite(swarm) && swarm > 0 ? swarm : 0;
  const avg = liquid > 0 ? spot * (1 + qty / (2 * liquid)) : spot;
  const credits = Math.ceil(qty * avg);
  let error: string | null = null;
  if (qty <= 0) error = "Enter an amount of SWARM.";
  else if (liquid <= 0) error = "The vault has no liquid SWARM above its protected floor.";
  else if (qty > tradeCap + 1e-9) error = `One trade can take at most ${tradeCap.toFixed(4)} SWARM (10% of the liquid layer).`;
  else if (credits > userCredits) error = "Not enough Credits for this amount.";
  return { swarm: qty, credits, avgCreditsPerSwarm: avg, maxSwarm, error };
}
