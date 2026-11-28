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
 *   header  9 bytes   version u8 · at u32 (seconds) · conns u16 · Φ u8 (255 = unknown)
 *                     · edge count u8 (so the signer block never has to be guessed)
 *   edge   10 bytes   peer key 6 bytes · smoothness u8 · latency u16 ms (65535 = unmeasured)
 *                     · weight u8 (log scale)
 *   signer            key length u8 · identity public key (as stored, ≤ 160 bytes)
 *                     · ECDSA P-256 / SHA-256 signature, 64 bytes (r‖s)
 *
 * The signature covers the slot owner's mesh peer id plus every byte before
 * it, so a record cannot be replayed into another node's slot. Every node
 * signs with its identity key; guests have one too, so nobody has to log in.
 * The first key seen for a peer is pinned, and a different key is refused
 * unless it is vouched. A record is vouched when its key hashes
 * (`computeUserId`) to the user id our Connection Library learned from that
 * peer over a direct link; vouched reports count in full, others at half.
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
 * - The map is a hint, not a fact. Signatures stop forged slots, not made-up
 *   nodes, so reports stay bounded and damped, need several reporters for
 *   full weight, and never override a node's own first-hand synapse memory.
 *   Ownership and consensus stay with their own signatures.
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

const RECORD_VERSION = 3;
const HEADER_BYTES = 9;
const EDGE_BYTES = 10;
const KEY_BYTES = 6;
const SIGNER_KEY_MAX_BYTES = 160;
const SIGNATURE_BYTES = 64;
/** Weight of a report whose signer the Connection Library has not vouched for. */
export const SYNAPSE_UNVOUCHED_WEIGHT = 0.5;
/** Largest valid record, in base64 characters. */
export const SYNAPSE_MAX_RECORD_CHARS =
  Math.ceil((HEADER_BYTES + SYNAPSE_MAX_EDGES * EDGE_BYTES + 1 + SIGNER_KEY_MAX_BYTES + SIGNATURE_BYTES) / 3) * 4;
const MAX_PINS = 1024;
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
  /** Signer's identity public key (base64, as stored by its account). */
  publicKey: string;
  /** The key matches the user id our Connection Library holds for this peer. */
  vouched: boolean;
}

