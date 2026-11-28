/**
 * ═══════════════════════════════════════════════════════════════════════
 * SYNAPTIC DISPATCH — lowest-resistance source order (neural map Phase 3)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * When a file's manifest or chunks can come from several open links, ask
 * the smoothest, least loaded one first. Each candidate gets a resistance:
 *
 *   R = 0.5 · latency + 0.3 · (1 − smoothness) + 0.2 · load        ∈ [0, 1]
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

/** Resistance ∈ [0, 1] (pure — exported for tests). Lower conducts better. */
export function synapticResistance(i: ResistanceInputs): number {
  const latency = i.rttMs ?? i.network?.latencyMs ?? NEUTRAL_LATENCY_MS;
  const latencyTerm = clamp01(Math.min(Math.max(0, latency), MAX_LATENCY_MS) / MAX_LATENCY_MS);
  const smooth = i.smoothness !== null
    ? clamp01(i.smoothness)
    : i.network
      ? 0.5 + (clamp01(i.network.smoothness) - 0.5) * i.network.confidence * SYNAPSE_NETWORK_DAMPING
      : 0.5;
  const load = i.reportedConns === null
    ? 0.5
    : clamp01(Math.max(0, i.reportedConns) / SYNAPSE_NODE_CAPACITY);
  return 0.5 * latencyTerm + 0.3 * (1 - smooth) + 0.2 * load;
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
