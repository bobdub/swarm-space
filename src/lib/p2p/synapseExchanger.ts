/**
 * ═══════════════════════════════════════════════════════════════════════
 * SYNAPSE EXCHANGER — the network-wide synaptic map over Gun (Phase 1)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Each node already remembers how its own links behave (`synapseLayer.ts`,
 * `NeuralStateEngine`), but that memory stays on the device, so a node meets
 * every stranger as a blank slate. The exchanger lets nodes share the
 * outward-facing shape of those links: once a minute each node writes one
 * small record into its own slot on the Global Cell Gun registry
 * (`neural-manifold` channel, slot `neural~<peerId>`):
 *
 *   { v, peerId, at, conns, phi, e: [[toPeerId, smoothness, latencyMs, weight], …] }
 *
 * Every node folds the fresh records into a shared map, so the Bus Cycle and
 * `NeuralStateEngine.selectPeers` can lean on what other nodes have seen of a
 * peer they have never linked with themselves.
 *
 * Boundaries (keep them):
 * - Topology numbers only: mesh peer ids, link smoothness, latency, weight,
 *   connection count and Φ. Never user ids, content, keys or private learning.
 * - Bytes never cross Gun here. Media, chunks and messages stay on WebRTC and
 *   torrent swarms; this map only informs which peer to try.
 * - The map is a hint, not a fact. Gun has no authentication, so a record can
 *   be forged. Reports are bounded, damped, need several reporters for full
 *   weight, and never override a node's own first-hand synapse memory.
 *   Ownership and consensus stay with signatures.
 * - Shy nodes read the map but do not publish their own links.
 *
 * Gun stores nested objects as links, so the record travels as a JSON
 * string, like the public cell registry.
 * ═══════════════════════════════════════════════════════════════════════
 */

export const SYNAPSE_MANIFOLD_CHANNEL = 'neural-manifold';
/** Publish cadence while the node has live links. */
export const SYNAPSE_PUBLISH_MS = 60_000;
/** A record not refreshed within this window is no longer part of the map. */
export const SYNAPSE_STALE_MS = 3 * 60_000;
/** Edges per record: the strongest links only. */
export const SYNAPSE_MAX_EDGES = 24;
/** Hard size cap for one serialized record. */
export const SYNAPSE_MAX_BYTES = 4096;
/** Nodes kept in the map; the stalest are evicted first. */
export const SYNAPSE_MAX_NODES = 512;
/** Reporters needed before a network view carries full confidence. */
export const SYNAPSE_FULL_CONFIDENCE_REPORTERS = 3;
/** Second-hand smoothness never weighs more than this fraction of first-hand. */
export const SYNAPSE_NETWORK_DAMPING = 0.5;

const RECORD_VERSION = 1;
const MAX_LATENCY_MS = 60_000;
const MAX_WEIGHT = 1_000;
const PEER_ID_RE = /^peer-[a-zA-Z0-9_-]{1,120}$/;

export interface SynapseEdge {
  /** Mesh peer id at the other end of the link. */
  to: string;
  /** Handshake smoothness ∈ [0, 1] (synapse layer). */
  smoothness: number;
  /** Smoothed round trip in ms, null when not measured. */
  latencyMs: number | null;
  /** Neural weight the reporter gives this peer (≥ 0). */
  weight: number;
}

export interface ManifoldNode {
  peerId: string;
  /** Reporter's clock when the record was written. */
  at: number;
  /** Open mesh links the reporter had. */
  conns: number;
  /** Reporter's Φ transition quality ∈ [0, 1], null when unknown. */
  phi: number | null;
  edges: SynapseEdge[];
}

export interface NetworkSynapseView {
  /** Distinct fresh nodes reporting a link to the peer. */
  reporters: number;
  /** Mean reported smoothness ∈ [0, 1]. */
  smoothness: number;
  /** Median reported latency, null when nobody measured one. */
  latencyMs: number | null;
  /** min(1, reporters / SYNAPSE_FULL_CONFIDENCE_REPORTERS). */
  confidence: number;
}