/** Signs our records with the identity key. */
export interface SynapseSigner {
  /** Identity public key, base64 (spki or raw, as the account stores it). */
  publicKey: string;
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export interface NetworkSynapseView {
  /** Distinct fresh nodes reporting a link to the peer. */
  reporters: number;
  /** Mean reported smoothness ∈ [0, 1]. */
  smoothness: number;
  /** Median reported latency, null when nobody measured one. */
  latencyMs: number | null;
  /** min(1, reporter weight / SYNAPSE_FULL_CONFIDENCE_REPORTERS); vouched reporters weigh 1, others 0.5. */
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
 * Pack the unsigned body of our record (pure — exported for tests). Keeps
 * the strongest SYNAPSE_MAX_EDGES valid links, one per peer. Returns null
 * when the peer id is invalid. `signManifoldRecord` turns it into a record.
 */
export function buildManifoldBody(node: { peerId: string; at: number; conns: number; phi: number | null; edges: SynapseEdge[] }): string | null {
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
  view.setUint8(8, edges.length);
  edges.forEach((e, i) => {
    const o = HEADER_BYTES + i * EDGE_BYTES;
    bytes.set(keyBytes(e.to), o);
    view.setUint8(o + 6, encodeSmoothness(e.smoothness));
    view.setUint16(o + 7, finite(e.latencyMs) && e.latencyMs >= 0 ? Math.min(Math.round(e.latencyMs), MAX_LATENCY_MS) : LATENCY_UNMEASURED);
    view.setUint8(o + 9, finite(e.weight) ? encodeWeight(e.weight) : 0);
  });
  return toBase64(bytes);
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Bytes the signature covers: the slot owner's peer id, then the record up to the signature. */
const signedBytes = (peerId: string, unsigned: Uint8Array): Uint8Array => concat(utf8(peerId), Uint8Array.of(0), unsigned);

/** Sign a body from `buildManifoldBody` for `peerId`'s slot. */
export async function signManifoldRecord(body: string, peerId: string, signer: SynapseSigner): Promise<string | null> {
  const bodyBytes = fromBase64(body);
  const keyRaw = fromBase64(signer.publicKey);
  if (!bodyBytes || !keyRaw || keyRaw.length === 0 || keyRaw.length > SIGNER_KEY_MAX_BYTES) return null;
  const unsigned = concat(bodyBytes, Uint8Array.of(keyRaw.length), keyRaw);
  const signature = await signer.sign(signedBytes(peerId, unsigned));
  if (signature.length !== SIGNATURE_BYTES) return null;
  return toBase64(concat(unsigned, signature));
}

/** Build and sign our record in one step. */
export async function buildManifoldRecord(
  node: { peerId: string; at: number; conns: number; phi: number | null; edges: SynapseEdge[] },
  signer: SynapseSigner,
): Promise<string | null> {
  const body = buildManifoldBody(node);
  return body ? signManifoldRecord(body, node.peerId, signer) : null;
}

/** First 16 hex characters of SHA-256 over the key bytes (same as `computeUserId`). */
export async function synapseSignerUserId(publicKey: string): Promise<string | null> {
  const raw = fromBase64(publicKey);
  if (!raw) return null;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  return hex(digest).slice(0, 16);
}

const verifyKeys = new Map<string, Promise<CryptoKey | null>>();

function importVerifyKey(publicKey: string): Promise<CryptoKey | null> {
  let pending = verifyKeys.get(publicKey);
  if (!pending) {
    const raw = fromBase64(publicKey);
    pending = (async () => {
      if (!raw) return null;
      try {
        return await crypto.subtle.importKey('spki', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      } catch {
        // Accounts recovered from a private key store the raw point form.
        try {
          return await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        } catch {
          return null;
        }
      }
    })();
    if (verifyKeys.size >= MAX_PINS) verifyKeys.delete(verifyKeys.keys().next().value as string);
    verifyKeys.set(publicKey, pending);
  }
  return pending;
}

interface ParsedRecord {
  node: ManifoldNode;
  signed: Uint8Array;
  signature: Uint8Array;
}

/**
 * Locate the signer block from the header's explicit edge count. The layout
 * must account for every byte exactly; nothing is inferred from edge bytes.
 */
function splitRecord(bytes: Uint8Array): { edgesEnd: number; keyLen: number } | null {
  const edges = bytes[8];
  if (edges > SYNAPSE_MAX_EDGES) return null;
  const edgesEnd = HEADER_BYTES + edges * EDGE_BYTES;
  if (edgesEnd + 1 + SIGNATURE_BYTES > bytes.length) return null;
  const keyLen = bytes[edgesEnd];
  if (keyLen === 0 || keyLen > SIGNER_KEY_MAX_BYTES) return null;
  return edgesEnd + 1 + keyLen + SIGNATURE_BYTES === bytes.length ? { edgesEnd, keyLen } : null;
}

function parseRecord(raw: unknown, from: string, nowTs: number): ParsedRecord | null {
  if (typeof raw !== 'string' || raw.length > SYNAPSE_MAX_RECORD_CHARS || !PEER_ID_RE.test(from)) return null;
  const bytes = fromBase64(raw);
  if (!bytes || bytes.length < HEADER_BYTES + 1 + SIGNATURE_BYTES) return null;
  const view = new DataView(bytes.buffer);
  if (view.getUint8(0) !== RECORD_VERSION) return null;
  const at = view.getUint32(1) * 1000;
  if (nowTs - at > SYNAPSE_STALE_MS || at - nowTs > SYNAPSE_STALE_MS) return null;
  const split = splitRecord(bytes);
  if (!split) return null;
  const keyStart = split.edgesEnd + 1;
  const sigStart = keyStart + split.keyLen;
  const phiByte = view.getUint8(7);
  const ownKey = synapsePeerKey(from);
  const seen = new Set<string>();
  const edges: ReportedEdge[] = [];
  for (let o = HEADER_BYTES; o < split.edgesEnd; o += EDGE_BYTES) {
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
    node: {
      peerId: from,
      at,
      conns: view.getUint16(5),
      phi: phiByte === PHI_UNKNOWN ? null : Math.min(1, phiByte / 254),
      edges,
      publicKey: toBase64(bytes.subarray(keyStart, sigStart)),
      vouched: false,
    },
    signed: signedBytes(from, bytes.subarray(0, sigStart)),
    signature: bytes.slice(sigStart),
  };
}

/**
 * Unpack a registry payload without checking its signature (pure —
 * exported for tests). The record is attributed to `from`, the Gun envelope
 * sender and slot owner; it must be fresh, the right size and version.
 */
export function parseManifoldRecord(raw: unknown, from: string, nowTs = Date.now()): ManifoldNode | null {
  return parseRecord(raw, from, nowTs)?.node ?? null;
}

/**
 * Unpack and verify a record. `knownUserId` is the user id our Connection
 * Library learned from `from` over a direct link (if any); a matching key
 * marks the record vouched.
 */
export async function verifyManifoldRecord(
  raw: unknown,
  from: string,
  nowTs = Date.now(),
  knownUserId?: string | null,
): Promise<ManifoldNode | null> {
  const parsed = parseRecord(raw, from, nowTs);
  if (!parsed) return null;
  const key = await importVerifyKey(parsed.node.publicKey);
  if (!key) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, parsed.signature, parsed.signed);
  } catch {
    ok = false;
  }
  if (!ok) return null;
  if (knownUserId) parsed.node.vouched = (await synapseSignerUserId(parsed.node.publicKey)) === knownUserId;
  return parsed.node;
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
      if (nowTs - n.at > SYNAPSE_STALE_MS) { this.nodes.delete(id); pins.delete(id); }
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
    let reporters = 0;
    let weight = 0;
    let smoothSum = 0;
    const latency: number[] = [];
    for (const n of this.nodes.values()) {
      if (n.peerId === peerId || n.peerId === excludeReporter) continue;
      if (nowTs - n.at > SYNAPSE_STALE_MS) continue;
      const edge = n.edges.find((e) => e.key === key);
      if (!edge) continue;
      const w = n.vouched ? 1 : SYNAPSE_UNVOUCHED_WEIGHT;
      reporters += 1;
      weight += w;
      smoothSum += w * edge.smoothness;
      if (edge.latencyMs !== null) latency.push(edge.latencyMs);
    }
    if (reporters === 0) return null;
    latency.sort((a, b) => a - b);
    const mid = Math.floor(latency.length / 2);
    const median = latency.length === 0
      ? null
      : latency.length % 2 ? latency[mid] : Math.round((latency[mid - 1] + latency[mid]) / 2);
    return {
      reporters,
      smoothness: smoothSum / weight,
      latencyMs: median,
      confidence: Math.min(1, weight / SYNAPSE_FULL_CONFIDENCE_REPORTERS),
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
  subscribe(channel: string, fn: (fromPeerId: string, payload: unknown) => void | Promise<void>): () => void;
  /** Our identity signer (members and guests); null while locked or signed out. */
  signer(): Promise<SynapseSigner | null>;
  /** The user id the Connection Library learned from this peer over a direct link. */
  knownUserIdOf?(peerId: string): string | null;
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

/** peerId → the first signing key seen for it (until its record goes stale). */
const pins = new Map<string, string>();

/** Pin the first key per peer; a different key needs a vouch to replace it. */
function acceptPin(node: ManifoldNode): boolean {
  const pinned = pins.get(node.peerId);
  if (pinned && pinned !== node.publicKey && !node.vouched) return false;
  if (!pinned && pins.size >= MAX_PINS) pins.delete(pins.keys().next().value as string);
  pins.set(node.peerId, node.publicKey);
  return true;
}

/** Local counters for the Node Dashboard's Synapse map card. Never published. */
export interface SynapseMapStats {
  running: boolean;
  shy: boolean;
  /** Fresh nodes in the map. */
  nodes: number;
  /** Links those nodes report. */
  edges: number;
  /** Nodes whose key matches the user id our Connection Library holds for them. */
  vouched: number;
  /** True while our record could not be signed (locked or signed out). */
  unsigned: boolean;
  received: number;
  refused: number;
  published: number;
  lastPublishedAt: number | null;
  lastPublishedChars: number | null;
  lastReceivedAt: number | null;
  /** Times route picking leaned on the network view for an unmet peer. */
  assists: number;
}

const counters = {
  received: 0, refused: 0, published: 0, assists: 0,
  lastPublishedAt: null as number | null,
  lastPublishedChars: null as number | null,
  lastReceivedAt: null as number | null,
  shy: false,
  unsigned: false,
};

/** Route picking used the network view for a peer with no first-hand memory. */
export function noteSynapseAssist(): void {
  counters.assists += 1;
}

export function getSynapseMapStats(nowTs = Date.now()): SynapseMapStats {
  const nodes = shared.getNodes(nowTs);
  return {
    running: !!running,
    shy: counters.shy,
    nodes: nodes.length,
    edges: nodes.reduce((sum, n) => sum + n.edges.length, 0),
    vouched: nodes.filter((n) => n.vouched).length,
    unsigned: counters.unsigned,
    received: counters.received,
    refused: counters.refused,
    published: counters.published,
    lastPublishedAt: counters.lastPublishedAt,
    lastPublishedChars: counters.lastPublishedChars,
    lastReceivedAt: counters.lastReceivedAt,
    assists: counters.assists,
  };
}

function resetCounters(): void {
  Object.assign(counters, {
    received: 0, refused: 0, published: 0, assists: 0,
    lastPublishedAt: null, lastPublishedChars: null, lastReceivedAt: null, shy: false, unsigned: false,
  });
}

/**
 * Publish our own signed record now (no-op while offline, shy, unsigned or
 * without an id). Resolves true when a record was written. Exported for tests.
 */
export async function publishSynapseRecord(deps: SynapseExchangerDeps): Promise<boolean> {
  const now = deps.now?.() ?? Date.now();
  const peerId = deps.localPeerId();
  localId = peerId;
  if (!peerId) return false;
  if (deps.isOnline && !deps.isOnline()) return false;
  counters.shy = !!deps.isShy?.();
  if (counters.shy) return false;
  const { conns, phi, edges } = deps.collect();
  // An empty record is written once so peers drop our old links, then we go quiet.
  if (edges.length === 0 && running?.lastPublishedEmpty) return false;
  let signer: SynapseSigner | null = null;
  try { signer = await deps.signer(); } catch { signer = null; }
  counters.unsigned = !signer;
  if (!signer) return false;
  let raw: string | null = null;
  try { raw = await buildManifoldRecord({ peerId, at: now, conns, phi, edges }, signer); } catch { raw = null; }
  if (!raw) return false;
  if (running) running.lastPublishedEmpty = edges.length === 0;
  let ok = false;
  try { ok = deps.publish(SYNAPSE_MANIFOLD_CHANNEL, synapseSlot(peerId), raw); } catch { ok = false; }
  if (ok) {
    counters.published += 1;
    counters.lastPublishedAt = now;
    counters.lastPublishedChars = raw.length;
  }
  return ok;
}

/** Start exchanging. Idempotent; returns a stop function. */
export function startSynapseExchanger(deps: SynapseExchangerDeps): () => void {
  if (running) return stopSynapseExchanger;
  const unsubscribe = deps.subscribe(SYNAPSE_MANIFOLD_CHANNEL, async (from, payload) => {
    if (from === deps.localPeerId()) return;
    const now = deps.now?.() ?? Date.now();
    let known: string | null = null;
    try { known = deps.knownUserIdOf?.(from) ?? null; } catch { known = null; }
    const node = await verifyManifoldRecord(payload, from, now, known);
    if (!node || !acceptPin(node)) { counters.refused += 1; return; }
    counters.received += 1;
    counters.lastReceivedAt = now;
    shared.merge(node);
  });
  running = {
    unsubscribe,
    lastPublishedEmpty: false,
    timer: setInterval(() => {
      shared.prune(deps.now?.() ?? Date.now());
      void publishSynapseRecord(deps);
    }, SYNAPSE_PUBLISH_MS),
  };
  void publishSynapseRecord(deps);
  return stopSynapseExchanger;
}

export function stopSynapseExchanger(): void {
  if (!running) return;
  clearInterval(running.timer);
  try { running.unsubscribe(); } catch { /* ignore */ }
  running = null;
  shared.clear();
  pins.clear();
}

/** Test hook. */
export function _resetSynapseExchangerForTests(): void {
  stopSynapseExchanger();
  shared.clear();
  localId = null;
  resetCounters();
}
