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
 * (`neural-manifold` channel, slot `neural~<peerId>`).
 *
 * The record is packed binary, sent as one base64 string (Gun stores
 * strings intact; nested objects become links):
 *
 *   header  8 bytes   version u8 · at u32 (seconds) · conns u16 · Φ u8 (255 = unknown)
 *   edge   10 bytes   peer key 6 bytes · smoothness u8 · latency u16 ms (65535 = unmeasured)
 *                     · weight u8 (log scale)
 *
 * A peer is named by a 48-bit key hashed from its mesh peer id, not the id
 * itself: a reader only ever asks about peers it already knows, so it hashes
 * their ids and looks the keys up. 24 edges come to 248 bytes (332 base64
 * characters), against about 1.5 KB as JSON with full peer ids.
 *
 * Every node folds the fresh records into a shared map, so the Bus Cycle and
 * `NeuralStateEngine.selectPeers` can lean on what other nodes have seen of a
 * peer they have never linked with themselves.
 *
 * Boundaries (keep them):
 * - Topology numbers only: hashed mesh peer keys, link smoothness, latency,
 *   weight, connection count and Φ. Never user ids, content, keys or private
 *   learning.
 * - Bytes never cross Gun here. Media, chunks and messages stay on WebRTC and
 *   torrent swarms; this map only informs which peer to try.
 * - The map is a hint, not a fact. Gun has no authentication, so a record can
 *   be forged. Reports are bounded, damped, need several reporters for full
 *   weight, and never override a node's own first-hand synapse memory.
 *   Ownership and consensus stay with signatures.
 * - Shy nodes read the map but do not publish their own links.
 * ═══════════════════════════════════════════════════════════════════════
 */

export const SYNAPSE_MANIFOLD_CHANNEL = 'neural-manifold';
/** Publish cadence while the node has live links. */
export const SYNAPSE_PUBLISH_MS = 60_000;
/** A record not refreshed within this window is no longer part of the map. */
export const SYNAPSE_STALE_MS = 3 * 60_000;
/** Edges per record: the strongest links only. */
export const SYNAPSE_MAX_EDGES = 24;
/** Nodes kept in the map; the stalest are evicted first. */
export const SYNAPSE_MAX_NODES = 512;
/** Reporters needed before a network view carries full confidence. */
export const SYNAPSE_FULL_CONFIDENCE_REPORTERS = 3;
/** Second-hand smoothness never weighs more than this fraction of first-hand. */
export const SYNAPSE_NETWORK_DAMPING = 0.5;

const RECORD_VERSION = 2;
const HEADER_BYTES = 8;
const EDGE_BYTES = 10;
const KEY_BYTES = 6;
/** Largest valid record, in base64 characters. */
export const SYNAPSE_MAX_RECORD_CHARS = Math.ceil((HEADER_BYTES + SYNAPSE_MAX_EDGES * EDGE_BYTES) / 3) * 4;
const LATENCY_UNMEASURED = 0xffff;
const MAX_LATENCY_MS = LATENCY_UNMEASURED - 1;
const PHI_UNKNOWN = 0xff;
/** weight byte = round(log2(1 + w) · 25): 0 → 0, 1000 → 249. */
const WEIGHT_SCALE = 25;
const MAX_WEIGHT = 1_000;
const PEER_ID_RE = /^peer-[a-zA-Z0-9_-]{1,120}$/;

/** One of our links, as we publish it. */
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

/** A link as another node reported it: the far end is a hashed peer key. */
export interface ReportedEdge {
  /** `synapsePeerKey(toPeerId)`. */
  key: string;
  smoothness: number;
  latencyMs: number | null;
  weight: number;
}

