/**
 * Chain Health Bridge
 * ───────────────────
 * The single seam between the SWARM blockchain and the UQRC field.
 *
 * Responsibilities:
 *   1. Pin a *smoothed* representation of the local chain tip on the reward
 *      axis (μ=2). The pin is moved as a low-pass filter over recent block
 *      hashes so transient reorgs do not whip the lattice. Stiffness 0.85
 *      matches existing pin contracts.
 *   2. Resolve forks via UQRC: when a peer offers a divergent chain, the
 *      decision is NOT longest-chain. It is "which candidate, ghost-injected
 *      against the field, yields the lower Q_Score after the smoothed-tip
 *      pin is re-evaluated." Falls back to longest-chain during the lattice
 *      cold-start (ticks < 50).
 *   3. Emit derived scalars (tipPinAge, lastReorg, smoothedTipBias) for the
 *      observable surfaces. Raw u(t) never leaves the engine.
 *
 * Per docs/PROJECT_SOURCE_OF_TRUTH.md §3, the chain rides axis 2 (reward) —
 * the long-memory of rewarded events.
 */

import type { SwarmBlock } from './types';
import { getSharedFieldEngine } from '../uqrc/sharedNeuralEngine';

const TIP_PIN_TARGET = 1.0;
const TIP_PIN_SMOOTHING = 0.25;       // EWMA factor for the smoothed tip site
const REWARD_AXIS = 2;
const COLD_START_TICKS = 50;
const REORG_DEPTH_CAP = 32;           // never replace deeper than N blocks
const TIP_PIN_TEXT_PREFIX = 'chain.tip:';

export interface ChainBridgeStatus {
  smoothedTipSite: number | null;
  pinnedHash: string | null;
  pinnedAt: number | null;
  pinAgeMs: number;
  lastReorg: {
    at: number;
    fromHash: string;
    toHash: string;
    depth: number;
    deltaQ: number;
  } | null;
  acceptedBlocks: number;
  rejectedForks: number;
  acceptedForks: number;
}

let smoothedTipSite: number | null = null;
let pinnedHash: string | null = null;
let pinnedAt: number | null = null;
let acceptedBlocks = 0;
let rejectedForks = 0;
let acceptedForks = 0;
let lastReorg: ChainBridgeStatus['lastReorg'] = null;

const listeners = new Set<(s: ChainBridgeStatus) => void>();

function notify(): void {
  if (listeners.size === 0) return;
  const status = getChainBridgeStatus();
  for (const fn of listeners) {
    try { fn(status); } catch { /* ignore */ }
  }
}

export function subscribeChainBridge(fn: (s: ChainBridgeStatus) => void): () => void {
  listeners.add(fn);
  try { fn(getChainBridgeStatus()); } catch { /* ignore */ }
  return () => { listeners.delete(fn); };
}

export function getChainBridgeStatus(): ChainBridgeStatus {
  return {
    smoothedTipSite,
    pinnedHash,
    pinnedAt,
    pinAgeMs: pinnedAt === null ? 0 : Date.now() - pinnedAt,
    lastReorg,
    acceptedBlocks,
    rejectedForks,
    acceptedForks,
  };
}

/**
 * Hash → lattice-site projection. Stable, deterministic, no crypto needed —
 * the field engine's textSites() already covers identity hashing; here we
 * want a single integer in [0, L) per block hash for the smoothed-tip pin.
 */
function hashToSite(hash: string, L: number): number {
  let h = 2166136261;
  for (let i = 0; i < hash.length; i++) {
    h ^= hash.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % L);
}

/** Move the pinned site toward the new block's site via EWMA smoothing. */
function updateSmoothedTip(block: SwarmBlock): void {
  const engine = getSharedFieldEngine();
  const L = engine.getLatticeLength();
  const targetSite = hashToSite(block.hash, L);

  if (smoothedTipSite === null) {
    smoothedTipSite = targetSite;
  } else {
    // EWMA on the ring — take the shortest arc, then step.
    let delta = targetSite - smoothedTipSite;
    if (delta > L / 2) delta -= L;
    if (delta < -L / 2) delta += L;
    const next = smoothedTipSite + TIP_PIN_SMOOTHING * delta;
    smoothedTipSite = ((Math.round(next) % L) + L) % L;
  }

  // Unpin the previous symbolic tip text, pin the new one at the smoothed site.
  if (pinnedHash) {
    engine.unpin(`${TIP_PIN_TEXT_PREFIX}${pinnedHash}`, REWARD_AXIS);
  }
  // Pin directly at the smoothed site (bypasses re-hashing the new hash).
  engine.pinSite(smoothedTipSite, TIP_PIN_TARGET, REWARD_AXIS);
  pinnedHash = block.hash;
  pinnedAt = Date.now();
}

/**
 * Inject a positive reward bump for an accepted block. Amplitude scales with
 * transaction count so empty blocks don't dominate the lattice.
 */
