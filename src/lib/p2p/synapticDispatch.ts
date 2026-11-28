/**
 * ═══════════════════════════════════════════════════════════════════════
 * SYNAPTIC DISPATCH — lowest-resistance source order (neural map Phase 3)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * When a file's manifest or chunks can come from several open links, ask
 * the smoothest, least loaded one first. Each candidate gets a resistance:
 *
 *   R = w_lat · latency + w_fail · (1 − smoothness) + w_load · load   ∈ [0, 1]
 *
 * The weights tune themselves on this device with the UQRC update rule
 * (`src/lib/uqrc/field.ts`). They live as a 3-site ring field
 * u = (w_lat, w_fail, w_load); the flat ground state u₀ is 0.5 / 0.3 / 0.2
 * and d = u − u₀ is the learned deformation. Every time a peer is asked for
 * a manifest or chunk, how long it took to answer (or that it never did) is
 * the cost R should have predicted, and that prediction error is injected:
 *
 *   d(t+1) = d + STEP_DAMPING · (ν Δd − ℛ d + λ(ε₀) ∇∇S(d)) + η · (cost − R) · terms
 *
 * ν Δd (viscosity) keeps the three weights from tearing apart on noise, ℛ d
 * (Ricci decay) slowly relaxes them back toward the ground state when
 * outcomes stop teaching, and the injection bends them toward the terms that
 * actually forecast slow or failed asks. Each weight then stays at or above
 * SYNAPSE_WEIGHT_FLOOR and they sum to 1, so no term is ever switched off and
 * R stays in [0, 1]. The field's curvature ‖Δu‖ is reported as the weights'
 * Q-score (lower is calmer). Learned weights are device-local (localStorage)
 * and never published.
 *
 * - latency:    our own RTT to the peer (ms / 1000, capped), else the
 *               network's median report, else neutral (300 ms).
 * - smoothness: our own handshake memory, else the damped network view,
 *               else neutral 0.5. First-hand always wins.
 * - load:       the peer's own connection count from its synapse record
 *               over SYNAPSE_NODE_CAPACITY, else neutral 0.5. A busy peer
 *               reads as higher resistance, so traffic slides to resting
 *               neighbours (homeostatic capacity).
 *
 * Ordering only: it never adds or drops a candidate, never dials, never
 * changes how many requests a peer may hold, and ties keep the caller's
 * order. Bytes still move only on the existing data channels.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { getSmoothedRtt, getSmoothness, hasSynapse } from './synapseLayer';
import { ENTROPY_LAMBDA, NU_VISCOSITY, RICCI_DECAY, STEP_DAMPING, entropyHessian, laplacian, norm } from '../uqrc/field';
import {
  getNetworkSynapseView,
  getSynapseManifold,
  SYNAPSE_NETWORK_DAMPING,
  type NetworkSynapseView,
} from './synapseExchanger';

/** Links at which a peer reads as fully loaded. */
export const SYNAPSE_NODE_CAPACITY = 20;
const NEUTRAL_LATENCY_MS = 300;
const MAX_LATENCY_MS = 1_000;

export interface ResistanceWeights {
  latency: number;
  failure: number;
  load: number;
}

export const DEFAULT_RESISTANCE_WEIGHTS: Readonly<ResistanceWeights> = Object.freeze({ latency: 0.5, failure: 0.3, load: 0.2 });
/** No term drops below this share. */
export const SYNAPSE_WEIGHT_FLOOR = 0.05;
/** Strength η of each outcome injection. */
export const SYNAPSE_LEARNING_RATE = 0.02;
/** An answer this slow (or none) costs 1. */
export const SYNAPSE_OUTCOME_TIMEOUT_MS = 8_000;
const WEIGHTS_KEY = 'swarm-synaptic-weights';
const PERSIST_EVERY = 20;

let weights: ResistanceWeights | null = null;
let samples = 0;
let unsaved = 0;