export interface ManifoldNode {
  peerId: string;
  /** Reporter's clock when the record was written (ms, second precision). */
  at: number;
  /** Open mesh links the reporter had. */
  conns: number;
  /** Reporter's Φ transition quality ∈ [0, 1], null when unknown. */
  phi: number | null;
  edges: ReportedEdge[];
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
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function fnv1a(text: string, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function keyBytes(peerId: string): Uint8Array {
  const a = fnv1a(peerId, 0x811c9dc5);
  const b = fnv1a(peerId, 0x9e3779b9);
  return Uint8Array.of(a >>> 24, (a >>> 16) & 0xff, (a >>> 8) & 0xff, a & 0xff, (b >>> 8) & 0xff, b & 0xff);
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');

/** 48-bit key naming a peer inside records (12 hex characters). */
export function synapsePeerKey(peerId: string): string {
  return hex(keyBytes(peerId));
}

const encodeSmoothness = (s: number): number => Math.round(clamp(s, 0, 1) * 255);
const decodeSmoothness = (b: number): number => b / 255;
const encodeWeight = (w: number): number => Math.min(255, Math.round(Math.log2(1 + clamp(w, 0, MAX_WEIGHT)) * WEIGHT_SCALE));
const decodeWeight = (b: number): number => Math.round((2 ** (b / WEIGHT_SCALE) - 1) * 100) / 100;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array | null {
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * Pack our own record (pure — exported for tests). Keeps the strongest
 * SYNAPSE_MAX_EDGES valid links, one per peer. Returns null when the peer id
 * is invalid.
 */
export function buildManifoldRecord(node: { peerId: string; at: number; conns: number; phi: number | null; edges: SynapseEdge[] }): string | null {
  if (!PEER_ID_RE.test(node.peerId)) return null;
  const seen = new Set<string>();
  const edges = node.edges
    .filter((e) => typeof e.to === 'string' && PEER_ID_RE.test(e.to) && e.to !== node.peerId && finite(e.smoothness))
    .filter((e) => !seen.has(e.to) && !!seen.add(e.to))
    .sort((a, b) => (b.smoothness - a.smoothness) || ((b.weight || 0) - (a.weight || 0)) || (a.to < b.to ? -1 : 1))
    .slice(0, SYNAPSE_MAX_EDGES);
  const bytes = new Uint8Array(HEADER_BYTES + edges.length * EDGE_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, RECORD_VERSION);
  view.setUint32(1, Math.max(0, Math.floor(node.at / 1000)) >>> 0);
  view.setUint16(5, finite(node.conns) ? clamp(Math.floor(node.conns), 0, 0xffff) : 0);
  view.setUint8(7, finite(node.phi) ? Math.min(254, Math.round(clamp(node.phi, 0, 1) * 254)) : PHI_UNKNOWN);
  edges.forEach((e, i) => {
    const o = HEADER_BYTES + i * EDGE_BYTES;
    bytes.set(keyBytes(e.to), o);
    view.setUint8(o + 6, encodeSmoothness(e.smoothness));
    view.setUint16(o + 7, finite(e.latencyMs) && e.latencyMs >= 0 ? Math.min(Math.round(e.latencyMs), MAX_LATENCY_MS) : LATENCY_UNMEASURED);
    view.setUint8(o + 9, finite(e.weight) ? encodeWeight(e.weight) : 0);
  });
  return toBase64(bytes);
}

/**
 * Unpack a registry payload (pure — exported for tests). The record is
 * attributed to `from`, the Gun envelope sender and slot owner; it must be
 * fresh, not from the future, the right size and version.
 */
export function parseManifoldRecord(raw: unknown, from: string, nowTs = Date.now()): ManifoldNode | null {
  if (typeof raw !== 'string' || raw.length > SYNAPSE_MAX_RECORD_CHARS || !PEER_ID_RE.test(from)) return null;
  const bytes = fromBase64(raw);
  if (!bytes || bytes.length < HEADER_BYTES || (bytes.length - HEADER_BYTES) % EDGE_BYTES !== 0) return null;
  const view = new DataView(bytes.buffer);
  if (view.getUint8(0) !== RECORD_VERSION) return null;
  const at = view.getUint32(1) * 1000;
  if (nowTs - at > SYNAPSE_STALE_MS || at - nowTs > SYNAPSE_STALE_MS) return null;
  const phiByte = view.getUint8(7);
  const ownKey = synapsePeerKey(from);
  const seen = new Set<string>();
  const edges: ReportedEdge[] = [];
  for (let o = HEADER_BYTES; o < bytes.length; o += EDGE_BYTES) {
    const key = hex(bytes.subarray(o, o + KEY_BYTES));
    if (key === ownKey || seen.has(key)) continue;
    seen.add(key);
    const latency = view.getUint16(o + 7);
    edges.push({
      key,
      smoothness: decodeSmoothness(view.getUint8(o + 6)),
      latencyMs: latency === LATENCY_UNMEASURED ? null : latency,
      weight: decodeWeight(view.getUint8(o + 9)),
    });
  }
  return {
    peerId: from,
    at,
    conns: view.getUint16(5),
    phi: phiByte === PHI_UNKNOWN ? null : Math.min(1, phiByte / 254),
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

  /** The link `from` reports to the peer `to`, if its record is fresh. */
  getEdge(from: string, to: string, nowTs = Date.now()): ReportedEdge | null {
    const key = synapsePeerKey(to);
    return this.getNode(from, nowTs)?.edges.find((e) => e.key === key) ?? null;
  }

  /**
   * What the rest of the network reports about links to `peerId`.
   * `excludeReporter` drops one reporter (normally ourselves).
   */
  getNetworkView(peerId: string, nowTs = Date.now(), excludeReporter?: string | null): NetworkSynapseView | null {
    const key = synapsePeerKey(peerId);
    const smooth: number[] = [];
    const latency: number[] = [];
    for (const n of this.nodes.values()) {
      if (n.peerId === peerId || n.peerId === excludeReporter) continue;
      if (nowTs - n.at > SYNAPSE_STALE_MS) continue;
      const edge = n.edges.find((e) => e.key === key);
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
