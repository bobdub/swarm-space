/**
 * Mining spots on the flat manifold.
 *
 * Each 30s beat is a flat strip, and every miner has its own spot on it: a
 * point on the golden-ratio (Fibonacci) lattice. A miner starts work when the
 * beat reaches its spot, so miners don't all start at the beat's first moment
 * and race each other. The earliest spot that finishes takes the beat, and the
 * other miners see its block and stand down.
 *
 * Spots come from the chain itself (the miner's place among the chain's
 * accounts), so every peer works out the same spots. Neighbouring places on a
 * golden-ratio lattice land far apart, so members never share a spot. Each beat
 * shifts everyone one step along the lattice, so the first spot moves from
 * miner to miner instead of always going to the same account.
 *
 * Spots decide when an honest miner starts work. They are not a validation
 * rule, because clocks drift and messages arrive late. The same-height
 * catch-up and fork choice still settle any two blocks mined in one beat.
 */
import { CADENCE_SPACING_MS } from "./chainCatchup";
import { tickAt } from "./blockHeader";

/** 1/φ: steps of this size around a unit strip give the Fibonacci lattice. */
const INV_PHI = (Math.sqrt(5) - 1) / 2;

/** Spots fill the first 80% of a beat, leaving the rest for proof of work and delivery. */
export const SPOT_WINDOW_MS = Math.floor(CADENCE_SPACING_MS * 0.8);

/** Places held by accounts the chain doesn't list yet start after this, so they never take a listed account's place. */
const UNLISTED_BASE = 1 << 16;

function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * An account's place on the lattice: its position among the chain's accounts
 * (sorted, so every peer agrees), or a place from its id when the chain
 * doesn't list it yet.
 */
export function spotIndex(userId: string, accounts: Iterable<string>): number {
  const sorted = [...new Set(accounts)].sort();
  const at = sorted.indexOf(userId);
  return at >= 0 ? at : UNLISTED_BASE + (hashId(userId) % UNLISTED_BASE);
}

/** How far into beat `tick` the spot for `index` sits, in ms. */
export function spotOffset(index: number, tick: number): number {
  const x = ((index + tick + 1) * INV_PHI) % 1;
  return Math.floor(x * SPOT_WINDOW_MS);
}

/** Milliseconds until the miner at `index` reaches its spot in the beat holding `ms`; 0 once it has. */
export function msUntilSpot(index: number, ms: number): number {
  const tick = tickAt(ms);
  const spotAt = tick * CADENCE_SPACING_MS + spotOffset(index, tick);
  return Math.max(0, spotAt - ms);
}