/** One registry slot per node, so a synapse record never overwrites presence. */
export function synapseSlot(peerId: string): string {
  return `neural~${peerId.replace(/[^a-zA-Z0-9_-]/g, '~')}`;
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const round = (x: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(x * f) / f;
};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function normalizeEdge(raw: unknown, owner: string): SynapseEdge | null {
  let to: unknown; let smoothness: unknown; let latencyMs: unknown; let weight: unknown;
  if (Array.isArray(raw)) {
    [to, smoothness, latencyMs, weight] = raw;
  } else if (raw && typeof raw === 'object') {
    ({ to, smoothness, latencyMs, weight } = raw as Record<string, unknown>);
  } else {
    return null;
  }
  if (typeof to !== 'string' || !PEER_ID_RE.test(to) || to === owner) return null;
  if (!finite(smoothness)) return null;
  return {
    to,
    smoothness: round(clamp(smoothness, 0, 1), 3),
    latencyMs: finite(latencyMs) && latencyMs >= 0 ? Math.round(Math.min(latencyMs, MAX_LATENCY_MS)) : null,
    weight: finite(weight) ? round(clamp(weight, 0, MAX_WEIGHT), 2) : 0,
  };
}

/**
 * Serialize our own record (pure — exported for tests). Keeps the strongest
 * SYNAPSE_MAX_EDGES valid links, rounded, one per peer. Returns null when the
 * peer id is invalid.
 */
export function buildManifoldRecord(node: ManifoldNode): string | null {
  if (!PEER_ID_RE.test(node.peerId)) return null;
  const seen = new Set<string>();
  const edges = node.edges
    .map((e) => normalizeEdge(e, node.peerId))
    .filter((e): e is SynapseEdge => !!e && !seen.has(e.to) && !!seen.add(e.to))
    .sort((a, b) => (b.smoothness - a.smoothness) || (b.weight - a.weight) || (a.to < b.to ? -1 : 1))
    .slice(0, SYNAPSE_MAX_EDGES);
  const record = {
    v: RECORD_VERSION,
    peerId: node.peerId,
    at: Math.round(node.at),
    conns: finite(node.conns) ? Math.max(0, Math.min(10_000, Math.floor(node.conns))) : 0,
    phi: finite(node.phi) ? round(clamp(node.phi, 0, 1), 3) : null,
    e: edges.map((e) => [e.to, e.smoothness, e.latencyMs, e.weight]),
  };
  let raw = JSON.stringify(record);
  // Peer ids are bounded, so this only trims in pathological cases.
  while (raw.length > SYNAPSE_MAX_BYTES && record.e.length > 0) {
    record.e.pop();
    raw = JSON.stringify(record);
  }
  return raw.length > SYNAPSE_MAX_BYTES ? null : raw;
}

/**
 * Validate a registry payload (pure — exported for tests). The record must be
 * written by the node it describes (`from`, the Gun envelope sender), fresh,
 * not from the future, small, and made of well-formed numbers.
 */
export function parseManifoldRecord(raw: unknown, from: string, nowTs = Date.now()): ManifoldNode | null {
  if (typeof raw !== 'string' || raw.length > SYNAPSE_MAX_BYTES) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.v !== RECORD_VERSION) return null;
  if (typeof d.peerId !== 'string' || !PEER_ID_RE.test(d.peerId) || d.peerId !== from) return null;
  if (!finite(d.at) || nowTs - d.at > SYNAPSE_STALE_MS || d.at - nowTs > SYNAPSE_STALE_MS) return null;
  if (!Array.isArray(d.e) || d.e.length > SYNAPSE_MAX_EDGES) return null;
  const seen = new Set<string>();
  const edges: SynapseEdge[] = [];
  for (const rawEdge of d.e) {
    const edge = normalizeEdge(rawEdge, d.peerId);
    if (!edge || seen.has(edge.to)) continue;
    seen.add(edge.to);
    edges.push(edge);
  }
  return {
    peerId: d.peerId,
    at: d.at,
    conns: finite(d.conns) && d.conns > 0 ? Math.min(Math.floor(d.conns), 10_000) : 0,
    phi: finite(d.phi) ? clamp(d.phi, 0, 1) : null,
    edges,
  };
}

