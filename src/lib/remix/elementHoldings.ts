/**
 * elementHoldings — predicate scaffolding for "holdings-gated" elements.
 *
 * SCAFFOLD STAGE — pure logic, no wallet wiring yet. Implements the rules
 * laid out in the source-of-truth:
 *
 *   • Gold (Au)   — locked unless the user holds a non-zero balance of
 *                   the Gold token. A creation may not consume more Au
 *                   atoms than the user holds in liquid form.
 *   • Carbon (C)  — always unlocked. Diamond is compressed carbon, so the
 *                   element itself stays freely available.
 *   • Once an element is held, it stays unlocked (sticky unlock) — this
 *                   matches the "Once held element stays unlocked" rule.
 *
 * The wallet bridge wires `getLiquidHolding(symbol)` in a follow-up.
 */

/** Symbols that require a non-zero on-chain holding to use. */
export const HOLDING_GATED_SYMBOLS: ReadonlySet<string> = new Set(['Au']);

/** Symbols that are explicitly always unlocked, regardless of holdings. */
export const ALWAYS_UNLOCKED_SYMBOLS: ReadonlySet<string> = new Set(['C']);

/**
 * In-memory sticky unlock log. Once a symbol has been observed as "held"
 * during a session it stays unlocked even if the balance later drops to
 * zero (the user has demonstrated possession).
 */
const UNLOCKED_ONCE: Set<string> = new Set();

/** Holding lookup — returns liquid units of `symbol` the caller holds. */
export type HoldingLookup = (symbol: string) => number;

const NULL_LOOKUP: HoldingLookup = () => 0;
let _lookup: HoldingLookup = NULL_LOOKUP;

/** Wire a real holding source (wallet bridge) — call once at boot. */
export function setHoldingLookup(fn: HoldingLookup | null): void {
  _lookup = fn ?? NULL_LOOKUP;
}

/** Returns true when `symbol` is currently usable in the Lab/Builder. */
export function isElementUnlocked(symbol: string): boolean {
  if (ALWAYS_UNLOCKED_SYMBOLS.has(symbol)) return true;
  if (!HOLDING_GATED_SYMBOLS.has(symbol)) return true;
  if (UNLOCKED_ONCE.has(symbol)) return true;
  const held = _lookup(symbol);
  if (held > 0) {
    UNLOCKED_ONCE.add(symbol);
    return true;
  }
  return false;
}

/**
 * Cap the number of atoms of `symbol` that may be consumed in a single
 * creation. For non-gated symbols this is +Infinity. For gated symbols it
 * is the current liquid holding rounded down.
 */
export function maxConsumable(symbol: string): number {
  if (!HOLDING_GATED_SYMBOLS.has(symbol)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(_lookup(symbol)));
}

/** Test seam — clear sticky-unlock state between unit tests. */
export function _resetHoldingsForTest(): void {
  UNLOCKED_ONCE.clear();
  _lookup = NULL_LOOKUP;
}