/** Clamp to the floor and renormalise to sum 1 (pure — exported for tests). */
export function normalizeWeights(w: ResistanceWeights): ResistanceWeights {
  const fix = (x: number) => (Number.isFinite(x) ? Math.max(SYNAPSE_WEIGHT_FLOOR, x) : SYNAPSE_WEIGHT_FLOOR);
  let next = { latency: fix(w.latency), failure: fix(w.failure), load: fix(w.load) };
  // Renormalising can push a floored term back under the floor; settle in two passes.
  for (let i = 0; i < 2; i++) {
    const sum = next.latency + next.failure + next.load;
    next = { latency: fix(next.latency / sum), failure: fix(next.failure / sum), load: fix(next.load / sum) };
  }
  const sum = next.latency + next.failure + next.load;
  return { latency: next.latency / sum, failure: next.failure / sum, load: next.load / sum };
}

function loadWeights(): ResistanceWeights {
  if (weights) return weights;
  weights = { ...DEFAULT_RESISTANCE_WEIGHTS };
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(WEIGHTS_KEY) : null;
    if (raw) {
      const saved = JSON.parse(raw) as Partial<ResistanceWeights> & { n?: number };
      if ([saved.latency, saved.failure, saved.load].every((x) => typeof x === 'number' && Number.isFinite(x))) {
        weights = normalizeWeights(saved as ResistanceWeights);
        samples = typeof saved.n === 'number' && saved.n > 0 ? Math.floor(saved.n) : 0;
      }
    }
  } catch { /* defaults */ }
  return weights;
}

function saveWeights(): void {
  unsaved = 0;
  try {
    if (typeof localStorage !== 'undefined' && weights) {
      localStorage.setItem(WEIGHTS_KEY, JSON.stringify({ ...weights, n: samples }));
    }
  } catch { /* ignore */ }
}

const toField = (w: ResistanceWeights): Float32Array => Float32Array.of(w.latency, w.failure, w.load);

/** Curvature ‖Δu‖ of the weight field: 0 when all three agree, higher as they pull apart. */
export function weightQScore(w: ResistanceWeights): number {
  return norm(laplacian(toField(w), 3)) + ENTROPY_LAMBDA;
}

/** The weights in use right now, how many outcomes taught them, and their Q-score. */
export function getResistanceWeights(): ResistanceWeights & { samples: number; qScore: number } {
  const w = loadWeights();
  return { ...w, samples, qScore: weightQScore(w) };
}

/** Resistance terms ∈ [0, 1] (pure — exported for tests). */
export function resistanceTerms(i: ResistanceInputs): ResistanceWeights {
  const latency = i.rttMs ?? i.network?.latencyMs ?? NEUTRAL_LATENCY_MS;
  const smooth = i.smoothness !== null
    ? clamp01(i.smoothness)
    : i.network
      ? 0.5 + (clamp01(i.network.smoothness) - 0.5) * i.network.confidence * SYNAPSE_NETWORK_DAMPING
      : 0.5;
  return {
    latency: clamp01(Math.min(Math.max(0, latency), MAX_LATENCY_MS) / MAX_LATENCY_MS),
    failure: 1 - smooth,
    load: i.reportedConns === null ? 0.5 : clamp01(Math.max(0, i.reportedConns) / SYNAPSE_NODE_CAPACITY),
  };
}

/**
 * One UQRC step of the weight field (pure — exported for tests): evolve the
 * deformation from the ground state with 𝒪_UQRC and inject the outcome's
 * prediction error, so `w · terms` moves toward the observed `cost` ∈ [0, 1].
 */