/**
 * The folded network map: newest record per node, bounded, with an index of
 * who reports a link to whom.
 */
export class SynapseManifold {
  private readonly nodes = new Map<string, ManifoldNode>();

  constructor(private readonly maxNodes = SYNAPSE_MAX_NODES) {}

  /** Keep the newer record per node. Returns true when the map changed. */
  merge(node: ManifoldNode): boolean {
    const prev = this.nodes.get(node.peerId);
    if (prev && prev.at >= node.at) return false;
    this.nodes.delete(node.peerId);
    this.nodes.set(node.peerId, node);
    if (this.nodes.size > this.maxNodes) {
      const stalest = [...this.nodes.values()].sort((a, b) => a.at - b.at);
      for (const n of stalest.slice(0, this.nodes.size - this.maxNodes)) this.nodes.delete(n.peerId);
    }
    return true;
  }

  prune(nowTs = Date.now()): void {
    for (const [id, n] of this.nodes) {
      if (nowTs - n.at > SYNAPSE_STALE_MS) this.nodes.delete(id);
    }
  }

  getNode(peerId: string, nowTs = Date.now()): ManifoldNode | null {
    const n = this.nodes.get(peerId);
    return n && nowTs - n.at <= SYNAPSE_STALE_MS ? n : null;
  }

  /** Fresh nodes in the map. */
  getNodes(nowTs = Date.now()): ManifoldNode[] {
    return [...this.nodes.values()].filter((n) => nowTs - n.at <= SYNAPSE_STALE_MS);
  }

  /** The link `from` reports to `to`, if its record is fresh. */
  getEdge(from: string, to: string, nowTs = Date.now()): SynapseEdge | null {
    return this.getNode(from, nowTs)?.edges.find((e) => e.to === to) ?? null;
  }

  /**
   * What the rest of the network reports about links to `peerId`.
   * `excludeReporter` drops one reporter (normally ourselves).
   */
  getNetworkView(peerId: string, nowTs = Date.now(), excludeReporter?: string | null): NetworkSynapseView | null {
    const smooth: number[] = [];
    const latency: number[] = [];
    for (const n of this.nodes.values()) {
      if (n.peerId === peerId || n.peerId === excludeReporter) continue;
      if (nowTs - n.at > SYNAPSE_STALE_MS) continue;
      const edge = n.edges.find((e) => e.to === peerId);
      if (!edge) continue;
      smooth.push(edge.smoothness);
      if (edge.latencyMs !== null) latency.push(edge.latencyMs);
    }
    if (smooth.length === 0) return null;
    latency.sort((a, b) => a - b);
    const mid = Math.floor(latency.length / 2);
    const median = latency.length === 0
      ? null
      : latency.length % 2 ? latency[mid] : Math.round((latency[mid - 1] + latency[mid]) / 2);
    return {
      reporters: smooth.length,
      smoothness: smooth.reduce((s, x) => s + x, 0) / smooth.length,
      latencyMs: median,
      confidence: Math.min(1, smooth.length / SYNAPSE_FULL_CONFIDENCE_REPORTERS),
    };
  }

  clear(): void {
    this.nodes.clear();
  }

  get size(): number {
    return this.nodes.size;
  }
}

// ── Shared map + lifecycle ───────────────────────────────────────────

const shared = new SynapseManifold();
let localId: string | null = null;

export function getSynapseManifold(): SynapseManifold {
  return shared;
}

