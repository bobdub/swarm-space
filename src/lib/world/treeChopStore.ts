/**
 * treeChopStore — how far along a tree is to falling.
 *
 * Chopping is not a one-swing delete: each accepted cut adds a hit, the
 * trunk shakes, and once the hit count passes the tree's threshold the
 * trunk topples, drops wood and the stump fades out. The store holds only
 * the *visual* progress; the cut predicate itself still lives in
 * `applyImpact` (sculpting), so bond/curvature rules are unchanged.
 *
 * In-memory only — a half-chopped tree is a moment, not a saved fact.
 */
export const HITS_TO_FELL = 4;
/** How long the topple animation runs before the stump starts fading. */
export const TOPPLE_MS = 1400;
/** How long the stump lingers after the trunk lands. */
export const STUMP_FADE_MS = 2600;

export interface TreeChopState {
  blockId: string;
  hits: number;
  /** Timestamp of the most recent hit — drives the shake. */
  lastHitAt: number;
  /** Set once the tree starts falling. */
  toppledAt?: number;
}

type Listener = (states: Map<string, TreeChopState>) => void;

const states = new Map<string, TreeChopState>();
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) {
    try { fn(states); } catch { /* noop */ }
  }
}

export function getTreeChop(blockId: string): TreeChopState | undefined {
  return states.get(blockId);
}

/** Register one accepted cut. Returns the state after the hit. */
export function registerTreeHit(blockId: string): TreeChopState {
  const cur = states.get(blockId);
  const next: TreeChopState = {
    blockId,
    hits: (cur?.hits ?? 0) + 1,
    lastHitAt: Date.now(),
    toppledAt: cur?.toppledAt,
  };
  if (!next.toppledAt && next.hits >= HITS_TO_FELL) next.toppledAt = Date.now();
  states.set(blockId, next);
  notify();
  return next;
}

export function clearTreeChop(blockId: string): void {
  if (!states.delete(blockId)) return;
  notify();
}

export function subscribeTreeChop(fn: Listener): () => void {
  listeners.add(fn);
  try { fn(states); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}

export function _resetTreeChopForTest(): void {
  states.clear();
  listeners.clear();
}