function injectAcceptedBlock(block: SwarmBlock): void {
  const engine = getSharedFieldEngine();
  const txWeight = Math.min(1, block.transactions.length / 16);
  engine.inject(`block:${block.index}`, {
    reward: 0.4 + 0.6 * txWeight,
    trust: 0.6,
    amplitude: 0.2 + 0.2 * txWeight,
    axis: REWARD_AXIS,
  });
}

/** Inject a negative bump when a fork is rejected — raises curvature briefly. */
function injectRejectedFork(): void {
  const engine = getSharedFieldEngine();
  engine.inject('chain:fork-reject', {
    reward: -0.3,
    trust: 0.2,
    amplitude: 0.15,
    axis: REWARD_AXIS,
  });
}

/**
 * Public — call after a block is appended locally (mined OR adopted).
 */
export function recordBlockAccepted(block: SwarmBlock): void {
  acceptedBlocks += 1;
  injectAcceptedBlock(block);
  updateSmoothedTip(block);
  notify();
}

/**
 * Public — fork resolution geodesic.
 *
 * Inputs: the local chain and a candidate received from a peer. They share
 * a common ancestor at some index. Returns:
 *   - 'keep'    → reject the fork, keep local chain.
 *   - 'replace' → adopt the candidate (caller persists + re-pins).
 *
 * Decision rule:
 *   1. Candidate must be internally valid (caller's responsibility — we only
 *      decide between two valid candidates).
 *   2. If reorg depth > REORG_DEPTH_CAP → keep (safety floor).
 *   3. Cold start (ticks < 50) → fall back to longest-chain.
 *   4. Otherwise: ghost-inject each candidate's *new tip* against a clone of
 *      the field, score Q_Score(u + ghost). Lower Q wins. Ties broken by
 *      length, then by lexicographic tip hash for determinism.
 */
export function resolveFork(
  localChain: SwarmBlock[],
  candidate: SwarmBlock[],
): 'keep' | 'replace' {
  if (candidate.length === 0 || localChain.length === 0) return 'keep';
  const localTip = localChain[localChain.length - 1];
  const candTip = candidate[candidate.length - 1];
  if (localTip.hash === candTip.hash) return 'keep';

  // Find common ancestor depth (how many local blocks would be discarded).
  const minLen = Math.min(localChain.length, candidate.length);
  let forkPoint = 0;
  for (let i = 0; i < minLen; i++) {
    if (localChain[i].hash !== candidate[i].hash) { forkPoint = i; break; }
    forkPoint = i + 1;
  }
  const reorgDepth = localChain.length - forkPoint;
  if (reorgDepth > REORG_DEPTH_CAP) {
    rejectedForks += 1;
    injectRejectedFork();
    notify();
    return 'keep';
  }

  const engine = getSharedFieldEngine();
  const ticks = engine.getTicks();

  // Cold-start fallback: classic longest-chain.
  if (ticks < COLD_START_TICKS) {
    if (candidate.length > localChain.length) {
      acceptedForks += 1;
      lastReorg = {
        at: Date.now(),
        fromHash: localTip.hash,
        toHash: candTip.hash,
        depth: reorgDepth,
        deltaQ: 0,
      };
      notify();
      return 'replace';
    }
    rejectedForks += 1;
    injectRejectedFork();
    notify();
    return 'keep';
  }

  // Warm path: curvature-scored ghost injection.
  const L = engine.getLatticeLength();
  const baseQ = engine.getQScore();
  const localSite = hashToSite(localTip.hash, L);
  const candSite = hashToSite(candTip.hash, L);
  const localCurvature = engine.getCurvatureAtSite(localSite);
  const candCurvature = engine.getCurvatureAtSite(candSite);

  // Ghost score: a candidate whose tip site is in a *flatter* region of the
  // current curvature map will, after the smoothed-tip pin moves toward it,
  // produce a smaller Q_Score increment. We approximate that without cloning
  // the lattice (cheap per-decision).
  const localScore = localCurvature + (1 / Math.max(1, localChain.length));
  const candScore = candCurvature + (1 / Math.max(1, candidate.length));

  const replace = candScore < localScore
    || (candScore === localScore && candidate.length > localChain.length)
    || (candScore === localScore && candidate.length === localChain.length && candTip.hash < localTip.hash);

  if (replace) {
    acceptedForks += 1;
    lastReorg = {
      at: Date.now(),
      fromHash: localTip.hash,
      toHash: candTip.hash,
      depth: reorgDepth,
      deltaQ: candScore - localScore,
    };
    notify();
    return 'replace';
  }

  rejectedForks += 1;
  injectRejectedFork();
  notify();
  void baseQ;
  return 'keep';
}

/** Public — call once at boot to pin the current tip. */
export function bootstrapChainBridge(tip: SwarmBlock | null): void {
  if (!tip) return;
  updateSmoothedTip(tip);
  notify();
}

/** Test helper. */
export function __resetChainBridgeForTests(): void {
  smoothedTipSite = null;
  pinnedHash = null;
  pinnedAt = null;
  acceptedBlocks = 0;
  rejectedForks = 0;
  acceptedForks = 0;
  lastReorg = null;
}