/**
 * The network's view of `peerId`, excluding our own record. Never includes
 * first-hand data; callers decide how much to trust it.
 */
export function getNetworkSynapseView(peerId: string, nowTs = Date.now()): NetworkSynapseView | null {
  return shared.getNetworkView(peerId, nowTs, localId);
}

/**
 * A damped prior ∈ [0, SYNAPSE_NETWORK_DAMPING] for a peer we know nothing
 * about first-hand: reported smoothness scaled by reporter confidence.
 */
export function getNetworkSynapsePrior(peerId: string, nowTs = Date.now()): number {
  const view = getNetworkSynapseView(peerId, nowTs);
  if (!view) return 0;
  return SYNAPSE_NETWORK_DAMPING * view.smoothness * view.confidence;
}

export interface SynapseExchangerDeps {
  /** Our mesh peer id (null while not online yet). */
  localPeerId(): string | null;
  /** Write a payload into a registry slot. */
  publish(channel: string, slot: string, payload: string): boolean;
  /** Listen for registry entries; returns an unsubscribe. */
  subscribe(channel: string, fn: (fromPeerId: string, payload: unknown) => void): () => void;
  /** Our live links right now. */
  collect(): { conns: number; phi: number | null; edges: SynapseEdge[] };
  /** True while the node is shy: read the map, do not publish. */
  isShy?(): boolean;
  /** Mesh online check; publishing waits for it. */
  isOnline?(): boolean;
  now?(): number;
}

interface Running {
  timer: ReturnType<typeof setInterval>;
  unsubscribe: () => void;
  lastPublishedEmpty: boolean;
}

let running: Running | null = null;

/**
 * Publish our own record now (no-op while offline, shy or without an id).
 * Returns true when a record was written. Exported for tests.
 */
export function publishSynapseRecord(deps: SynapseExchangerDeps): boolean {
  const now = deps.now?.() ?? Date.now();
  const peerId = deps.localPeerId();
  localId = peerId;
  if (!peerId) return false;
  if (deps.isOnline && !deps.isOnline()) return false;
  if (deps.isShy?.()) return false;
  const { conns, phi, edges } = deps.collect();
  // An empty record is written once so peers drop our old links, then we go quiet.
  if (edges.length === 0) {
    if (running?.lastPublishedEmpty) return false;
    if (running) running.lastPublishedEmpty = true;
  } else if (running) {
    running.lastPublishedEmpty = false;
  }
  const raw = buildManifoldRecord({ peerId, at: now, conns, phi, edges });
  if (!raw) return false;
  try { return deps.publish(SYNAPSE_MANIFOLD_CHANNEL, synapseSlot(peerId), raw); } catch { return false; }
}

/** Start exchanging. Idempotent; returns a stop function. */
export function startSynapseExchanger(deps: SynapseExchangerDeps): () => void {
  if (running) return stopSynapseExchanger;
  const unsubscribe = deps.subscribe(SYNAPSE_MANIFOLD_CHANNEL, (from, payload) => {
    const node = parseManifoldRecord(payload, from, deps.now?.() ?? Date.now());
    if (node && node.peerId !== deps.localPeerId()) shared.merge(node);
  });
  running = {
    unsubscribe,
    lastPublishedEmpty: false,
    timer: setInterval(() => {
      shared.prune(deps.now?.() ?? Date.now());
      publishSynapseRecord(deps);
    }, SYNAPSE_PUBLISH_MS),
  };
  publishSynapseRecord(deps);
  return stopSynapseExchanger;
}

export function stopSynapseExchanger(): void {
  if (!running) return;
  clearInterval(running.timer);
  try { running.unsubscribe(); } catch { /* ignore */ }
  running = null;
  shared.clear();
}

/** Test hook. */
export function _resetSynapseExchangerForTests(): void {
  stopSynapseExchanger();
  shared.clear();
  localId = null;
}