export function learnWeights(w: ResistanceWeights, terms: ResistanceWeights, cost: number, rate = SYNAPSE_LEARNING_RATE): ResistanceWeights {
  const g = DEFAULT_RESISTANCE_WEIGHTS;
  const predicted = w.latency * terms.latency + w.failure * terms.failure + w.load * terms.load;
  const err = clamp01(cost) - predicted;
  const d = Float32Array.of(w.latency - g.latency, w.failure - g.failure, w.load - g.load);
  const lap = laplacian(d, 3);
  const eh = entropyHessian(d, 3);
  const source = [terms.latency, terms.failure, terms.load];
  const next = new Array<number>(3);
  for (let x = 0; x < 3; x++) {
    const op = NU_VISCOSITY * lap[x] - RICCI_DECAY * d[x] + ENTROPY_LAMBDA * eh[x];
    next[x] = d[x] + STEP_DAMPING * op + rate * err * source[x];
  }
  return normalizeWeights({ latency: g.latency + next[0], failure: g.failure + next[1], load: g.load + next[2] });
}

/** Cost of one ask: answer time over the timeout, or 1 when it failed. */
export function outcomeCost(elapsedMs: number, ok: boolean): number {
  if (!ok || !Number.isFinite(elapsedMs)) return 1;
  return clamp01(Math.max(0, elapsedMs) / SYNAPSE_OUTCOME_TIMEOUT_MS);
}

/**
 * A peer answered (or failed to answer) a manifest or chunk ask. Teaches the
 * weights from what we knew about the peer and what actually happened.
 */
export function recordSourceOutcome(peerId: string, elapsedMs: number, ok: boolean, nowTs = Date.now(), rttMs?: number | null): void {
  if (!peerId) return;
  try {
    const terms = resistanceTerms(resistanceInputsFor(peerId, nowTs, rttMs ?? null));
    weights = learnWeights(loadWeights(), terms, outcomeCost(elapsedMs, ok));
    samples += 1;
    if (++unsaved >= PERSIST_EVERY) saveWeights();
  } catch { /* learning is best-effort */ }
}

/** Test hook. */
export function _resetResistanceWeightsForTests(): void {
  weights = null;
  samples = 0;
  unsaved = 0;
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(WEIGHTS_KEY); } catch { /* ignore */ }
}

export interface ResistanceInputs {
  /** Our own RTT to the peer, null when unmeasured. */
  rttMs: number | null;
  /** Our own handshake smoothness, null when we have no memory of the peer. */
  smoothness: number | null;
  /** What other nodes report about links to the peer. */
  network: NetworkSynapseView | null;
  /** The peer's own reported connection count, null when unknown. */
  reportedConns: number | null;
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5);

/**
 * Resistance ∈ [0, 1] (pure given `w` — exported for tests). Lower conducts
 * better. Uses the learned weights unless `w` is given.
 */
export function synapticResistance(i: ResistanceInputs, w: ResistanceWeights = loadWeights()): number {
  const t = resistanceTerms(i);
  return w.latency * t.latency + w.failure * t.failure + w.load * t.load;
}

/** Gather the live inputs for one peer. `rttMs` overrides the synapse layer's RTT. */
export function resistanceInputsFor(peerId: string, nowTs = Date.now(), rttMs?: number | null): ResistanceInputs {
  return {
    rttMs: rttMs ?? getSmoothedRtt(peerId),
    smoothness: hasSynapse(peerId) ? getSmoothness(peerId, nowTs) : null,
    network: getNetworkSynapseView(peerId, nowTs),
    reportedConns: getSynapseManifold().getNode(peerId, nowTs)?.conns ?? null,
  };
}

/**
 * Order peers by lowest resistance. Stable: equal resistance keeps the
 * input order. `rttOf` supplies first-hand RTTs the caller already holds.
 */
export function rankBySynapticPath(
  peerIds: readonly string[],
  options: { nowTs?: number; rttOf?: (peerId: string) => number | null | undefined } = {},
): string[] {
  const nowTs = options.nowTs ?? Date.now();
  return peerIds
    .map((peerId, index) => ({
      peerId,
      index,
      r: synapticResistance(resistanceInputsFor(peerId, nowTs, options.rttOf?.(peerId) ?? null)),
    }))
    .sort((a, b) => (a.r - b.r) || (a.index - b.index))
    .map((entry) => entry.peerId);
}
