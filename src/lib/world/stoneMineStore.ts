/**
 * stoneMineStore — how close a granite boulder is to breaking apart.
 *
 * The stone twin of `treeChopStore`: each accepted Stone Pick bite adds a
 * hit, the boulder jolts and visibly chips smaller, and once the hit count
 * reaches the threshold it cracks apart into loose stone on the ground.
 * The cut predicate itself still lives in `applyImpact` (sculpting), so
 * bond/curvature rules are unchanged.
 *
 * In-memory only — a half-mined boulder is a moment, not a saved fact.
 */
export const HITS_TO_BREAK = 5;
/** How long the crack-apart animation runs before the block is removed. */
export const BREAK_MS = 900;

export interface StoneMineState {
  blockId: string;
  hits: number;
  /** Timestamp of the most recent hit — drives the jolt. */
  lastHitAt: number;
  /** Set once the boulder starts breaking apart. */
  brokenAt?: number;
}

type Listener = (states: Map<string, StoneMineState>) => void;

const states = new Map<string, StoneMineState>();
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) {
    try { fn(states); } catch { /* noop */ }
  }
}

export function getStoneMine(blockId: string): StoneMineState | undefined {
  return states.get(blockId);
}

/** Register one accepted pick bite. Returns the state after the hit. */
export function registerStoneHit(blockId: string): StoneMineState {
  const cur = states.get(blockId);
  // A breaking boulder takes no more bites — otherwise every swing during
  // the crack-apart would break it again and scatter another round.
  if (cur?.brokenAt) return cur;
  const next: StoneMineState = {
    blockId,
    hits: (cur?.hits ?? 0) + 1,
    lastHitAt: Date.now(),
    brokenAt: cur?.brokenAt,
  };
  if (!next.brokenAt && next.hits >= HITS_TO_BREAK) next.brokenAt = Date.now();
  states.set(blockId, next);
  notify();
  return next;
}

/** True once the boulder has started breaking apart (until it is cleared). */
export function isStoneBroken(blockId: string): boolean {
  return Boolean(getStoneMine(blockId)?.brokenAt);
}

export function clearStoneMine(blockId: string): void {
  if (!states.delete(blockId)) return;
  notify();
}

export function subscribeStoneMine(fn: Listener): () => void {
  listeners.add(fn);
  try { fn(states); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}

export function _resetStoneMineForTest(): void {
  states.clear();
  listeners.clear();
}
