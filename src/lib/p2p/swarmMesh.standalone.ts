import { observeConnections, getConnectionAffinity } from './connectionAffinity';
import {
  isChunkUnsupported,
  isManifestUnsupported,
  isPostUnsupported,
  listUnsupportedPosts,
  subscribeUnsupportedPosts,
  hydrateUnsupportedPosts,
} from '@/lib/content/unsupportedPostsStore';
import { DEFAULT_ICE_SERVERS } from './iceServers';
import { isPublicWalletAddress } from '@/lib/uqrc/namespaceIdentity';
import { CADENCE_SPACING_MS, FUTURE_LIMIT_MS, getChainMark, planCatchup, saveChainMark, type ChainMark } from '@/lib/blockchain/chainCatchup';
import { isSelfIssuedSwarmMint } from '@/lib/blockchain/issuance';
import { resolveSignalingEndpoints, SignalingEndpointRotation, type SignalingEndpoint } from './signalingEndpoints';
import { networkNow, recordPeerClockSample } from '@/lib/time/networkClock';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * SWARM MESH — Production P2P Connection & Content Serving Script
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Cloned from builderMode.standalone.ts — the proven working foundation.
 * Fully self-contained. Zero imports from other project modules.
 *
 * Key differences from Builder Mode:
 *   - AUTO-CONNECTS via Cascade: Global Cell → Library → Manual fallback
 *   - Discovery via Gun.js Public Cell beacons (45s interval, 75s freshness)
 *   - Cell-based retry: if no peers found, retries every 30s using cell discoveries
 *   - Mining enabled by default (automatic upon connection)
 *   - Library exchange: connected peers share their contact lists for mesh growth
 *
 * Design principles (inherited from TestMode cornerstone):
 *   - No abort controllers — clean lifecycle
 *   - No shared state with other modules
 *   - PeerJS instance is never re-created while one is still alive
 *   - Identity is sacred: same Peer ID across all sessions
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Inline Utilities ───────────────────────────────────────────────────

function hexId(bytes = 8): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The fields of a chain block this file reads (full type lives in blockchain/types). */
interface SwarmBlockShape {
  index: number;
  hash: string;
  previousHash: string;
  [key: string]: unknown;
}

function now(): number {
  return Date.now();
}

// Keep this module standalone: guest identities may relay, but never mine.
export function isGuestMiningSession(): boolean {
  try {
    const user = JSON.parse(localStorage.getItem('me') || 'null');
    return user?._guest === true;
  } catch { return true; }
}

// ── Network Genesis — inline helpers (standalone, no imports) ──────────

const NETWORK_GENESIS_KEY = 'swarm-network-genesis';

function getNetworkGenesisTimestamp(): number {
  try {
    const stored = localStorage.getItem(NETWORK_GENESIS_KEY);
    if (stored) {
      const ts = parseInt(stored, 10);
      if (!isNaN(ts) && ts > 0) return ts;
    }
  } catch { /* ignore */ }
  try {
    const birth = localStorage.getItem('entity-voice-birth-timestamp');
    if (birth) {
      const ts = parseInt(birth, 10);
      if (!isNaN(ts) && ts > 0) return ts;
    }
  } catch { /* ignore */ }
  return Date.now();
}

function adoptOlderGenesis(peerGenesis: number): boolean {
  if (!peerGenesis || isNaN(peerGenesis) || peerGenesis <= 0) return false;
  const n = Date.now();
  if (peerGenesis > n + 3600_000) return false;
  if (peerGenesis < new Date('2024-01-01').getTime()) return false;
  const current = getNetworkGenesisTimestamp();
  if (peerGenesis < current) {
    try { localStorage.setItem(NETWORK_GENESIS_KEY, String(peerGenesis)); } catch { /* ignore */ }
    console.log(`[SwarmMesh] 🌱 Adopted older network genesis: ${new Date(peerGenesis).toISOString()}`);
    return true;
  }
  return false;
}

// ── Storage Keys ───────────────────────────────────────────────────────

const KEYS = {
  NODE_ID: 'swarm-mesh-node-id',
  FLAGS: 'swarm-mesh-flags',
  TOGGLES: 'swarm-mesh-toggles',
  CONNECTION_LIBRARY: 'swarm-mesh-connection-library',
  BLOCKED_PEERS: 'swarm-mesh-blocked-peers',
  MINING_STATS: 'swarm-mesh-mining-stats',
} as const;

// ── Types ──────────────────────────────────────────────────────────────

export type SwarmPhase =
  | 'off'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'failed';

export interface SwarmFlags {
  enabled: boolean;
  lastOnlineAt: number | null;
}

export interface SwarmToggles {
  autoConnect: boolean;
  mining: boolean;
  libraryExchange: boolean;
}

export interface SwarmPeer {
  peerId: string;
  connectedAt: number;
  lastActivity: number;
  messagesReceived: number;
  messagesSent: number;
  avgRttMs: number | null;
  lastRttMs: number | null;
  source: 'bootstrap' | 'library' | 'manual' | 'exchange';
  /** Timestamp of last mining broadcast received from this peer */
  lastMinedBlock: number | null;
  /** RTT measured from mining-ack round-trip */
  miningRtt: number | null;
}

export interface LibraryPeer {
  peerId: string;
  userId?: string;
  walletAddress?: string;
  namespaceId?: string;
  discriminator?: string;
  connectedDurationMs?: number;
  lastInteractionAt?: number;
  nodeId: string;
  alias: string;
  addedAt: number;
  lastSeenAt: number;
  autoConnect: boolean;
  source: 'bootstrap' | 'library' | 'manual' | 'exchange';
  displayName?: string;
  username?: string;
  avatarRef?: string;
  /** Trust score computed from mining + content contribution (0-1) */
  trustScore?: number;
}

export interface ContentItem {
  id: string;
  type: 'post' | 'chunk' | 'comment' | 'project';
  data: unknown;
  author: string;
  timestamp: number;
  hash: string;
}

export interface MiningStats {
  /** Blocks produced by this node */
  blocksMinedTotal: number;
  /** Blocks received & relayed from other peers */
  blocksRelayed: number;
  /** Peer discovery events facilitated (PEX exchanges) */
  peersDiscovered: number;
  /** Heartbeats sent to keep mesh alive */
  heartbeatsSent: number;
  /** Heartbeat acks received back */
  heartbeatsReceived: number;
  /** Data chunks served to peers (content sync) */
  chunksServed: number;
  /** Mining-acks received (connection quality probes answered) */
  acksReceived: number;
  /** Timestamp of last block mined (ms) */
  lastBlockMinedAt: number | null;
  /** Timestamp of last heartbeat sent (ms) */
  lastHeartbeatAt: number | null;

  // ── CREATOR Proof Fields ──
  /** Blocks confirmed by mesh consensus */
  confirmedBlocks: number;
  /** Blocks mined but awaiting peer votes */
  pendingBlocks: number;
  /** Blocks without content activity (reduced reward) */
  hollowBlocks: number;
  /** Hollow blocks that later reached consensus (paid at 50%) */
  confirmedHollowBlocks: number;
  /** Timestamp of last consensus-confirmed block */
  lastConfirmedAt: number | null;
  /** Content activity multiplier (1.0 base, up to 2.0 for active seeders) */
  contentMultiplier: number;
  /** Whether the node is currently seeding content */
  seedingActive: boolean;
  /** Chunks served since last block was mined */
  chunksServedSinceLastBlock: number;
  /** Current block height (confirmed) */
  blockHeight: number;
  /** Blocks that failed consensus */
  consensusFailures: number;

  // ── Legacy (kept for backward compat with stored data) ──
  /** @deprecated use blocksRelayed */
  transactionsProcessed: number;
  /** @deprecated use chunksServed */
  spaceHosted: number;
}

export interface SwarmMeshStandaloneStats {
  phase: SwarmPhase;
  peerId: string | null;
  nodeId: string;
  connectedPeers: number;
  contentItems: number;
  uptimeMs: number;
  reconnectAttempt: number;
  flags: SwarmFlags;
  toggles: SwarmToggles;
  miningStats: MiningStats;
  bootstrapOnline: number;
  libraryOnline: number;
  assetSync: AssetSyncStats;
}

export interface AssetSyncStats {
  manifestsPulled: number;
  chunksPulled: number;
  chunksServed: number;
  pendingManifests: number;
  activeRetries: number;
  queuedOffline?: number;
}

type ConnectionSource = 'bootstrap' | 'library' | 'manual' | 'exchange';

type SwarmSignalingEndpoint = SignalingEndpoint;

type PhaseHandler = (phase: SwarmPhase) => void;
type PeerHandler = (peers: SwarmPeer[]) => void;
type ContentHandler = (item: ContentItem) => void;
type ContentChangeHandler = (items: ContentItem[]) => void;
type AlertHandler = (message: string, level: 'info' | 'warn' | 'error') => void;
type LibraryHandler = (peers: LibraryPeer[]) => void;
type ToggleHandler = (toggles: SwarmToggles) => void;
type MiningHandler = (stats: MiningStats) => void;

interface PendingAssetRequest {
  resolve: (message: Record<string, unknown> | null) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  expectedType: 'manifest-response' | 'chunk-response';
}

interface StoredManifestLike {
  fileId?: string;
  chunks?: string[];
  fileKey?: string;
  [key: string]: unknown;
}

interface StoredChunkLike {
  ref?: string;
  [key: string]: unknown;
}

// ── Constants ──────────────────────────────────────────────────────────

const RECONNECT_INTERVALS = [15_000, 30_000, 60_000] as const;
/** After the fast reconnects run out, keep trying slowly instead of giving up. */
export const FAILED_RECONNECT_RETRY_MS = 2 * 60_000;
const SIGNALING_RECOVERY_FIRST_MS = 1_500;
const SIGNALING_RECOVERY_RETRY_MS = 5_000;
const SIGNALING_RECOVERY_MAX_ATTEMPTS = 4;
const PEERJS_INIT_TIMEOUT = 12_000;
const CONTENT_SYNC_INTERVAL = 10_000;
const MARKET_SYNC_INTERVAL = 60_000;
const HEARTBEAT_INTERVAL = 8_000;
const CLOCK_BURST_PINGS = 4;
const CLOCK_BURST_GAP_MS = 250;
const PEER_STALE_THRESHOLD = 60_000; // ~7 missed heartbeats before eviction
const PEER_STALE_THRESHOLD_MINING = 120_000; // Extended for actively mining peers
/**
 * A quiet peer whose data channel and connection are still open is almost
 * always a throttled background tab (browsers run its timers about once a
 * minute) or a busy Brain frame, not a dead link: ICE consent checks close
 * dead links on their own. Keep such a link this long before evicting it.
 */
export const PEER_QUIET_LIVE_LINK_MAX_MS = 5 * 60_000;
/** Redial a dropped peer this soon instead of waiting for the next loop. */
const DROPPED_PEER_REDIAL_DELAY_MS = 3_000;

/** Pure: should the heartbeat sweep evict a peer that has been quiet `idleMs`? */
export function shouldEvictQuietPeer(idleMs: number, thresholdMs: number, linkLive: boolean): boolean {
  if (idleMs <= thresholdMs) return false;
  return !linkLive || idleMs > PEER_QUIET_LIVE_LINK_MAX_MS;
}
const MINING_COLD_THRESHOLD = 45_000; // 3 × MINING_INTERVAL — no blocks = "cold"
const LIBRARY_RECONNECT_INTERVAL = 30_000;
const MINING_INTERVAL = 15_000;
const CASCADE_SETTLE_TIME = 8_000;
const CASCADE_POLL_INTERVAL = 300; // Check for connection every 300ms
const SIGNALING_ENDPOINT_STORAGE_KEY = 'p2p-signaling-endpoint-id';
const ASSET_REQUEST_TIMEOUT_MS = 10_000;
const ASSET_RETRY_INTERVAL_MS = 2_500;
const ASSET_RETRY_MAX_ATTEMPTS = 24;
const EXHAUSTED_RETRIES_KEY = 'swarm-exhausted-retries';

/**
 * Global Cell freshness window — must match GLOBAL_CELL_STALE_THRESHOLD
 * in globalCell.ts (75s). Peers not seen within this window are considered
 * offline and will NOT be auto-dialed.
 */
const CELL_FRESHNESS_WINDOW = 75_000;
/**
 * Saved contacts roll through the mesh in every library exchange while they
 * were seen within the last ten days. This discovery window is independent
 * of content retention; old saved contacts remain local, not handed on.
 */
export const SAVED_CONTACT_SHARE_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;
/** Upper bound on saved contacts sent in one exchange (newest first). */
const MAX_SHARED_SAVED_CONTACTS = 200;
/** Saved (manual/library) friends stay dialable this long after last presence. */
export const SAVED_FRIEND_FRESHNESS_WINDOW = 10 * 60_000;

/** Cooldown between auto-dials to the same peer via Global Cell (steady state) */
const CELL_DIAL_COOLDOWN = 30_000;

/** Faster cooldown used while the mesh has very few connections, so a
 *  fresh isolated pair can quickly retry a third peer after a failed dial. */
const CELL_DIAL_COOLDOWN_FAST = 10_000;

/** Threshold under which we use the fast cooldown */
const CELL_DIAL_FAST_THRESHOLD = 4;

/** Target mesh size — grow beyond triangles to full mesh */
const TARGET_MESH_CONNECTIONS = 20;

/** Max dials per pass — enough to grow but avoid dial storms */
const MAX_AUTO_DIALS_PER_PASS = 5;

/**
 * Expire stuck pending dials so the mesh can retry cleanly. Slow devices can
 * take well over 20s to finish ICE; retrying sooner stacks a second offer on
 * top of one that was still working.
 */
const PENDING_DIAL_TIMEOUT_MS = 45_000;

function getExhaustedRetries(): Set<string> {
  try {
    const raw = localStorage.getItem(EXHAUSTED_RETRIES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function markRetryExhausted(manifestId: string): void {
  try {
    const set = getExhaustedRetries();
    set.add(manifestId);
    // Keep only last 200 entries to prevent bloat
    const arr = Array.from(set);
    if (arr.length > 200) arr.splice(0, arr.length - 200);
    localStorage.setItem(EXHAUSTED_RETRIES_KEY, JSON.stringify(arr));
  } catch { /* noop */ }
}

function clearRetryExhausted(manifestId: string): void {
  try {
    const set = getExhaustedRetries();
    set.delete(manifestId);
    localStorage.setItem(EXHAUSTED_RETRIES_KEY, JSON.stringify(Array.from(set)));
  } catch { /* noop */ }
}

const DEFAULT_ICE: RTCIceServer[] = DEFAULT_ICE_SERVERS;

// Ordered failover list: configured servers (VITE_PEERJS_*) first, PeerJS
// Cloud last. See signalingEndpoints.ts for why every node walks one order.
const DEFAULT_SIGNALING_ENDPOINTS: SwarmSignalingEndpoint[] = resolveSignalingEndpoints(
  (import.meta.env ?? {}) as Record<string, string | boolean | undefined>,
);

/** How long a manual dial requested mid-connect waits for the mesh to come online. */
const QUEUED_DIAL_TTL_MS = 60_000;

const DEFAULT_TOGGLES: SwarmToggles = {
  autoConnect: true,
  mining: true,
  libraryExchange: true,
};

// ═══════════════════════════════════════════════════════════════════════
// STANDALONE SWARM MESH CLASS
// ═══════════════════════════════════════════════════════════════════════

export class StandaloneSwarmMesh {
  // ── Identity (sacred, never changes) ──────────────────────────────
  private readonly nodeId: string;
  private readonly peerId: string;

  // ── PeerJS ────────────────────────────────────────────────────────
  private peer: import('peerjs').default | null = null;
  private connections = new Map<string, import('peerjs').DataConnection>();
  private librarySentConnections = new WeakSet<import('peerjs').DataConnection>();
  private peerData = new Map<string, SwarmPeer>();

  // ── State Machine ─────────────────────────────────────────────────
  private phase: SwarmPhase = 'off';
  private flags: SwarmFlags;
  private toggles: SwarmToggles;
  private startedAt: number | null = null;

  // ── Reconnect ─────────────────────────────────────────────────────
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private signalingRotation = new SignalingEndpointRotation(DEFAULT_SIGNALING_ENDPOINTS);
  /** Manual dials requested while signaling was still connecting (peerId → requestedAt). */
  private queuedManualDials = new Map<string, number>();

  // ── Content Store ─────────────────────────────────────────────────
  private contentStore = new Map<string, ContentItem>();
  private pendingAssetRequests = new Map<string, PendingAssetRequest>();
  private assetRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private assetRetryAttempts = new Map<string, number>();
  /** Manifests parked while offline — drained when any peer connects. */
  private pendingAssetQueue = new Map<string, string | undefined>();
  private _assetSyncCounters = { manifestsPulled: 0, chunksPulled: 0, chunksServed: 0 };
  /** Tracks which peers are seeding which files (manifestId → Set of peerIds) */
  private fileSeeders = new Map<string, Set<string>>();

  // ── Connection Library (persisted) ────────────────────────────────
  private library = new Map<string, LibraryPeer>();
  private blockedPeers = new Set<string>();

  // ── Mining ────────────────────────────────────────────────────────
  private miningStats: MiningStats;
  private miningTimer: ReturnType<typeof setInterval> | null = null;
  // ── CREATOR Proof: pending block vote tracking ──
  /** Shared chain: hashes of chain blocks already handled (no re-relay loops). */
  private seenChainBlocks = new Set<string>();
  /** Shared chain: sync pages collected per peer until the last one arrives. */
  private chainSyncPages = new Map<string, { fromIndex: number; blocks: Record<string, unknown>[] }>();
  private pendingBlockVotes = new Map<string, { blockId: string; height: number; minedAt: number; votes: Map<string, boolean>; totalPeers: number; isHollow: boolean }>();
  private pendingBlockExpiry: ReturnType<typeof setTimeout>[] = [];

  // ── General cell-based retry timer ─────────────────────────────────
  private cellRetryTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Peer-unavailable cooldown (peerId → timestamp) ────────────────
  private peerCooldowns = new Map<string, number>();
  /** @deprecated peer-unavailable no longer triggers cooldowns */
  private static readonly PEER_COOLDOWN_MS = 5 * 60 * 1000;

  // ── Handshake failure tracking (peerId → consecutive failures) ────
  private handshakeFailures = new Map<string, number>();
  private handshakeFailureCooldowns = new Map<string, number>(); // peerId → cooldown-until timestamp
  private pendingDials = new Map<string, number>();
  private static readonly HANDSHAKE_FAILURE_MAX = 3;
  private static readonly HANDSHAKE_FAILURE_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes (reduced from 15)

  private isPeerCoolingDown(peerId: string): boolean {
    const lastFail = this.peerCooldowns.get(peerId);
    if (lastFail && now() - lastFail < StandaloneSwarmMesh.PEER_COOLDOWN_MS) return true;
    if (lastFail && now() - lastFail >= StandaloneSwarmMesh.PEER_COOLDOWN_MS) this.peerCooldowns.delete(peerId);

    // Also check handshake failure cooldown
    const hsCooldown = this.handshakeFailureCooldowns.get(peerId);
    if (hsCooldown && now() < hsCooldown) return true;
    if (hsCooldown && now() >= hsCooldown) {
      this.handshakeFailureCooldowns.delete(peerId);
      this.handshakeFailures.delete(peerId);
    }

    return false;
  }

  private recordHandshakeFailure(peerId: string): void {
    const count = (this.handshakeFailures.get(peerId) ?? 0) + 1;
    this.handshakeFailures.set(peerId, count);
    if (count >= StandaloneSwarmMesh.HANDSHAKE_FAILURE_MAX) {
      this.handshakeFailureCooldowns.set(peerId, now() + StandaloneSwarmMesh.HANDSHAKE_FAILURE_COOLDOWN_MS);
      console.log(`[SwarmMesh] ⛔ Peer ${peerId.slice(0, 16)} hit ${count} handshake failures — 15min cooldown`);
    }
  }

  private clearHandshakeFailures(peerId: string): void {
    this.handshakeFailures.delete(peerId);
    this.handshakeFailureCooldowns.delete(peerId);
  }

  private restorePeerEligibility(peerId: string): void {
    this.peerCooldowns.delete(peerId);
    this.clearHandshakeFailures(peerId);
    this.globalCellDialCooldowns.delete(peerId);
  }

  private pulseGlobalPresence(reason: string): void {
    void import('./globalCell')
      .then(({ getGlobalCell }) => {
        getGlobalCell().pulsePresence(reason);
      })
      .catch(() => { /* ignore */ });
  }

  private schedulePresencePulse(reason: string, delayMs = 1_500): void {
    setTimeout(() => {
      if (this.phase !== 'online') return;
      if (this.connections.size >= TARGET_MESH_CONNECTIONS) return;
      this.pulseGlobalPresence(reason);
    }, delayMs);
  }

  private scheduleMeshExpansion(reason: string, preferredPeerIds: string[] = [], delayMs = 1_500): void {
    setTimeout(() => {
      if (this.phase !== 'online' || !this.toggles.autoConnect) return;
      this.expandOnlineMesh(reason, preferredPeerIds);
    }, delayMs);
  }

  /**
   * Central freshness gate — used by ALL automatic dial paths.
   * Saved friends use a longer presence window, never disabled auto-connect.
   * Ephemeral discovery still requires recent Cell or active-peer presence.
   * Cooldowns and pending-dial limits remain enforced by automatic callers.
   */

  private isFreshEnoughToDial(peerId: string): boolean {
    const entry = this.library.get(peerId);
    if (!entry || !entry.autoConnect) return false;
    if (entry.lastSeenAt <= 0) return false;
    const age = now() - entry.lastSeenAt;
    // Saved friends get a longer presence window; nobody is dialed forever.
    const saved = entry.source === 'manual' || entry.source === 'library';
    return age < (saved ? SAVED_FRIEND_FRESHNESS_WINDOW : CELL_FRESHNESS_WINDOW);
  }

  private prunePendingDials(): void {
    const cutoff = now() - PENDING_DIAL_TIMEOUT_MS;
    for (const [peerId, startedAt] of this.pendingDials) {
      if (startedAt < cutoff) {
        this.pendingDials.delete(peerId);
      }
    }
  }

  private isDialPending(peerId: string): boolean {
    this.prunePendingDials();
    return this.pendingDials.has(peerId);
  }

  private markDialPending(peerId: string): boolean {
    this.prunePendingDials();
    if (this.pendingDials.has(peerId)) return false;
    this.pendingDials.set(peerId, now());
    return true;
  }

  private clearPendingDial(peerId: string): void {
    this.pendingDials.delete(peerId);
  }

  private getAutoDialBudget(): number {
    this.prunePendingDials();
    const occupiedSlots = this.connections.size + this.pendingDials.size;
    return Math.max(0, Math.min(MAX_AUTO_DIALS_PER_PASS, TARGET_MESH_CONNECTIONS - occupiedSlots));
  }

  private getFreshExpansionCandidates(preferredPeerIds: string[] = []): Array<{
    peerId: string;
    source: ConnectionSource;
    trustScore: number;
    userId?: string;
    lastSeenAt: number;
    preferred: boolean;
  }> {
    const preferred = new Set(preferredPeerIds);
    const candidates: Array<{
      peerId: string;
      source: ConnectionSource;
      trustScore: number;
      lastSeenAt: number;
      preferred: boolean;
    }> = [];

    for (const [peerId, entry] of this.library) {
      if (peerId === this.peerId || this.blockedPeers.has(peerId) || this.connections.has(peerId)) continue;
      if (this.isDialPending(peerId) || this.isPeerCoolingDown(peerId)) continue;
      if (!this.isFreshEnoughToDial(peerId)) continue;

      candidates.push({
        peerId,
        source: entry.source ?? 'exchange',
        trustScore: entry.trustScore ?? 0.3,
        lastSeenAt: entry.lastSeenAt,
        preferred: preferred.has(peerId),
      });
    }

    candidates.sort((a, b) => {
      if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
      const trustDiff = b.trustScore - a.trustScore;
      if (Math.abs(trustDiff) > 0.01) return trustDiff;
      return b.lastSeenAt - a.lastSeenAt;
    });

    return candidates;
  }

  private expandOnlineMesh(reason: string, preferredPeerIds: string[] = []): void {
    if (this.phase !== 'online' || !this.toggles.autoConnect) return;
    const dialBudget = this.getAutoDialBudget();
    if (dialBudget === 0) return;

    const selected = this.getFreshExpansionCandidates(preferredPeerIds).slice(0, dialBudget);
    if (selected.length === 0) return;

    console.log(
      `[SwarmMesh] 🕸️ Mesh expand (${reason}) — dialing ${selected.length} peer(s): ` +
      selected.map(candidate => `${candidate.peerId.slice(0, 12)}:${candidate.trustScore.toFixed(2)}`).join(', ')
    );

    const currentTime = now();
    for (const candidate of selected) {
      this.recordCellDiagnostic(candidate.peerId, 'expand-dial', `${reason}, trust=${candidate.trustScore.toFixed(2)}`);
      const started = this.dialPeer(candidate.peerId, candidate.source);
      if (started && reason === 'cell-discovery') {
        this.globalCellDialCooldowns.set(candidate.peerId, currentTime);
      }
    }
  }

  // ── Global Cell subscription ───────────────────────────────────────
  private globalCellChannel: BroadcastChannel | null = null;

  private globalCellDialCooldowns = new Map<string, number>();

  private inviteKnockUnsub: (() => void) | null = null;

  /** A peer knocked: remember them and dial back through the backoff-respecting Bus path. */
  private handleIncomingInviteKnock(callerPeerId: string): void {
    if (this.blockedPeers.has(callerPeerId) || this.connections.has(callerPeerId)) return;
    this.addToLibrary(callerPeerId, 'manual');
    this.clearHandshakeFailures(callerPeerId);
    this.peerCooldowns.delete(callerPeerId);
    this.dialViaBus(callerPeerId);
  }

  private subscribeGlobalCell(): void {
    if (!this.inviteKnockUnsub) {
      this.inviteKnockUnsub = () => {};
      void import('./globalCell').then(({ getGlobalCell }) => {
        this.inviteKnockUnsub = getGlobalCell().onInviteKnock(id => this.handleIncomingInviteKnock(id));
      }).catch(() => { this.inviteKnockUnsub = null; });
    }
    if (this.globalCellChannel) return;
    try {
      this.globalCellChannel = new BroadcastChannel('global-cell-peers');
      this.globalCellChannel.onmessage = (ev: MessageEvent) => {
        const data = ev.data as { type?: string; peers?: Array<{ peerId: string; trustScore: number; lastSeenAt: number }> };
        if (data?.type !== 'discovered' || !Array.isArray(data.peers)) return;

        let imported = 0;
        let refreshed = 0;
        const currentTime = now();

        // ── Stage 1: Import / update all discovered peers ──
        for (const gp of data.peers) {
          if (!gp.peerId || gp.peerId === this.peerId || this.blockedPeers.has(gp.peerId)) {
            this.recordCellDiagnostic(gp.peerId, 'rejected', this.blockedPeers.has(gp.peerId) ? 'blocked' : 'self-or-empty');
            continue;
          }

          if (!this.library.has(gp.peerId)) {
            this.library.set(gp.peerId, {
              peerId: gp.peerId,
              nodeId: gp.peerId.replace(/^peer-/, ''),
              alias: `Node ${gp.peerId.slice(5, 11)}`,
              addedAt: currentTime,
              lastSeenAt: gp.lastSeenAt,
              autoConnect: true,
              source: 'exchange',
              trustScore: gp.trustScore,
            });
            imported++;
          } else {
            const existing = this.library.get(gp.peerId)!;
            if (gp.lastSeenAt > existing.lastSeenAt) {
              existing.lastSeenAt = gp.lastSeenAt;
              refreshed++;
            }
            if (typeof gp.trustScore === 'number') existing.trustScore = gp.trustScore;
          }

          if (gp.lastSeenAt > currentTime - CELL_FRESHNESS_WINDOW) {
            this.restorePeerEligibility(gp.peerId);
          }
        }

        if (imported > 0 || refreshed > 0) {
          this.saveLibrary();
        }

        const preferredPeerIds: string[] = [];
        for (const gp of data.peers) {
          if (!gp.peerId || gp.peerId === this.peerId || this.blockedPeers.has(gp.peerId)) continue;
          if (gp.lastSeenAt <= currentTime - CELL_FRESHNESS_WINDOW) {
            this.recordCellDiagnostic(gp.peerId, 'rejected', 'stale');
            continue;
          }
          const lastDial = this.globalCellDialCooldowns.get(gp.peerId) ?? 0;
          const cooldown = this.connections.size < CELL_DIAL_FAST_THRESHOLD
            ? CELL_DIAL_COOLDOWN_FAST
            : CELL_DIAL_COOLDOWN;
          if (currentTime - lastDial < cooldown) {
            this.recordCellDiagnostic(gp.peerId, 'rejected', 'cooldown');
            continue;
          }
          preferredPeerIds.push(gp.peerId);
        }

        this.expandOnlineMesh('cell-discovery', preferredPeerIds);
        if (preferredPeerIds.length > 0) {
          this.scheduleMeshExpansion('cell-discovery-followup', preferredPeerIds, 1_500);
          this.scheduleMeshExpansion('cell-discovery-followup', preferredPeerIds, 5_000);
        }

        // Cold-start safety net: if we're online but isolated and a cell
        // peer just appeared, run a full cascade immediately rather than
        // waiting for the next periodic retry. expandOnlineMesh handles
        // steady-state expansion; cascadeConnect handles the first dial.
        if (
          this.phase === 'online' &&
          this.connections.size === 0 &&
          preferredPeerIds.length > 0
        ) {
          console.log('[SwarmMesh] 🌐 First cell peer while isolated — forcing cascade');
          void this.cascadeConnect();
        }
      };
      console.log('[SwarmMesh] 🌐 Subscribed to Global Cell peer discoveries');

      // Note: initial cell seeding now happens in connectSignaling() before cascade
    } catch {
      console.warn('[SwarmMesh] BroadcastChannel unavailable for Global Cell');
    }
  }

  /**
   * Record a diagnostics event for cell operations.
   */
  private recordCellDiagnostic(peerId: string | null, action: string, detail: string): void {
    try {
      import('./diagnostics').then(({ recordP2PDiagnostic }) => {
        recordP2PDiagnostic({
          level: action.includes('rejected') ? 'warn' : 'info',
          source: 'bootstrap',
          code: `cell-${action}`,
          message: peerId
            ? `Cell ${action}: ${peerId.slice(0, 16)} — ${detail}`
            : `Cell ${action}: ${detail}`,
          context: { peerId, action, detail },
        });
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  private teardownGlobalCell(): void {
    this.globalCellChannel?.close();
    this.globalCellChannel = null;
  }

  /**
   * After going online, wait briefly for the GlobalCell to surface its
   * first peer before running the cascade. Bounded so a truly cold cell
   * still cascades within ~3 s.
   */
  private async awaitCellThenCascade(): Promise<void> {
    const deadline = now() + 3_000;
    const pollMs = 250;
    try {
      const { getGlobalCell } = await import('./globalCell');
      while (now() < deadline) {
        if (this.phase !== 'online') return;
        const known = getGlobalCell().getKnownPeers();
        if (known.length > 0) {
          console.log(`[SwarmMesh] 🌐 Cell warm (${known.length} peer(s)) — cascading`);
          break;
        }
        await this.sleep(pollMs);
      }
    } catch {
      // GlobalCell unavailable — fall through to cascade anyway
    }
    if (this.phase === 'online') void this.cascadeConnect();
  }

  // ── Intervals ─────────────────────────────────────────────────────
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private contentSyncTimer: ReturnType<typeof setInterval> | null = null;
  private libraryReconnectTimer: ReturnType<typeof setInterval> | null = null;
  private marketSyncTimer: ReturnType<typeof setInterval> | null = null;

  // ── Event Handlers ────────────────────────────────────────────────
  private phaseHandlers = new Set<PhaseHandler>();
  private peerHandlers = new Set<PeerHandler>();
  private contentHandlers = new Set<ContentHandler>();
  private contentChangeHandlers = new Set<ContentChangeHandler>();
  private alertHandlers = new Set<AlertHandler>();
  private libraryHandlers = new Set<LibraryHandler>();
  private toggleHandlers = new Set<ToggleHandler>();
  private miningHandlers = new Set<MiningHandler>();

  // ── Guard ─────────────────────────────────────────────────────────
  private initInProgress = false;
  private visibilityHandler: (() => void) | null = null;

  constructor() {
    this.nodeId = this.loadOrCreateNodeId();
    this.peerId = `peer-${this.nodeId}`;
    this.flags = this.loadFlags();
    this.toggles = this.loadToggles();
    this.miningStats = this.loadMiningStats();
    this.loadLibrary();
    this.loadBlockedPeers();
    this.setupVisibilityHandler();
    this.watchUnsupportedPosts();

    this.saveLibrary();

    console.log(
      `[SwarmMesh] Identity: nodeId=${this.nodeId} peerId=${this.peerId}, toggles=${JSON.stringify(this.toggles)}, library=${this.library.size}, blocked=${this.blockedPeers.size}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // VISIBILITY — Reconnect when tab regains focus
  // ═══════════════════════════════════════════════════════════════════

  private setupVisibilityHandler(): void {
    if (typeof document === 'undefined') return;
    this.visibilityHandler = () => {
      if (document.visibilityState !== 'visible') return;
      if (!this.flags.enabled) return;
      if (this.phase === 'online' || this.phase === 'connecting' || this.phase === 'reconnecting') return;
      console.log('[SwarmMesh] 👁️ Tab visible — auto-reconnecting');
      void this.start();
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
    if (typeof window !== 'undefined') {
      // The network came back: retry now rather than at the next backoff tick.
      window.addEventListener('online', () => this.retryFromFailed('network online'));
    }
  }

  private teardownVisibilityHandler(): void {
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // IDENTITY — shared with TestMode, never rotates
  // ═══════════════════════════════════════════════════════════════════

  private loadOrCreateNodeId(): string {
    try {
      const testModeId = localStorage.getItem('test-mode-node-id');
      if (testModeId && testModeId.length >= 8) {
        localStorage.setItem(KEYS.NODE_ID, testModeId);
        return testModeId;
      }
    } catch { /* ignore */ }

    try {
      const stored = localStorage.getItem(KEYS.NODE_ID);
      if (stored && stored.length >= 8) return stored;
    } catch { /* ignore */ }

    const id = hexId(8);
    try { localStorage.setItem(KEYS.NODE_ID, id); } catch { /* ignore */ }
    console.log('[SwarmMesh] Generated new node ID:', id);
    return id;
  }

  getNodeId(): string { return this.nodeId; }
  getPeerId(): string { return this.peerId; }
  /** Signaling server the mesh is currently on (follows failover). */
  getSignalingEndpoint(): SignalingEndpoint { return this.signalingRotation.current(); }

  // ═══════════════════════════════════════════════════════════════════
  // FLAGS
  // ═══════════════════════════════════════════════════════════════════

  private loadFlags(): SwarmFlags {
    try {
      const raw = localStorage.getItem(KEYS.FLAGS);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          enabled: typeof p.enabled === 'boolean' ? p.enabled : false,
          lastOnlineAt: typeof p.lastOnlineAt === 'number' ? p.lastOnlineAt : null,
        };
      }
    } catch { /* ignore */ }
    return { enabled: false, lastOnlineAt: null };
  }

  private saveFlags(): void {
    try { localStorage.setItem(KEYS.FLAGS, JSON.stringify(this.flags)); } catch { /* ignore */ }
  }

  getFlags(): SwarmFlags { return { ...this.flags }; }

  // ═══════════════════════════════════════════════════════════════════
  // TOGGLES — Persisted user controls
  // ═══════════════════════════════════════════════════════════════════

  private loadToggles(): SwarmToggles {
    try {
      const raw = localStorage.getItem(KEYS.TOGGLES);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          autoConnect: typeof p.autoConnect === 'boolean' ? p.autoConnect : DEFAULT_TOGGLES.autoConnect,
          mining: typeof p.mining === 'boolean' ? p.mining : DEFAULT_TOGGLES.mining,
          libraryExchange: typeof p.libraryExchange === 'boolean' ? p.libraryExchange : DEFAULT_TOGGLES.libraryExchange,
        };
      }
    } catch { /* ignore */ }
    return { ...DEFAULT_TOGGLES };
  }

  private saveToggles(): void {
    try { localStorage.setItem(KEYS.TOGGLES, JSON.stringify(this.toggles)); } catch { /* ignore */ }
    this.emitToggles();
  }

  getToggles(): SwarmToggles { return { ...this.toggles }; }

  setToggle<K extends keyof SwarmToggles>(key: K, value: boolean): void {
    this.toggles[key] = value;
    this.saveToggles();
    console.log(`[SwarmMesh] Toggle ${key} → ${value}`);

    if (key === 'autoConnect' && value && this.phase === 'online') {
      // Turning auto-connect back on should reach out now, not at the next retry.
      this.pulseGlobalPresence('auto-connect-on');
      void this.cascadeConnect();
    }

    if (key === 'mining') {
      if (value && this.phase === 'online') {
        console.log('[SwarmMesh][Mining] ⛏️ TOGGLE ON — user enabled mining, phase is online → starting loop');
        this.startMiningLoop();
      } else if (value && this.phase !== 'online') {
        console.log(`[SwarmMesh][Mining] ⛏️ TOGGLE ON — but phase is "${this.phase}", mining deferred until online`);
      } else {
        console.log('[SwarmMesh][Mining] ⛏️ TOGGLE OFF — user disabled mining → stopping loop');
        this.stopMiningLoop();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MINING — Automatic by default, persisted stats
  // ═══════════════════════════════════════════════════════════════════

  private loadMiningStats(): MiningStats {
    const defaults: MiningStats = {
      blocksMinedTotal: 0, blocksRelayed: 0, peersDiscovered: 0,
      heartbeatsSent: 0, heartbeatsReceived: 0, chunksServed: 0,
      acksReceived: 0, lastBlockMinedAt: null, lastHeartbeatAt: null,
      confirmedBlocks: 0, pendingBlocks: 0, hollowBlocks: 0, confirmedHollowBlocks: 0,
      lastConfirmedAt: null, contentMultiplier: 1.0, seedingActive: false,
      chunksServedSinceLastBlock: 0, blockHeight: 0, consensusFailures: 0,
      transactionsProcessed: 0, spaceHosted: 0,
    };
    try {
      const raw = localStorage.getItem(KEYS.MINING_STATS);
      if (raw) {
        const p = JSON.parse(raw);
        const result = { ...defaults };
        for (const key of Object.keys(defaults) as (keyof MiningStats)[]) {
          if (key in p && typeof p[key] === typeof defaults[key]) {
            (result as Record<string, unknown>)[key] = p[key];
          } else if (key in p && typeof p[key] === 'number') {
            (result as Record<string, unknown>)[key] = p[key];
          }
        }
        // Stats saved before confirmedHollowBlocks existed: estimate it with
        // the mined hollow share so displays and rewards stay consistent.
        if (typeof p.confirmedHollowBlocks !== 'number') {
          const share = result.blocksMinedTotal > 0 ? Math.min(1, result.hollowBlocks / result.blocksMinedTotal) : 0;
          result.confirmedHollowBlocks = Math.round(result.confirmedBlocks * share);
        }
        return result;
      }
    } catch { /* ignore */ }
    return defaults;
  }

  private saveMiningStats(): void {
    try { localStorage.setItem(KEYS.MINING_STATS, JSON.stringify(this.miningStats)); } catch { /* ignore */ }
    this.emitMining();
  }

  getMiningStats(): MiningStats { return { ...this.miningStats }; }

  /** True while the block-production loop is actually running (toggle on, online, ≥1 peer). */
  isMiningActive(): boolean { return this.miningTimer !== null; }

  private startMiningLoop(): void {
    this.stopMiningLoop();
    if (isGuestMiningSession()) return;

    // ── Gate check: mining toggle ──
    if (!this.toggles.mining) {
      console.log('[SwarmMesh][Mining] ⛏️ START BLOCKED — mining toggle is OFF');
      return;
    }
    if (this.phase !== 'online') {
      console.log(`[SwarmMesh][Mining] ⛏️ START BLOCKED — phase is "${this.phase}" (need "online")`);
      return;
    }
    // ── Hard gate: require at least 1 active peer connection ──
    if (this.connections.size === 0) {
      console.log('[SwarmMesh][Mining] ⛏️ START BLOCKED — no peers connected. Mining requires active peer connections.');
      return;
    }

    // Let mining displays flip to "active" immediately (the timer is set below).
    queueMicrotask(() => this.emitMining());

    console.log(
      `[SwarmMesh][Mining] ⛏️ STARTED — interval=${MINING_INTERVAL}ms, ` +
      `peers=${this.connections.size}, blockHeight=${this.miningStats.blockHeight}`
    );

    this.miningTimer = setInterval(() => {
      if (isGuestMiningSession()) {
        this.stopMiningLoop();
        return;
      }
      // ── Per-tick gate checks ──
      if (this.phase !== 'online') {
        console.log(`[SwarmMesh][Mining] ⛏️ TICK HALTED — phase changed to "${this.phase}"`);
        this.stopMiningLoop();
        return;
      }
      if (!this.toggles.mining) {
        console.log('[SwarmMesh][Mining] ⛏️ TICK HALTED — mining toggle switched OFF mid-loop');
        this.stopMiningLoop();
        return;
      }
      // ── Hard gate: no peers = no mining ──
      if (this.connections.size === 0) {
        console.log('[SwarmMesh][Mining] ⛏️ TICK HALTED — all peers disconnected. Mining paused until a peer reconnects.');
        this.stopMiningLoop();
        return;
      }

      // ── CREATOR Proof: Check content activity ──
      let isHollow = true;
      let contentMultiplier = 1.0;
      let chunkDelta = 0;
      try {
        const torrent = this.torrentSwarmInstance;
        if (torrent) {
          const stats = torrent.getTotalStats();
          const seedingActive = stats.activeTorrents > 0;
          this.miningStats.seedingActive = seedingActive;
          chunkDelta = this.miningStats.chunksServedSinceLastBlock;
          if (seedingActive || stats.completedChunks > 0) {
            isHollow = false;
            // Content multiplier: more activity = higher bonus (cap 2.0)
            contentMultiplier = Math.min(2.0, 1.0 + (chunkDelta * 0.1) + (stats.activeTorrents * 0.2));
          }
          console.debug(
            `[SwarmMesh][Mining] 🎨 CREATOR PROOF — seeding=${seedingActive}, ` +
            `activeTorrents=${stats.activeTorrents}, chunksServed=${chunkDelta}, ` +
            `multiplier=${contentMultiplier.toFixed(2)}, hollow=${isHollow}`
          );
        } else {
          console.debug('[SwarmMesh][Mining] 🎨 CREATOR PROOF — no torrent swarm, block is HOLLOW');
        }
      } catch {
        console.debug('[SwarmMesh][Mining] 🎨 CREATOR PROOF — torrent check failed, block is HOLLOW');
      }

      this.miningStats.contentMultiplier = contentMultiplier;

      // ── Shared chain: the block reward is the only payout (Bitcoin-style) ──
      void this.mineChainBlock(isHollow);

      // ── Stage 1: Record block production ──
      this.miningStats.blocksMinedTotal += 1;
      this.miningStats.lastBlockMinedAt = now();
      this.miningStats.chunksServedSinceLastBlock = 0; // Reset per-block counter
      if (isHollow) this.miningStats.hollowBlocks++;

      const blockId = `blk-${this.nodeId}-${this.miningStats.blocksMinedTotal}-${now()}`;
      const proposedHeight = this.miningStats.blockHeight + 1;

      // ── Stage 2: Add to pending (awaiting consensus) ──
      this.miningStats.pendingBlocks++;
      this.saveMiningStats();

      const totalPeers = this.connections.size;
      this.pendingBlockVotes.set(blockId, {
        blockId,
        height: proposedHeight,
        minedAt: now(),
        votes: new Map(),
        totalPeers,
        isHollow,
      });

      console.debug(
        `[SwarmMesh][Mining] ⛏️ BLOCK #${this.miningStats.blocksMinedTotal} MINED (PENDING) — ` +
        `id=${blockId.slice(0, 20)}…, proposedHeight=${proposedHeight}, ` +
        `hollow=${isHollow}, peers=${totalPeers}, multiplier=${contentMultiplier.toFixed(2)}`
      );

      // ── Stage 3: Build enriched payload with CREATOR proof ──
      // Passive PEX must advertise only peers proven online right now,
      // not stale library entries, otherwise mesh expansion stalls.
      const librarySnapshot = this.getActiveExchangePeers()
        .map(peer => peer.peerId)
        .slice(0, 5);

      const payload = {
        type: 'blockchain-tx' as const,
        txId: `tx-${now()}-${Math.random().toString(36).slice(2, 6)}`,
        actionType: 'mining_reward' as const,
        pendingBlockId: blockId,
        minerBlockHeight: proposedHeight,
        meta: {
          blocksProduced: this.miningStats.blocksMinedTotal,
          blocksRelayed: this.miningStats.blocksRelayed,
          peerCount: this.connections.size,
          librarySnapshot,
          uptime: this.startedAt ? Math.floor((now() - this.startedAt) / 1000) : 0,
          blockHeight: proposedHeight,
          contentMultiplier,
          isHollow,
          confirmedBlocks: this.miningStats.confirmedBlocks,
        },
        minedAt: now(),
      };

      console.debug(
        `[SwarmMesh][Mining] ⛏️ BROADCAST → peers=${payload.meta.peerCount}, ` +
        `pexSnapshot=[${librarySnapshot.length} peers], blockHeight=${proposedHeight}, ` +
        `hollow=${isHollow}`
      );

      // ── Stage 4: Broadcast to mesh ──
      this.broadcastInternal(payload);

      // ── Stage 5: Consensus voting (solo mining is blocked by tick gate) ──
      if (totalPeers === 0) {
        // Should never reach here due to tick gate, but safety fallback
        console.warn('[SwarmMesh][Mining] ⚠️ UNEXPECTED — reached solo mining path despite gate. Discarding block.');
        this.pendingBlockVotes.delete(blockId);
        this.miningStats.pendingBlocks = Math.max(0, this.miningStats.pendingBlocks - 1);
        return;
      } else {
        // Set expiry: 2 mining cycles (30s) to get consensus
        const expiryTimer = setTimeout(() => {
          const pending = this.pendingBlockVotes.get(blockId);
          if (pending) {
            // Expire without consensus
            this.pendingBlockVotes.delete(blockId);
            this.miningStats.pendingBlocks = Math.max(0, this.miningStats.pendingBlocks - 1);
            this.miningStats.consensusFailures++;
            this.saveMiningStats();
            console.log(
              `[SwarmMesh][Mining] ❌ CONSENSUS FAILED — block ${blockId.slice(0, 20)}… expired, ` +
              `votes=${pending.votes.size}/${pending.totalPeers}`
            );
          }
        }, MINING_INTERVAL * 2);
        this.pendingBlockExpiry.push(expiryTimer);
      }
    }, MINING_INTERVAL);
  }

  private chainMiningBusy = false;

  /**
   * Mine one shared-chain block on the cadence. Its single reward is how
   * CREATOR work is paid; a hollow block pays half. Skips while the tip is
   * younger than the cadence spacing, so the mesh keeps one block per beat
   * instead of racing siblings.
   */
  private async mineChainBlock(hollow: boolean): Promise<void> {
    if (this.chainMiningBusy) return;
    this.chainMiningBusy = true;
    try {
      const [{ getSwarmChain }, { getCurrentUser }] = await Promise.all([
        import('../blockchain/chain'),
        import('../auth'),
      ]);
      const userId = getCurrentUser()?.id;
      if (!userId) return;
      const chain = getSwarmChain();
      await chain.whenReady();
      const tipAt = Date.parse(chain.getLatestBlock().timestamp);
      if (Number.isFinite(tipAt) && networkNow() - tipAt < CADENCE_SPACING_MS) return;
      const block = await chain.minePendingTransactions(userId, undefined, { allowEmpty: true, hollow });
      if (block) this.announceChainBlock(block);
    } catch (e) {
      console.debug('[SwarmMesh][Mining] chain block not mined', e);
    } finally {
      this.chainMiningBusy = false;
    }
  }

  /** Confirm a pending block after consensus or solo mining */
  private confirmBlock(blockId: string): void {
    const pending = this.pendingBlockVotes.get(blockId);
    if (!pending) return;

    this.pendingBlockVotes.delete(blockId);
    this.miningStats.pendingBlocks = Math.max(0, this.miningStats.pendingBlocks - 1);
    this.miningStats.confirmedBlocks++;
    if (pending.isHollow) this.miningStats.confirmedHollowBlocks++;
    this.miningStats.blockHeight = pending.height;
    this.miningStats.lastConfirmedAt = now();
    this.saveMiningStats();

    console.log(
      `[SwarmMesh][Mining] ✅ CONSENSUS REACHED — block ${blockId.slice(0, 20)}… CONFIRMED at height=${pending.height}, ` +
      `hollow=${pending.isHollow}, total confirmed=${this.miningStats.confirmedBlocks}`
    );
  }

  private stopMiningLoop(): void {
    if (this.miningTimer !== null) {
      clearInterval(this.miningTimer);
      this.miningTimer = null;
      this.emitMining();
      // Clear pending block expiry timers
      for (const t of this.pendingBlockExpiry) clearTimeout(t);
      this.pendingBlockExpiry = [];
      console.log(
        `[SwarmMesh][Mining] ⛏️ STOPPED — blockHeight=${this.miningStats.blockHeight}, ` +
        `confirmed=${this.miningStats.confirmedBlocks}, pending=${this.miningStats.pendingBlocks}`
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONNECTION LIBRARY — Persistent peer directory
  // ═══════════════════════════════════════════════════════════════════

  private loadLibrary(): void {
    try {
      const raw = localStorage.getItem(KEYS.CONNECTION_LIBRARY);
      if (raw) {
        for (const p of JSON.parse(raw) as LibraryPeer[]) {
          if (p.peerId) this.library.set(p.peerId, p);
        }
      }
    } catch { /* ignore */ }
  }

  private saveLibrary(): void {
    this.sanitizeLibrary();
    try {
      localStorage.setItem(KEYS.CONNECTION_LIBRARY, JSON.stringify(Array.from(this.library.values())));
    } catch { /* ignore */ }
    this.emitLibrary();
  }

  /** Keep the library durable for future/manual connections while removing invalid entries. */
  private sanitizeLibrary(): void {
    let cleaned = 0;
    for (const [peerId, entry] of this.library) {
      if (!peerId || peerId === this.peerId || this.blockedPeers.has(peerId)) {
        this.library.delete(peerId);
        cleaned++;
        continue;
      }

      if (!entry.nodeId) entry.nodeId = peerId.replace(/^peer-/, '');
      if (!entry.alias) entry.alias = `Node ${entry.nodeId.slice(0, 6)}`;
      if (typeof entry.addedAt !== 'number') entry.addedAt = now();
      if (typeof entry.lastSeenAt !== 'number') entry.lastSeenAt = 0;
      if (typeof entry.autoConnect !== 'boolean') entry.autoConnect = true;
      if (!entry.source) entry.source = 'library';
    }

    if (cleaned > 0) {
      console.log(`[SwarmMesh] 🧹 Cleaned ${cleaned} invalid library entr${cleaned === 1 ? 'y' : 'ies'}`);
    }
  }

  private addToLibrary(remotePeerId: string, source: ConnectionSource, metadata?: { nodeId?: string }): void {
    if (remotePeerId === this.peerId || this.blockedPeers.has(remotePeerId)) return;

    const nodeId = (metadata?.nodeId ?? remotePeerId.replace(/^peer-/, '').split('-')[0] ?? '').toLowerCase();

    // Dedupe by nodeId
    for (const [peerId, entry] of this.library) {
      if (peerId !== remotePeerId && entry.nodeId?.toLowerCase() === nodeId) {
        this.library.delete(peerId);
      }
    }

    const existing = this.library.get(remotePeerId);
    if (existing) {
      existing.lastSeenAt = now();
      existing.nodeId = nodeId;
      if (source === 'manual') {
        existing.source = 'manual';
        existing.autoConnect = true;
      } else if (source === 'library' && existing.source !== 'manual') {
        existing.source = 'library';
      }
      // Preserve profile data from prior profile-exchange
      this.saveLibrary();
      return;
    }

    this.library.set(remotePeerId, {
      peerId: remotePeerId,
      nodeId,
      alias: `Node ${nodeId.slice(0, 6)}`,
      addedAt: now(),
      lastSeenAt: now(),
      autoConnect: true,
      source,
    });
    this.saveLibrary();
    console.log(`[SwarmMesh] 📚 Added ${remotePeerId} to library (${source})`);
  }

  removeFromLibrary(remotePeerId: string): void {
    this.library.delete(remotePeerId);
    this.saveLibrary();
    const conn = this.connections.get(remotePeerId);
    if (conn) {
      try { conn.close(); } catch { /* ignore */ }
      this.connections.delete(remotePeerId);
      this.peerData.delete(remotePeerId);
      this.emitPeers();
    }
  }

  /** Update saved contacts without dialing or changing active connections. */
  rememberKnownPeer(peerIdOrNodeId: string, label?: string): void {
    const peerId = peerIdOrNodeId.startsWith('peer-') ? peerIdOrNodeId : `peer-${peerIdOrNodeId}`;
    if (peerId === this.peerId || this.blockedPeers.has(peerId)) return;
    const existing = this.library.get(peerId);
    if (existing) {
      if (label?.trim()) existing.alias = label.trim();
    } else {
      this.library.set(peerId, {
        peerId, nodeId: peerId.replace(/^peer-/, ''), alias: label?.trim() || `Node ${peerId.slice(5, 11)}`,
        addedAt: now(), lastSeenAt: 0, autoConnect: true, source: 'manual',
      });
    }
    this.saveLibrary();
  }

  forgetKnownPeer(peerId: string): void {
    this.library.delete(peerId);
    this.saveLibrary();
  }

  getLibrary(): LibraryPeer[] {
    const owner = this.getLocalProfile().userId;
    return Array.from(this.library.values()).map(peer => {
      const h = owner && peer.userId ? getConnectionAffinity(owner, peer.userId) : undefined;
      return { ...peer, connectedDurationMs: h?.connectedDurationMs, lastInteractionAt: h?.lastInteractionAt };
    });
  }

  onLibraryChange(handler: LibraryHandler): () => void {
    this.libraryHandlers.add(handler);
    handler(this.getLibrary());
    return () => { this.libraryHandlers.delete(handler); };
  }

  private emitLibrary(): void {
    const peers = this.getLibrary();
    for (const h of this.libraryHandlers) { try { h(peers); } catch { /* ignore */ } }
  }

  // ═══════════════════════════════════════════════════════════════════
  // BLOCKED PEERS
  // ═══════════════════════════════════════════════════════════════════

  private loadBlockedPeers(): void {
    try {
      const raw = localStorage.getItem(KEYS.BLOCKED_PEERS);
      if (raw) for (const id of JSON.parse(raw) as string[]) this.blockedPeers.add(id);
    } catch { /* ignore */ }
  }

  private saveBlockedPeers(): void {
    try { localStorage.setItem(KEYS.BLOCKED_PEERS, JSON.stringify(Array.from(this.blockedPeers))); } catch { /* ignore */ }
  }

  blockPeer(remotePeerId: string): void {
    this.blockedPeers.add(remotePeerId);
    this.saveBlockedPeers();
    this.library.delete(remotePeerId);
    this.saveLibrary();
    const conn = this.connections.get(remotePeerId);
    if (conn) {
      try { conn.close(); } catch { /* ignore */ }
      this.connections.delete(remotePeerId);
      this.peerData.delete(remotePeerId);
      this.emitPeers();
    }
    this.emitAlert(`Blocked ${remotePeerId.slice(0, 16)}`, 'info');
  }

  unblockPeer(remotePeerId: string): void {
    this.blockedPeers.delete(remotePeerId);
    this.saveBlockedPeers();
  }

  isBlocked(id: string): boolean { return this.blockedPeers.has(id); }
  getBlockedPeers(): string[] { return Array.from(this.blockedPeers); }

  // ═══════════════════════════════════════════════════════════════════
  // CASCADE CONNECT — Cell → Library → Manual fallback
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Wait up to maxMs for at least one connection, polling every CASCADE_POLL_INTERVAL.
   * Resolves true as soon as a connection appears, false on timeout.
   */
  private waitForConnection(maxMs: number): Promise<boolean> {
    return new Promise(resolve => {
      if (this.connections.size > 0) { resolve(true); return; }
      const start = Date.now();
      const timer = setInterval(() => {
        if (this.connections.size > 0 || Date.now() - start >= maxMs) {
          clearInterval(timer);
          resolve(this.connections.size > 0);
        }
      }, CASCADE_POLL_INTERVAL);
    });
  }

  /**
   * Compute trust score for a peer using the formula:
   * trustScore = 0.6 × (confirmedBlocks / blocksMinedTotal) + 0.4 × (chunksServed / max(peersDiscovered, 1))
   * New nodes with zero stats get a baseline score of 0.3.
   */
  computeTrustScore(stats?: { confirmedBlocks?: number; blocksMinedTotal?: number; chunksServed?: number; peersDiscovered?: number } | null): number {
    if (!stats) return 0.3;
    const { confirmedBlocks = 0, blocksMinedTotal = 0, chunksServed = 0, peersDiscovered = 0 } = stats;
    if (blocksMinedTotal === 0 && chunksServed === 0) return 0.3;
    const miningRatio = blocksMinedTotal > 0 ? confirmedBlocks / blocksMinedTotal : 0;
    const contentRatio = Math.min(1.0, peersDiscovered > 0 ? chunksServed / peersDiscovered : 0);
    return Math.max(0, Math.min(1, 0.6 * miningRatio + 0.4 * contentRatio));
  }

  /** Get the local trust score based on own mining stats */
  getLocalTrustScore(): number {
    return this.computeTrustScore(this.miningStats);
  }

  private async cascadeConnect(): Promise<void> {
    if (this.phase !== 'online' || !this.toggles.autoConnect) return;
    console.log('[SwarmMesh] 🔀 Cascade connect starting (freshness-gated, trust-scored priority dial)...');

    // ── Build unified candidate list with trust-based priority scores ──
    const candidates: Array<{ peerId: string; source: ConnectionSource; score: number }> = [];
    let skippedStale = 0;

    for (const [peerId, entry] of this.library) {
      if (peerId === this.peerId || this.blockedPeers.has(peerId) || this.connections.has(peerId)) continue;

      // ── Freshness gate: only dial peers fresh in the Cell window ──
      if (!this.isFreshEnoughToDial(peerId)) {
        skippedStale++;
        continue;
      }

      if (this.isPeerCoolingDown(peerId)) continue;

      let score = entry.trustScore ?? 0.3;

      // Fresh in cell window gets priority boost
      const age = now() - entry.lastSeenAt;
      if (entry.lastSeenAt > 0 && age < CELL_FRESHNESS_WINDOW) {
        score += 0.5;
      }

      const failures = this.handshakeFailures.get(peerId) ?? 0;
      score -= failures * 0.2;

      candidates.push({
        peerId,
        source: entry.source ?? 'library',
        score,
      });
    }

    // Sort by score descending, dial only what the mesh actually needs
    candidates.sort((a, b) => b.score - a.score);
    const dialBudget = this.getAutoDialBudget();
    const topN = candidates.slice(0, dialBudget);

    if (topN.length === 0) {
      if (dialBudget === 0) {
        console.log('[SwarmMesh] ⏳ Cascade skipped — enough active or pending dials are already in flight');
        return;
      }

      // ── Desperation fallback ──────────────────────────────────────
      // No fresh candidates AND we are isolated (0 connections). Try the
      // freshest stale peers anyway — a peer that hasn't beaconed in 75s
      // may still be online; the freshness gate is too strict for cold-
      // start. Cooldowns still apply, so we won't storm.
      if (this.connections.size === 0 && skippedStale > 0) {
        const staleCandidates: Array<{ peerId: string; source: ConnectionSource; score: number; lastSeenAt: number }> = [];
        for (const [peerId, entry] of this.library) {
          if (peerId === this.peerId || this.blockedPeers.has(peerId) || this.connections.has(peerId)) continue;
          if (this.isPeerCoolingDown(peerId)) continue;
          if (this.isDialPending(peerId)) continue;
          const failures = this.handshakeFailures.get(peerId) ?? 0;
          const score = (entry.trustScore ?? 0.3) - failures * 0.2;
          staleCandidates.push({ peerId, source: entry.source ?? 'library', score, lastSeenAt: entry.lastSeenAt });
        }
        // Prefer most-recently-seen stale peers first
        staleCandidates.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
        const fallback = staleCandidates.slice(0, Math.min(dialBudget, 3));
        if (fallback.length > 0) {
          console.log(`[SwarmMesh] 🆘 Desperation dial — 0 connections, no fresh peers; trying ${fallback.length} freshest stale peer(s)`);
          for (const c of fallback) {
            this.recordCellDiagnostic(c.peerId, 'cascade-dial', 'desperation-stale');
            this.dialPeer(c.peerId, c.source);
          }
          if (await this.waitForConnection(CASCADE_SETTLE_TIME)) {
            const connected: number = this.connections.size;
            this.emitAlert(`Connected to Swarm Mesh (${connected} peer${connected === 1 ? '' : 's'})`, 'info');
            this.clearCellRetryTimer();
            return;
          }
        }
      }

      console.log(`[SwarmMesh] ⚠️ No fresh candidates to dial in cascade (${skippedStale} stale skipped — waiting for cell announcements)`);
      this.emitAlert('Waiting for online peers in the Public Cell…', 'warn');
      this.scheduleCellRetry();
      return;
    }

    console.log(`[SwarmMesh] 📡 Dialing ${topN.length} fresh candidates (trust: ${topN.slice(0, 3).map(c => `${c.peerId.slice(0, 12)}:${c.score.toFixed(2)}`).join(', ')}), ${skippedStale} stale skipped`);
    for (const c of topN) {
      this.recordCellDiagnostic(c.peerId, 'cascade-dial', `score=${c.score.toFixed(2)}`);
      this.dialPeer(c.peerId, c.source);
    }

    if (await this.waitForConnection(CASCADE_SETTLE_TIME)) {
      const connected = this.connections.size;
      this.emitAlert(`Connected to Swarm Mesh (${connected} peer${connected !== 1 ? 's' : ''})`, 'info');
      this.clearCellRetryTimer();
      return;
    }

    console.log('[SwarmMesh] ⚠️ No connections established in cascade — will retry via cell');
    this.scheduleCellRetry();
    this.emitAlert('No online nodes found — enter a Peer ID to join the Swarm Mesh', 'warn');
  }

  // ── Cell-based retry logic ──────────────────────────────────────────

  /**
   * Schedule a general retry that re-runs cascadeConnect using whatever
   * the Global Cell has discovered. 30s when 0 connections, 2min otherwise.
   */
  private scheduleCellRetry(): void {
    const retryInterval = this.connections.size === 0 ? 30_000 : 2 * 60_000;
    this.clearCellRetryTimer();
    this.cellRetryTimer = setTimeout(() => {
      this.cellRetryTimer = null;
      if (this.phase === 'online') {
        console.log(`[SwarmMesh] 🔄 Cell retry — re-running cascade (interval=${retryInterval / 1000}s)`);
        void this.cascadeConnect();
      }
    }, retryInterval);
  }

  private clearCellRetryTimer(): void {
    if (this.cellRetryTimer !== null) { clearTimeout(this.cellRetryTimer); this.cellRetryTimer = null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTO-RECONNECT LIBRARY
  // ═══════════════════════════════════════════════════════════════════

  private autoConnectLibrary(): void {
    if (this.phase !== 'online' || !this.toggles.autoConnect) return;
    let dialed = 0;
    let skipped = 0;
    const dialBudget = this.getAutoDialBudget();
    for (const [peerId, entry] of this.library) {
      if (!entry.autoConnect) continue;
      if (this.connections.has(peerId)) continue;
      if (this.blockedPeers.has(peerId)) continue;
      if (peerId === this.peerId) continue;
      // Saved friends need no fresh beacon; discovered peers do.
      if (!this.isFreshEnoughToDial(peerId)) { skipped++; continue; }
      if (this.isPeerCoolingDown(peerId) || this.isDialPending(peerId)) continue;
      if (dialed >= dialBudget) break;
      if (this.dialPeer(peerId, entry.source ?? 'library')) dialed++;
    }
    if (dialed > 0 || skipped > 0) {
      console.log(`[SwarmMesh] 📡 Auto-dialing ${dialed} eligible peer(s) from library (${skipped} stale discovered peers skipped)`);
    }
  }

  /**
   * A live link just dropped. The peer was online moments ago, but its
   * library entry still carries the time we first connected, so a peer met
   * through discovery looked stale and was only retried by the 2-minute
   * cell retry once a fresh beacon arrived. Mark it seen now and redial
   * shortly through the normal backoff-respecting library path.
   */
  private noteDroppedPeer(peerId: string): void {
    const entry = this.library.get(peerId);
    if (entry) {
      entry.lastSeenAt = now();
      this.saveLibrary();
    }
    setTimeout(() => {
      if (this.phase !== 'online' || this.connections.has(peerId)) return;
      this.autoConnectLibrary();
    }, DROPPED_PEER_REDIAL_DELAY_MS);
  }

  private startLibraryReconnectLoop(): void {
    this.stopLibraryReconnectLoop();
    this.libraryReconnectTimer = setInterval(() => {
      if (this.phase !== 'online' || !this.toggles.autoConnect) return;

      // Saved friends retry with backoff; ephemeral peers need fresh presence.
      const candidates = Array.from(this.library.entries())
        .filter(([peerId, entry]) =>
          entry.autoConnect &&
          !this.connections.has(peerId) &&
          !this.blockedPeers.has(peerId) &&
          peerId !== this.peerId &&
          !this.isPeerCoolingDown(peerId) &&
          !this.isDialPending(peerId) &&
          this.isFreshEnoughToDial(peerId)
        )
        .sort(([, a], [, b]) => {
          // Trust score descending, then lastSeenAt descending
          const trustDiff = (b.trustScore ?? 0.3) - (a.trustScore ?? 0.3);
          if (Math.abs(trustDiff) > 0.01) return trustDiff;
          return b.lastSeenAt - a.lastSeenAt;
        });

      const dialBudget = this.getAutoDialBudget();
      if (dialBudget === 0) return;
      const selected = candidates.slice(0, dialBudget);

      if (selected.length > 0) {
        console.log(
          `[SwarmMesh] 🔄 RECONNECT LOOP — ${selected.length}/${candidates.length} eligible candidates, ` +
          `top: ${selected[0][0].slice(0, 12)} trust=${(selected[0][1].trustScore ?? 0.3).toFixed(2)}`
        );
      }

      for (const [peerId, entry] of selected) {
        this.dialPeer(peerId, entry.source ?? 'library');
      }
    }, LIBRARY_RECONNECT_INTERVAL);
  }

  private stopLibraryReconnectLoop(): void {
    if (this.libraryReconnectTimer !== null) { clearInterval(this.libraryReconnectTimer); this.libraryReconnectTimer = null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE TRANSITIONS
  // ═══════════════════════════════════════════════════════════════════

  private setPhase(next: SwarmPhase): void {
    if (this.phase === next) return;
    const prev = this.phase;
    this.phase = next;
    console.log(`[SwarmMesh] Phase: ${prev} → ${next}`);
    for (const h of this.phaseHandlers) { try { h(next); } catch { /* ignore */ } }
  }

  getPhase(): SwarmPhase { return this.phase; }

  // ═══════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════

  async start(): Promise<void> {
    if (this.phase === 'online') return;
    if (this.initInProgress) return;
    // Recover from a wedged session: if a previous start left us stuck in
    // 'connecting' or 'reconnecting' (e.g. signaling never resolved on
    // Chrome), tear down before restarting so the new boot can proceed.
    if (this.phase === 'connecting' || this.phase === 'reconnecting') {
      console.warn('[SwarmMesh] start() called while phase=', this.phase, '— recovering');
      this.clearReconnectTimer();
      this.clearIntervals();
      this.stopLibraryReconnectLoop();
      this.destroyPeer();
      this.connections.clear();
      this.setPhase('off');
    }

    this.flags.enabled = true;
    this.saveFlags();
    this.clearReconnectTimer();
    this.startedAt = now();
    this.reconnectAttempt = 0;

    // Listen for profile updates so avatar changes propagate in real-time
    if (typeof window !== 'undefined') {
      window.addEventListener('profile-updated', this._onProfileUpdated);
    }

    await this.attachContentLifecycle();
    await this.loadPostsFromDB();
    await this.scanLocalSeeders();
    await this.connectSignaling();
  }

  /**
   * Scan all local manifests on startup and register self as seeder
   * for any file where all chunks are already present locally.
   * This prevents re-syncing/re-downloading media we already own.
   */
  private async scanLocalSeeders(): Promise<void> {
    try {
      const db = await this.openDB();
      if (!db.objectStoreNames.contains('manifests') || !db.objectStoreNames.contains('chunks')) {
        db.close();
        return;
      }

      const manifests = await new Promise<Array<Record<string, unknown>>>((resolve) => {
        const tx = db.transaction('manifests', 'readonly');
        const req = tx.objectStore('manifests').getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => resolve([]);
      });

      const chunkKeys = new Set<string>();
      await new Promise<void>((resolve) => {
        const tx = db.transaction('chunks', 'readonly');
        const req = tx.objectStore('chunks').getAllKeys();
        req.onsuccess = () => {
          for (const k of (req.result ?? [])) {
            if (typeof k === 'string') chunkKeys.add(k);
          }
          resolve();
        };
        req.onerror = () => resolve();
      });

      db.close();

      let seeded = 0;
      for (const m of manifests) {
        const fileId = m.fileId as string;
        if (!fileId) continue;
        if (m.seedingPaused === true) continue;
        if (isManifestUnsupported(fileId)) continue;
        const refs = Array.isArray(m.chunks) ? (m.chunks as string[]).filter(r => typeof r === 'string') : [];
        if (refs.length === 0) continue;

        const allPresent = refs.every(r => chunkKeys.has(r));
        if (allPresent) {
          if (!this.fileSeeders.has(fileId)) {
            this.fileSeeders.set(fileId, new Set());
          }
          this.fileSeeders.get(fileId)!.add(this.peerId);
          seeded++;
        }
      }

      if (seeded > 0) {
        console.log(`[SwarmMesh] 🌱 Startup seeder scan: ${seeded} locally complete files registered`);
      }
    } catch (err) {
      console.warn('[SwarmMesh] Startup seeder scan failed:', err);
    }
  }

  private _onProfileUpdated = () => {
    console.log('[SwarmMesh] Profile updated — broadcasting to all peers');
    for (const conn of this.connections.values()) {
      if (conn.open) {
        this.sendProfileExchange(conn);
      }
    }
  };

  stop(): void {
    this.flags.enabled = false;
    this.saveFlags();
    this.clearReconnectTimer();
    this.clearSignalingRecovery();
    this.clearIntervals();
    this.stopLibraryReconnectLoop();
    this.stopMiningLoop();
    this.clearCellRetryTimer();
    this.teardownGlobalCell();
    this.clearPendingAssetRequests();
    this.clearAssetRetryTimers();
    this.pendingDials.clear();
    this.queuedManualDials.clear();
    if (typeof window !== 'undefined') {
      window.removeEventListener('profile-updated', this._onProfileUpdated);
    }
    this.destroyPeer();
    this.peerData.clear();
    this.connections.clear();
    this.setPhase('off');
    this.emitPeers();
    this.emitAlert('Swarm Mesh disconnected', 'info');
    console.log('[SwarmMesh] ⏹️ Stopped');
  }

  async autoStart(): Promise<void> {
    // Check own flags first, then fall back to the unified connection state
    if (!this.flags.enabled) {
      try {
        const raw = localStorage.getItem('p2p-connection-state');
        if (raw) {
          const unified = JSON.parse(raw);
          if (unified?.enabled === true) {
            console.log('[SwarmMesh] Own flags say disabled but unified state says enabled — syncing');
            this.flags.enabled = true;
            this.saveFlags();
          }
        }
      } catch { /* ignore */ }
    }

    if (!this.flags.enabled) {
      console.log('[SwarmMesh] Flags say offline, skipping auto-start');
      return;
    }
    console.log('[SwarmMesh] Auto-starting from persisted flags...');
    await this.start();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PEERJS SIGNALING
  // ═══════════════════════════════════════════════════════════════════

  private async connectSignaling(): Promise<void> {
    if (this.initInProgress) {
      console.warn('[SwarmMesh] Connection already in progress, skipping');
      return;
    }

    this.initInProgress = true;
    this.clearSignalingRecovery();
    this.setPhase(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    this.destroyPeer();

    if (this.reconnectAttempt > 0) {
      const cooldown = Math.min(2000 + this.reconnectAttempt * 500, 5000);
      console.log(`[SwarmMesh] Waiting ${cooldown}ms for server to release session...`);
      await this.sleep(cooldown);
    }

    try {
      const Peer = (await import('peerjs')).default;
      const endpoint = this.signalingRotation.current();

      console.log(`[SwarmMesh] 🔌 Creating PeerJS instance with ID: ${this.peerId} via ${endpoint.label}`);

      const peer = new Peer(this.peerId, {
        debug: 1,
        host: endpoint.host,
        port: endpoint.port,
        secure: endpoint.secure,
        path: endpoint.path,
        config: { iceServers: DEFAULT_ICE },
      });

      const initResult = await this.waitForOpen(peer);

      if (!initResult.success) {
        console.warn(`[SwarmMesh] ❌ PeerJS init failed on ${endpoint.label}: ${initResult.error}`);
        // An ID still held by the same server is not the server's fault.
        if (!initResult.idTaken && this.signalingRotation.reportFailure()) {
          console.warn(`[SwarmMesh] 🔀 Signaling failover → ${this.signalingRotation.current().label}`);
        }
        this.destroyPeerInstance(peer);
        this.initInProgress = false;
        this.scheduleReconnect();
        return;
      }

      this.peer = peer;
      this.initInProgress = false;
      this.signalingRotation.reportSuccess();

      this.setupPeerHandlers(peer);
      this.startIntervals();

      this.flags.lastOnlineAt = now();
      this.saveFlags();
      this.reconnectAttempt = 0;
      this.clearReconnectTimer();

      this.setPhase('online');
      // An explicit Brain invite knocks first, before subscribing to the Cell.
      const { dialBrainInviteFirst } = await import('./brainInvite');
      dialBrainInviteFirst({ pathname: window.location.pathname, hash: window.location.hash,
        selfId: this.peerId, isBlocked: id => this.blockedPeers.has(id), dial: id => this.connectToPeer(id) });
      this.emitAlert('Connected to P2P network', 'info');
      console.log(`[SwarmMesh] ✅ Online as ${this.peerId}`);
      this.flushQueuedManualDials();

      // Pre-load local public projects into the content store so they ride
      // the standard inventory-exchange handshake on every new peer connect.
      void this.hydrateProjectsIntoContentStore();

      // Subscribe to Global Cell FIRST so it can seed peers before cascade
      this.subscribeGlobalCell();

      // Seed library from existing cell peers before first cascade
      try {
        const { getGlobalCell } = await import('./globalCell');
        const existing = getGlobalCell().getKnownPeers();
        if (existing.length > 0) {
          console.log(`[SwarmMesh] 🌐 Pre-cascade: seeding ${existing.length} cell peer(s)`);
          const ct = now();
          for (const gp of existing) {
            if (!gp.peerId || gp.peerId === this.peerId || this.blockedPeers.has(gp.peerId)) continue;
            if (!this.library.has(gp.peerId)) {
              this.library.set(gp.peerId, {
                peerId: gp.peerId,
                nodeId: gp.peerId.replace(/^peer-/, ''),
                alias: `Node ${gp.peerId.slice(5, 11)}`,
                addedAt: ct,
                lastSeenAt: gp.lastSeenAt,
                autoConnect: true,
                source: 'exchange',
                trustScore: gp.trustScore,
              });
            } else {
              const e = this.library.get(gp.peerId)!;
              if (gp.lastSeenAt > e.lastSeenAt) e.lastSeenAt = gp.lastSeenAt;
            }

            if (gp.lastSeenAt > ct - CELL_FRESHNESS_WINDOW) {
              this.restorePeerEligibility(gp.peerId);
            }
          }
          this.saveLibrary();
        }
      } catch { /* globalCell not started yet */ }

      // Now run cascade with cell data available. On a fresh login the
      // GlobalCell's Gun.js relay handshake may finish a beat *after* the
      // mesh comes online — especially under heavy main-thread load (e.g.
      // /brain WebGL scene). Poll briefly so the cascade fires the moment
      // the first cell peer is known instead of dialing into an empty
      // library and waiting for the next periodic retry.
      void this.awaitCellThenCascade();
      this.startLibraryReconnectLoop();

      // Auto-start mining
      if (this.toggles.mining) {
        console.log('[SwarmMesh][Mining] ⛏️ AUTO-START — node went online, mining toggle is ON');
        this.startMiningLoop();
      } else {
        console.log('[SwarmMesh][Mining] ⛏️ AUTO-START SKIPPED — node online but mining toggle is OFF');
      }

      // Auto-start torrent swarming for multi-peer content distribution
      this.startTorrentSwarm();

      // Subscribe to Global Cell peer discoveries
      this.subscribeGlobalCell();

    } catch (err) {
      console.error('[SwarmMesh] Unexpected init error:', err);
      this.initInProgress = false;
      this.scheduleReconnect();
    }
  }

  private waitForOpen(peer: import('peerjs').default): Promise<{ success: boolean; error?: string; idTaken?: boolean }> {
    return new Promise(resolve => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        peer.removeAllListeners?.();
        resolve({ success: false, error: 'Signaling timeout' });
      }, PEERJS_INIT_TIMEOUT);

      peer.on('open', (_id: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ success: true });
      });

      peer.on('error', (err: Error & { type?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        const msg = err?.message || 'Unknown error';
        const idTaken = err?.type === 'unavailable-id' || /ID.*taken|unavailable/i.test(msg);

        if (idTaken) {
          resolve({ success: false, idTaken: true, error: `ID "${this.peerId}" still held by server — will retry` });
        } else {
          resolve({ success: false, error: msg });
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // RECONNECT
  // ═══════════════════════════════════════════════════════════════════

  private scheduleReconnect(): void {
    if (!this.flags.enabled) { this.setPhase('off'); return; }
    if (this.reconnectAttempt >= RECONNECT_INTERVALS.length) {
      // Stay enabled and keep trying slowly: a device that was offline for a
      // few minutes must rejoin the mesh on its own, not wait for a refresh.
      this.setPhase('failed');
      this.emitAlert('Cannot reach the mesh — retrying every 2 minutes', 'error');
      this.clearReconnectTimer();
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.retryFromFailed('slow retry');
      }, FAILED_RECONNECT_RETRY_MS);
      return;
    }
    const delay = RECONNECT_INTERVALS[this.reconnectAttempt];
    this.reconnectAttempt++;
    this.setPhase('reconnecting');
    this.emitAlert(`Reconnecting in ${delay / 1000}s (${this.reconnectAttempt}/${RECONNECT_INTERVALS.length})…`, 'warn');
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.flags.enabled) void this.connectSignaling();
    }, delay);
  }

  /** Leave the failed state with a fresh round of reconnect attempts. */
  private retryFromFailed(reason: string): void {
    if (!this.flags.enabled || this.initInProgress) return;
    if (this.phase !== 'failed' && this.phase !== 'reconnecting') return;
    console.log(`[SwarmMesh] 🔁 Rejoining the mesh (${reason})`);
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    void this.connectSignaling();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PEER EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════════

  private setupPeerHandlers(peer: import('peerjs').default): void {
    peer.on('connection', (conn: import('peerjs').DataConnection) => {
      const remotePeerId = conn.peer;
      console.log('[SwarmMesh] 📥 Incoming from:', remotePeerId);

      if (this.blockedPeers.has(remotePeerId)) {
        console.log(`[SwarmMesh] 🚫 Rejecting blocked peer: ${remotePeerId}`);
        try { conn.close(); } catch { /* ignore */ }
        return;
      }

      const meta = conn.metadata as { source?: string } | undefined;
      this.handleConnection(conn, (meta?.source as ConnectionSource) ?? 'manual');
    });

    // Losing the signaling socket does not close data channels. Reconnect
    // the socket on the same Peer so live links survive the blip.
    peer.on('disconnected', () => this.recoverSignaling('disconnected'));
    peer.on('open', () => this.finishSignalingRecovery());

    peer.on('error', (err: Error & { type?: string }) => {
      console.error('[SwarmMesh] Error:', err?.type, err?.message);
      if (err?.type === 'peer-unavailable') {
        const match = err.message?.match(/peer\s+(peer-[a-f0-9]+)/i);
        if (match?.[1]) {
          // The server answered: the dial is over, so a retry need not wait
          // out the pending-dial timeout.
          this.clearPendingDial(match[1]);
          this.recordHandshakeFailure(match[1]);
          console.log(`[SwarmMesh] ℹ️ Peer ${match[1]} unavailable`);
        }
        return;
      }
      if (['network', 'server-error', 'socket-error'].includes(err?.type ?? '')) this.handleLost();
    });

    peer.on('close', () => this.handleLost());
  }

  private signalingRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private signalingRecoveryAttempts = 0;

  /**
   * The signaling socket dropped (PeerJS keeps a disconnected Peer and its
   * data channels). Reconnect that socket with the same ID instead of
   * rebuilding the Peer, which would close every live link in the mesh.
   * Falls back to a full reconnect only if the socket will not come back.
   */
  private recoverSignaling(reason: string): void {
    if (this.phase !== 'online' || !this.peer || this.peer.destroyed) return;
    if (this.signalingRecoveryTimer !== null) return;
    console.warn(`[SwarmMesh] ⚠️ Signaling lost (${reason}) — reconnecting the socket, live channels kept`);
    this.signalingRecoveryAttempts = 0;
    this.signalingRecoveryTimer = setTimeout(() => this.attemptSignalingRecovery(), SIGNALING_RECOVERY_FIRST_MS);
  }

  private attemptSignalingRecovery(): void {
    this.signalingRecoveryTimer = null;
    const peer = this.peer;
    if (this.phase !== 'online') return;
    if (!peer || peer.destroyed) { this.handleLostHard(); return; }
    if (peer.open) { this.finishSignalingRecovery(); return; }
    if (this.signalingRecoveryAttempts >= SIGNALING_RECOVERY_MAX_ATTEMPTS) {
      console.warn('[SwarmMesh] Signaling socket did not come back — full reconnect');
      this.handleLostHard();
      return;
    }
    this.signalingRecoveryAttempts++;
    if (peer.disconnected) {
      try {
        peer.reconnect();
        console.log(`[SwarmMesh] Signaling reconnect attempt ${this.signalingRecoveryAttempts}/${SIGNALING_RECOVERY_MAX_ATTEMPTS}`);
      } catch { /* checked again on the next attempt */ }
    }
    this.signalingRecoveryTimer = setTimeout(() => this.attemptSignalingRecovery(), SIGNALING_RECOVERY_RETRY_MS);
  }

  private finishSignalingRecovery(): void {
    if (this.signalingRecoveryTimer === null && this.signalingRecoveryAttempts === 0) return;
    if (this.signalingRecoveryTimer !== null) { clearTimeout(this.signalingRecoveryTimer); this.signalingRecoveryTimer = null; }
    this.signalingRecoveryAttempts = 0;
    if (this.phase !== 'online') return;
    console.log('[SwarmMesh] ✅ Signaling re-established (data channels intact)');
    this.reconnectAttempt = 0;
    // Peers may have tried us while the socket was down: announce and fill gaps.
    this.pulseGlobalPresence('signaling-recovered');
    this.flushQueuedManualDials();
    this.scheduleMeshExpansion('signaling-recovered', [], 500);
    if (this.connections.size === 0) this.scheduleMeshExpansion('signaling-recovered', [], 3_000);
  }

  private clearSignalingRecovery(): void {
    if (this.signalingRecoveryTimer !== null) { clearTimeout(this.signalingRecoveryTimer); this.signalingRecoveryTimer = null; }
    this.signalingRecoveryAttempts = 0;
  }

  private handleLost(): void {
    if (['reconnecting', 'off', 'failed'].includes(this.phase)) return;
    // PeerJS reports a socket loss before it marks the Peer disconnected, so
    // a Peer that is not destroyed is recoverable in place.
    if (this.peer && !this.peer.destroyed) {
      this.recoverSignaling('signaling error');
      return;
    }
    this.handleLostHard();
  }

  private handleLostHard(): void {
    if (['reconnecting', 'off', 'failed'].includes(this.phase)) return;
    this.clearSignalingRecovery();
    console.log('[SwarmMesh] Connection lost → soft cleanup (preserving live channels)');
    this.clearIntervals();
    this.stopMiningLoop();
    this.stopTorrentSwarm();
    this.pendingDials.clear();

    // Soft cleanup: preserve data channels that are still open
    const deadPeers: string[] = [];
    for (const [peerId, conn] of this.connections) {
      if (!conn.open) {
        deadPeers.push(peerId);
      }
    }
    for (const peerId of deadPeers) {
      this.connections.delete(peerId);
      this.peerData.delete(peerId);
    }

    const liveCount = this.connections.size;
    if (liveCount > 0) {
      console.log(`[SwarmMesh] ${liveCount} data channel(s) still alive — keeping them`);
      this.emitPeers();
      // Restart intervals for the surviving connections
      this.startIntervals();
    } else {
      console.log('[SwarmMesh] No surviving channels — full reconnect');
      this.peer = null;
      this.connections.clear();
      this.peerData.clear();
      this.emitPeers();
    }

    this.reconnectAttempt = 0;
    this.scheduleReconnect();
  }

  // ═══════════════════════════════════════════════════════════════════
  // DATA CONNECTION HANDLING
  // ═══════════════════════════════════════════════════════════════════

  private handleConnection(conn: import('peerjs').DataConnection, source: ConnectionSource): void {
    const rId = conn.peer;

    if (this.blockedPeers.has(rId)) {
      try { conn.close(); } catch { /* ignore */ }
      return;
    }

    conn.on('open', () => {
      console.log(`[SwarmMesh] ✅ Channel open: ${rId} (${source})`);
      this.clearPendingDial(rId);
      this.peerCooldowns.delete(rId); // Clear cooldown on successful connection
      this.clearHandshakeFailures(rId); // Clear handshake failure tracking

      // Synapse memory: record successful handshake for the Bus smoothness score
      try {
        import('./synapseLayer').then(m => m.recordHandshake(rId, true)).catch(() => {});
      } catch { /* ignore */ }

      const existingConn = this.connections.get(rId);
      if (existingConn && existingConn !== conn) {
        if (existingConn.open) {
          // Both sides dialed at once. Each side must keep the SAME channel,
          // or each closes the one the other kept and the pair drops and
          // redials forever. Both agree on the one the lower peer ID opened.
          if (!this.replacesDuplicateChannel(rId, conn, existingConn)) {
            console.log(`[SwarmMesh] ↔️ Duplicate channel open for ${rId.slice(0, 16)} — keeping existing channel`);
            try { conn.close(); } catch { /* ignore */ }
            return;
          }
          console.log(`[SwarmMesh] ↔️ Duplicate channel open for ${rId.slice(0, 16)} — keeping the lower peer's channel`);
          // Swap first, so the old channel's close handler sees it was replaced.
          this.connections.set(rId, conn);
        }
        try { existingConn.close(); } catch { /* ignore */ }
      }

      this.connections.set(rId, conn);
      // Cadence Clock: a quick burst of ping-pongs calibrates this peer's clock now.
      for (let i = 0; i < CLOCK_BURST_PINGS; i++) {
        setTimeout(() => {
          if (this.connections.get(rId) !== conn || !conn.open) return;
          try { conn.send(JSON.stringify({ type: 'ping', from: this.peerId, ts: now() })); } catch { /* ignore */ }
        }, i * CLOCK_BURST_GAP_MS);
      }
      this.peerData.set(rId, {
        peerId: rId,
        connectedAt: now(),
        lastActivity: now(),
        messagesReceived: 0,
        messagesSent: 0,
        avgRttMs: null,
        lastRttMs: null,
        lastMinedBlock: null,
        miningRtt: null,
        source,
      });
      this.emitPeers();
      this.pulseGlobalPresence(`peer-open:${rId}`);
      this.schedulePresencePulse(`peer-open-followup:${rId}`, 2_500);
      this.schedulePresencePulse(`peer-open-followup:${rId}`, 6_000);

      const meta = conn.metadata as { nodeId?: string } | undefined;
      // ── Hardened library persistence: always save on successful connection ──
      const nodeIdForLibrary = meta?.nodeId ?? rId.replace(/^peer-/, '');
      const existingEntry = this.library.get(rId);
      if (existingEntry) {
        existingEntry.lastSeenAt = now();
        existingEntry.nodeId = nodeIdForLibrary;
        existingEntry.source = source === 'manual' ? source : existingEntry.source;
      } else {
        this.library.set(rId, {
          peerId: rId,
          nodeId: nodeIdForLibrary,
          alias: `Node ${nodeIdForLibrary.slice(0, 6)}`,
          addedAt: now(),
          lastSeenAt: now(),
          autoConnect: true,
          source,
        });
      }
      this.saveLibrary();
      this.recordCellDiagnostic(rId, 'library-save', `source=${source}, nodeId=${nodeIdForLibrary.slice(0, 8)}`);

      // ── Feed neural engine: connection success ──
      try {
        import('./sharedNeuralEngine').then(({ getSharedNeuralEngine }) => {
          const engine = getSharedNeuralEngine();
          engine.onInteraction(rId, { kind: 'connection' as 'gossip', success: true });
        }).catch(() => { /* ignore */ });
      } catch { /* ignore */ }

      // Presence hints and deletion tombstones go before the inventory so the
      // peer drops dead content instead of offering it back to us.
      this.sendLifecycleState(conn);

      // Exchange content inventories
      this.sendContentInventory(conn);

      // Soft-retry drain: any manifests parked while offline now have a peer.
      this.drainPendingAssetQueue();

      // Send our profile to the peer
      this.sendProfileExchange(conn);

      // Exchange libraries for mesh growth
      if (this.toggles.libraryExchange) {
        this.sendLibraryExchange(conn);
        // Rebroadcast updated library to ALL other peers so they discover this new peer
        // This creates the triangle: A↔B, A↔C → B learns about C → B↔C
        this.rebroadcastLibrary(rId);
      }

      setTimeout(() => {
        this.expandOnlineMesh('peer-open');
      }, 250);
      this.scheduleMeshExpansion('peer-open-followup', [rId], 1_500);
      this.scheduleMeshExpansion('peer-open-followup', [], 5_000);

      // ── Exchange neural state digest for collective memory rebirth ──
      this.sendNeuralDigest(conn);

      // ── Request blockchain chain sync for full coin/ledger access ──
      try {
        // Catch-up: tell the peer which of its blocks we already have, so it
        // only sends what came after (older peers ignore `since`).
        conn.send(JSON.stringify({ type: 'chain-sync-request', from: this.peerId, since: getChainMark(rId) }));
      } catch { /* ignore */ }

      // ── Request Creator Token market snapshots so peers see each other's markets ──
      try {
        conn.send(JSON.stringify({ type: 'market-sync-request', from: this.peerId }));
      } catch { /* ignore */ }

      // ── Auto-resume mining when first peer connects ──
      if (this.toggles.mining && this.miningTimer === null && this.phase === 'online') {
        console.log('[SwarmMesh][Mining] ⛏️ PEER CONNECTED — resuming mining loop');
        this.startMiningLoop();
      }

      if (source === 'manual') {
        this.emitAlert(`Connected to ${rId.slice(0, 16)} (manual)`, 'info');
      }
    });

    conn.on('data', (raw: unknown) => {
      const p = this.peerData.get(rId);
      if (p) { p.lastActivity = now(); p.messagesReceived++; }
      this.handleMessage(rId, raw);
    });

    conn.on('close', () => {
      this.clearPendingDial(rId);
      if (this.connections.get(rId) === conn) {
        this.connections.delete(rId);
        this.peerData.delete(rId);
        this.emitPeers();
        this.noteDroppedPeer(rId);
      }
      // Feed neural engine: connection lost
      try {
        import('./sharedNeuralEngine').then(({ getSharedNeuralEngine }) => {
          getSharedNeuralEngine().onInteraction(rId, { kind: 'connection' as 'gossip', success: false });
        }).catch(() => { /* ignore */ });
      } catch { /* ignore */ }
    });

    conn.on('error', (err: Error) => {
      console.warn(`[SwarmMesh] Conn error ${rId}:`, err?.message);
      this.clearPendingDial(rId);
      this.recordHandshakeFailure(rId);
      // Synapse memory: record failed handshake for the Bus smoothness score
      try {
        import('./synapseLayer').then(m => m.recordHandshake(rId, false)).catch(() => {});
      } catch { /* ignore */ }
      if (this.connections.get(rId) === conn) {
        this.connections.delete(rId);
        this.peerData.delete(rId);
        this.emitPeers();
      }
      // Feed neural engine: connection error
      try {
        import('./sharedNeuralEngine').then(({ getSharedNeuralEngine }) => {
          getSharedNeuralEngine().onInteraction(rId, { kind: 'connection' as 'gossip', success: false });
        }).catch(() => { /* ignore */ });
      } catch { /* ignore */ }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // DIAL PEER
  // ═══════════════════════════════════════════════════════════════════

  /** Channels this node opened itself (outgoing dials). */
  private outgoingChannels = new WeakSet<object>();

  /**
   * Simultaneous dials leave two open channels to one peer. Both sides keep
   * the channel opened by the lower peer ID, so they always agree on it.
   * True when `incoming` should replace the already open `existing`.
   */
  private replacesDuplicateChannel(remotePeerId: string, incoming: object, existing: object): boolean {
    const keepOpener = this.peerId < remotePeerId ? 'self' : 'remote';
    const opener = (c: object) => (this.outgoingChannels.has(c) ? 'self' : 'remote');
    return opener(incoming) === keepOpener && opener(existing) !== keepOpener;
  }

  private dialPeer(remotePeerId: string, source: ConnectionSource): boolean {
    if (!this.peer || this.peer.destroyed) return false;
    // While signaling is reconnecting a new dial cannot be delivered.
    if (this.peer.disconnected) return false;
    if (remotePeerId === this.peerId || this.connections.has(remotePeerId) || this.isDialPending(remotePeerId)) return false;
    if (!this.markDialPending(remotePeerId)) return false;

    console.log(`[SwarmMesh] 🔗 Dialing ${remotePeerId} (${source})`);
    try {
      const conn = this.peer.connect(remotePeerId, {
        reliable: true,
        metadata: { nodeId: this.nodeId, source },
      });
      if (!conn) throw new Error('signaling unavailable');
      this.outgoingChannels.add(conn);
      this.handleConnection(conn, source);
      return true;
    } catch (err) {
      this.clearPendingDial(remotePeerId);
      console.warn(`[SwarmMesh] Failed to start dial for ${remotePeerId}:`, err);
      return false;
    }
  }

  connectToPeer(remotePeerId: string): boolean {
    remotePeerId = remotePeerId.trim();
    if (!remotePeerId) {
      this.emitAlert('Enter a peer ID to connect', 'warn');
      return false;
    }
    if (!remotePeerId.startsWith('peer-')) {
      remotePeerId = `peer-${remotePeerId}`;
    }

    if (remotePeerId === this.peerId) return false;
    if (this.blockedPeers.has(remotePeerId)) {
      this.emitAlert('That peer is blocked', 'warn');
      return false;
    }
    // Persist intent even while signaling warms up or the connection exists.
    this.addToLibrary(remotePeerId, 'manual');

    if (!this.peer || this.peer.destroyed || this.phase !== 'online') {
      // Signaling is still opening (or re-opening): hold the dial and send it
      // the moment the node is online instead of rejecting the user's intent.
      const warmingUp = this.flags.enabled && (this.phase === 'connecting' || this.phase === 'reconnecting' || this.initInProgress);
      if (warmingUp && !this.blockedPeers.has(remotePeerId)) {
        this.queuedManualDials.set(remotePeerId, now());
        this.emitAlert(`Mesh still connecting — will dial ${remotePeerId.slice(0, 16)}… when online`, 'info');
        return true;
      }
      this.emitAlert('Start Swarm Mesh first', 'warn');
      return false;
    }

    if (this.connections.has(remotePeerId)) {
      this.emitAlert('Already connected', 'info');
      return false;
    }

    // Signaling is reconnecting in place: hold the dial until the socket returns.
    if (this.peer.disconnected) {
      this.queuedManualDials.set(remotePeerId, now());
      this.emitAlert(`Mesh reconnecting — will dial ${remotePeerId.slice(0, 16)}… when back`, 'info');
      return true;
    }

    // A dial already in flight must finish (or time out) first: repeated
    // invite/retry ticks would otherwise open stacked connections to the host.
    if (this.isDialPending(remotePeerId)) return true;

    // Manual connections clear all cooldowns for that peer
    this.peerCooldowns.delete(remotePeerId);
    this.clearHandshakeFailures(remotePeerId);

    // Mirror the working library pattern: register the peer in the library
    // BEFORE dialing so the connection is durable and retryable, then pulse
    // our own presence so the remote side's Cell Bus sees us and can
    // arbitrate/accept instead of colliding with a simultaneous dial.
    this.pulseGlobalPresence('manual-dial');
    // Trip 1: knock so the target dials back at the same time (two-way punch).
    void import('./globalCell').then(({ getGlobalCell }) => getGlobalCell().sendInviteKnock(remotePeerId)).catch(() => {});

    this.dialPeer(remotePeerId, 'manual');
    this.emitAlert(`Dialing ${remotePeerId.slice(0, 16)}…`, 'info');
    return true;
  }

  /** Send manual dials that were requested while signaling was still connecting. */
  private flushQueuedManualDials(): void {
    if (this.queuedManualDials.size === 0) return;
    const queued = [...this.queuedManualDials.entries()];
    this.queuedManualDials.clear();
    const cutoff = now() - QUEUED_DIAL_TTL_MS;
    for (const [peerId, requestedAt] of queued) {
      if (requestedAt < cutoff || this.connections.has(peerId)) continue;
      console.log(`[SwarmMesh] ▶️ Sending queued manual dial to ${peerId}`);
      this.connectToPeer(peerId);
    }
  }

  /**
   * Bus-initiated dial (Global Cell arbitration).
   *
   * Unlike a manual dial this RESPECTS handshake-failure cooldowns and
   * pending-dial state: the Bus re-evaluates on every beacon arrival, so it
   * must never reset backoff or open a second connection to the same peer.
   * Manual dials remain the only path that overrides backoff (user intent).
   */
  /** Whether automatic discovery may dial (the Auto-connect switch). */
  isAutoConnectEnabled(): boolean {
    return this.toggles.autoConnect;
  }

  dialViaBus(remotePeerId: string, source: 'exchange' | 'manual' = 'exchange'): boolean {
    remotePeerId = remotePeerId.trim();
    if (!remotePeerId || remotePeerId === this.peerId) return false;
    if (this.blockedPeers.has(remotePeerId)) return false;
    // Explicit room targets are durable, unlike arbitrary Cell discovery.
    if (source === 'manual') this.addToLibrary(remotePeerId, 'manual');
    if (!this.peer || this.peer.destroyed || this.phase !== 'online') return false;
    if (this.connections.has(remotePeerId)) return false;
    if (this.isPeerCoolingDown(remotePeerId) || this.isDialPending(remotePeerId)) return false;

    const started = this.dialPeer(remotePeerId, source);
    if (started) {
      this.globalCellDialCooldowns.set(remotePeerId, now());
    }
    return started;
  }

  /** Remember an app-level meeting before readiness checks; never override dial policy. */
  registerPeerConnection(remotePeerId: string): boolean {
    remotePeerId = remotePeerId.trim();
    if (!remotePeerId || remotePeerId === this.peerId || this.blockedPeers.has(remotePeerId)) return false;
    this.addToLibrary(remotePeerId, 'library');
    if (!this.toggles.autoConnect || !this.library.get(remotePeerId)?.autoConnect) return false;
    if (this.getAutoDialBudget() === 0) return false;
    return this.dialViaBus(remotePeerId);
  }

  disconnectPeer(remotePeerId: string): void {
    const conn = this.connections.get(remotePeerId);
    if (conn) {
      try { conn.close(); } catch { /* ignore */ }
      this.connections.delete(remotePeerId);
      this.peerData.delete(remotePeerId);
      this.emitPeers();
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // ACTIVE PEER EXCHANGE — peers share live connections for mesh growth
  // ═══════════════════════════════════════════════════════════════════

  private getActiveExchangePeers(): Array<{
    peerId: string;
    nodeId: string;
    alias: string;
    lastSeenAt: number;
    trustScore: number;
    username?: string;
    displayName?: string;
    avatarRef?: string;
    userId?: string;
    walletAddress?: string;
    namespaceId?: string;
    discriminator?: string;
  }> {
    const activeSeenAt = now();
    return Array.from(this.connections.keys())
      .filter(peerId => this.connections.get(peerId)?.open && peerId !== this.peerId && !this.blockedPeers.has(peerId))
      .map(peerId => {
        const entry = this.library.get(peerId);
        const nodeId = entry?.nodeId ?? peerId.replace(/^peer-/, '');
        return {
          peerId,
          nodeId,
          alias: entry?.alias ?? `Node ${nodeId.slice(0, 6)}`,
          lastSeenAt: activeSeenAt,
          trustScore: entry?.trustScore ?? 0.3,
          userId: entry?.userId,
          username: entry?.username,
          displayName: entry?.displayName,
          avatarRef: entry?.avatarRef,
          walletAddress: entry?.walletAddress,
          namespaceId: entry?.namespaceId,
          discriminator: entry?.discriminator,
        };
      });
  }

  /**
   * What a library exchange hands on: every live connection (`active: true`)
   * plus saved contacts seen within the share window (`active: false`, with
   * their real last-seen time). No node is a "host": whoever is the first
   * contact passes on what it knows, and the receiver passes it on again, so
   * libraries roll through the mesh until each contact ages out.
   */
  private getSharedLibraryPeers(): Array<ReturnType<StandaloneSwarmMesh['getActiveExchangePeers']>[number] & { active: boolean }> {
    const active = this.getActiveExchangePeers().map(peer => ({ ...peer, active: true }));
    const cutoff = now() - SAVED_CONTACT_SHARE_WINDOW_MS;
    const saved = Array.from(this.library.values())
      .filter(entry => entry.peerId !== this.peerId
        && !this.blockedPeers.has(entry.peerId)
        && !this.connections.get(entry.peerId)?.open
        && entry.lastSeenAt > 0
        && entry.lastSeenAt >= cutoff)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, MAX_SHARED_SAVED_CONTACTS)
      .map(entry => {
        const nodeId = entry.nodeId ?? entry.peerId.replace(/^peer-/, '');
        return {
          peerId: entry.peerId,
          nodeId,
          alias: entry.alias ?? `Node ${nodeId.slice(0, 6)}`,
          lastSeenAt: entry.lastSeenAt,
          trustScore: entry.trustScore ?? 0.3,
          userId: entry.userId,
          username: entry.username,
          displayName: entry.displayName,
          avatarRef: entry.avatarRef,
          walletAddress: entry.walletAddress,
          namespaceId: entry.namespaceId,
          discriminator: entry.discriminator,
          active: false,
        };
      });
    return [...active, ...saved];
  }

  private sendLibraryExchange(conn: import('peerjs').DataConnection): void {
    if (!this.toggles.libraryExchange || !conn.open) return;
    const localTrust = this.getLocalTrustScore();
    const shareable = this.getSharedLibraryPeers();
    try {
     conn.send(JSON.stringify({
        type: 'library-exchange',
        peers: shareable,
        from: this.peerId,
        networkGenesis: getNetworkGenesisTimestamp(),
        senderTrustScore: localTrust,
      }));
      this.librarySentConnections.add(conn);
    } catch { /* ignore */ }
  }

  private handleLibraryExchange(fromPeerId: string, msg: Record<string, unknown>): void {
    if (!this.toggles.libraryExchange || fromPeerId === this.peerId || this.blockedPeers.has(fromPeerId)) return;
    const remote = msg.peers as Array<{ peerId: string; active?: boolean; userId?: string; nodeId?: string; alias?: string; lastSeenAt?: number; trustScore?: number; username?: string; displayName?: string; avatarRef?: string; walletAddress?: string; namespaceId?: string; discriminator?: string }> | undefined;
    if (!Array.isArray(remote)) return;

    // A real data edge is durable even when the sender shares an empty library.
    const senderConnection = this.connections.get(fromPeerId);
    if (senderConnection?.open && !this.library.has(fromPeerId)) this.addToLibrary(fromPeerId, 'library');

    // ── Adopt older network genesis from peer (rebirth, not new brain) ──
    const peerGenesis = msg.networkGenesis as number | undefined;
    if (peerGenesis && typeof peerGenesis === 'number') {
      adoptOlderGenesis(peerGenesis);
    }

    // Update lastSeenAt for the sender — they are clearly online
    const senderEntry = this.library.get(fromPeerId);
    if (senderEntry) {
      senderEntry.lastSeenAt = now();
      // Update sender's trust score if provided
      const senderTrust = msg.senderTrustScore as number | undefined;
      if (typeof senderTrust === 'number' && senderTrust >= 0 && senderTrust <= 1) {
        senderEntry.trustScore = senderTrust;
      }
      this.restorePeerEligibility(fromPeerId);
      this.saveLibrary();
    }

    const currentTime = now();
    let added = 0;
    let refreshed = 0;
    let metadataChanged = false;
    const dialCandidates = new Map<string, { peerId: string; lastSeenAt: number; trustScore: number }>();

    for (const rp of remote) {
      if (!rp || typeof rp.peerId !== 'string' || !rp.peerId || rp.peerId === this.peerId || this.blockedPeers.has(rp.peerId)) continue;

      // Live connections of the sender count as seen now. Relayed saved
      // contacts keep their own last-seen time (never in the future), so a
      // relay cannot keep a gone user alive past the share window.
      const relayedActive = rp.active !== false;
      const relayedSeenAt = typeof rp.lastSeenAt === 'number' && Number.isFinite(rp.lastSeenAt)
        ? Math.min(rp.lastSeenAt, currentTime) : 0;
      if (!relayedActive && (relayedSeenAt <= 0 || currentTime - relayedSeenAt > SAVED_CONTACT_SHARE_WINDOW_MS)) continue;
      const activeLastSeen = relayedActive ? currentTime : relayedSeenAt;
      const nextNodeId = rp.nodeId ?? rp.peerId.replace(/^peer-/, '');
      const nextAlias = rp.alias ?? `Node ${nextNodeId.slice(0, 6)}`;
      const nextTrust = typeof rp.trustScore === 'number' ? rp.trustScore : undefined;

      // Update lastSeenAt for peers we're currently connected to
      if (this.connections.has(rp.peerId)) {
        const existing = this.library.get(rp.peerId);
        if (existing) {
          existing.lastSeenAt = currentTime; // connected to us: live now
          if (nextTrust !== undefined) existing.trustScore = nextTrust;
        }
        this.restorePeerEligibility(rp.peerId);
        continue;
      }

      // A relayed saved contact is an older observation than what we may
      // already know: it may only fill gaps, never roll back identity or
      // provenance learned from a newer sighting.
      let hintIsNewer = true;
      const existing = this.library.get(rp.peerId);
      if (existing) {
        const prevLastSeen = existing.lastSeenAt;
        hintIsNewer = relayedActive || relayedSeenAt > prevLastSeen;
        existing.nodeId = nextNodeId;
        if (hintIsNewer && typeof rp.alias === 'string' && rp.alias.trim() && !rp.alias.startsWith('Node ')) {
          if (existing.alias !== rp.alias) metadataChanged = true;
          existing.alias = rp.alias;
        }
        existing.lastSeenAt = Math.max(existing.lastSeenAt, activeLastSeen);
        if (hintIsNewer && nextTrust !== undefined) existing.trustScore = nextTrust;
        // Saved 'library' friends keep their reconnect window when gossip
        // repeats them; only a live sighting reclassifies the entry.
        if (relayedActive && existing.source !== 'manual') existing.source = 'exchange';
        if (existing.lastSeenAt > prevLastSeen) refreshed++;
      } else {
        this.library.set(rp.peerId, {
          peerId: rp.peerId,
          nodeId: nextNodeId,
          alias: nextAlias,
          addedAt: currentTime,
          lastSeenAt: activeLastSeen,
          autoConnect: true,
          source: 'exchange',
          trustScore: nextTrust,
        });
        added++;
      }

      // Relayed identity enriches disconnected contacts only; a connected
      // peer's own profile-exchange remains authoritative. Older packets
      // without profile fields must not erase previously learned identity.
      const entry = this.library.get(rp.peerId);
      if (entry) {
        for (const key of ['userId', 'username', 'displayName', 'avatarRef'] as const) {
          const value = rp[key];
          if (!hintIsNewer && entry[key]) continue;
          if (typeof value === 'string' && value.trim() && entry[key] !== value) {
            if (key === 'userId') this.clearNamespaceAnchor(entry);
            entry[key] = value;
            metadataChanged = true;
          }
        }
        // Relayed namespace coordinates are never copied: only a well-formed
        // wallet anchor is taken, and the #discriminator is derived locally.
        if (entry.userId && (hintIsNewer || !entry.walletAddress) && isPublicWalletAddress(rp.walletAddress)
          && entry.walletAddress?.toLowerCase() !== rp.walletAddress.toLowerCase()) {
          this.clearNamespaceAnchor(entry);
          entry.walletAddress = rp.walletAddress;
          metadataChanged = true;
          this.deriveNamespaceAnchor(rp.peerId, entry.userId, rp.walletAddress);
        }
        const label = entry.displayName || entry.username;
        if (label && entry.source !== 'manual' && entry.alias !== label) {
          entry.alias = label;
          metadataChanged = true;
        }
      }

      // Only peers live right now are dialed; saved contacts are remembered
      // and reached later through the normal reconnect and discovery paths.
      if (relayedActive && !this.isPeerCoolingDown(rp.peerId)) {
        this.restorePeerEligibility(rp.peerId);
        dialCandidates.set(rp.peerId, {
          peerId: rp.peerId,
          lastSeenAt: activeLastSeen,
          trustScore: nextTrust ?? this.library.get(rp.peerId)?.trustScore ?? 0.3,
        });
      }
    }

    if (added > 0 || refreshed > 0 || metadataChanged) {
      this.saveLibrary();
      console.log(`[SwarmMesh] 📚 Active-peer exchange from ${fromPeerId}: added=${added}, refreshed=${refreshed}`);

      // Rebroadcast our active peer view so other connected peers can expand too
      // Liveness refreshes alone must not circulate snapshots forever in triangles.
      if (added > 0 || metadataChanged) {
        this.rebroadcastLibrary(fromPeerId);
      }
    }

    if (dialCandidates.size > 0) {
      const preferred = Array.from(dialCandidates.keys());
      this.expandOnlineMesh('library-exchange', preferred);
      this.scheduleMeshExpansion('library-exchange-followup', preferred, 2_000);
      this.scheduleMeshExpansion('library-exchange-followup', preferred, 5_000);
    }
    // Reciprocate once per actual channel, including an empty guest library.
    // Mark only successful sends; a replacement channel gets a fresh handshake.
    if (senderConnection?.open && !this.librarySentConnections.has(senderConnection)) {
      this.sendLibraryExchange(senderConnection);
    }
  }

  /**
   * Rebroadcast our full library to all connected peers except the excluded one.
   * This is the key mechanism for triangle gossip: when A connects to C,
   * A rebroadcasts to B so B discovers C and dials them.
   */
  private rebroadcastLibrary(excludePeerId?: string): void {
    if (!this.toggles.libraryExchange) return;
    const shareable = this.getSharedLibraryPeers();

    if (shareable.length === 0) return;

    let sent = 0;
    for (const [peerId, conn] of this.connections) {
      if (peerId === excludePeerId || !conn.open) continue;
      try {
        conn.send(JSON.stringify({
          type: 'library-exchange',
          peers: shareable,
          from: this.peerId,
          networkGenesis: getNetworkGenesisTimestamp(),
        }));
        this.librarySentConnections.add(conn);
        sent++;
      } catch { /* ignore */ }
    }
    if (sent > 0) {
      console.log(`[SwarmMesh] 📡 Rebroadcast library (${shareable.length} peers) to ${sent} connection(s), excluding ${excludePeerId?.slice(0, 16) ?? 'none'}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONTENT SERVING
  // ═══════════════════════════════════════════════════════════════════

  addContent(item: Omit<ContentItem, 'hash'>): void {
    const hash = `${item.id}-${item.timestamp}`;
    const full: ContentItem = { ...item, hash };
    this.contentStore.set(item.id, full);
    this.broadcastInternal({ type: 'content-push', items: [full] });
    for (const h of this.contentHandlers) { try { h(full); } catch { /* ignore */ } }
    this.emitContentChange();
  }

  getContent(): ContentItem[] {
    return Array.from(this.contentStore.values());
  }

  broadcastNewPost(post: Record<string, unknown>): void {
    if (this.phase !== 'online') return;
    const id = post.id as string;
    if (!id) return;

    // Always update the content store with the latest version
    const item: ContentItem = {
      id,
      type: 'post',
      data: post,
      author: (post.author as string) ?? 'unknown',
      timestamp: post.createdAt ? new Date(post.createdAt as string).getTime() : Date.now(),
      hash: `${id}-${Date.now()}`,
    };
    this.contentStore.set(id, item);
    this.emitContentChange();

    this.broadcastInternal({ type: 'content-push', items: [item] });
    console.log(`[SwarmMesh] 📤 Broadcast post ${id} to ${this.connections.size} peer(s)`);

    // If post has manifest IDs, also broadcast the file data
    const manifestIds = post.manifestIds as string[] | undefined;
    if (Array.isArray(manifestIds) && manifestIds.length > 0) {
      void this.broadcastFileDataForPost(manifestIds);
    }
  }

  /**
   * Broadcast a project upsert to all connected peers.
   * Public projects ride the same content-push pipeline as posts.
   */
  broadcastProject(project: Record<string, unknown>): void {
    const id = project.id as string;
    if (!id) return;
    const settings = project.settings as { visibility?: string } | undefined;
    if ((settings?.visibility ?? 'public') === 'private') return;

    const meta = project.meta as { updatedAt?: string; createdAt?: string } | undefined;
    const ts = Date.parse(String(meta?.updatedAt ?? meta?.createdAt ?? '')) || Date.now();
    const item: ContentItem = {
      id: `project:${id}`,
      type: 'project',
      data: project,
      author: (project.owner as string) ?? 'unknown',
      timestamp: ts,
      hash: `project:${id}-${ts}`,
    };
    this.contentStore.set(item.id, item);
    this.emitContentChange();

    if (this.phase !== 'online' || this.connections.size === 0) {
      console.log(`[SwarmMesh] 📦 Queued project ${id} (no peers, will sync on connect)`);
      return;
    }
    this.broadcastInternal({ type: 'content-push', items: [item] });
    console.log(`[SwarmMesh] 📤 Broadcast project ${id} to ${this.connections.size} peer(s)`);
  }

  /**
   * Pre-load every locally-stored public project into the content store so
   * the standard content-inventory exchange picks them up on each new peer
   * connection. Idempotent — call after start and after project mutations.
   */
  async hydrateProjectsIntoContentStore(): Promise<void> {
    try {
      const { getAll } = await import('../store');
      const projects = (await getAll('projects')) as Array<Record<string, unknown>>;
      let added = 0;
      for (const project of projects) {
        const id = project.id as string;
        if (!id) continue;
        const settings = project.settings as { visibility?: string } | undefined;
        if ((settings?.visibility ?? 'public') === 'private') continue;
        const meta = project.meta as { updatedAt?: string; createdAt?: string } | undefined;
        const ts = Date.parse(String(meta?.updatedAt ?? meta?.createdAt ?? '')) || Date.now();
        const key = `project:${id}`;
        const existing = this.contentStore.get(key);
        if (existing && existing.timestamp >= ts) continue;
        this.contentStore.set(key, {
          id: key,
          type: 'project',
          data: project,
          author: (project.owner as string) ?? 'unknown',
          timestamp: ts,
          hash: `${key}-${ts}`,
        });
        added++;
      }
      if (added > 0) {
        console.log(`[SwarmMesh] 🌱 Hydrated ${added} local project(s) into content store`);
        this.emitContentChange();
      }
    } catch (err) {
      console.warn('[SwarmMesh] hydrateProjectsIntoContentStore failed', err);
    }
  }

  /**
   * Broadcast a comment through the mesh so all peers save it to their local IndexedDB.
   */
  broadcastComment(comment: Record<string, unknown>): void {
    if (this.phase !== 'online') return;
    const id = comment.id as string;
    if (!id) return;

    const item: ContentItem = {
      id,
      type: 'comment',
      data: comment,
      author: (comment.author as string) ?? 'unknown',
      timestamp: comment.createdAt ? new Date(comment.createdAt as string).getTime() : Date.now(),
      hash: `${id}-${Date.now()}`,
    };
    this.contentStore.set(id, item);
    this.broadcastInternal({ type: 'content-push', items: [item] });
    console.log(`[SwarmMesh] 💬 Broadcast comment ${id} to ${this.connections.size} peer(s)`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // MENTION ALERTS — relay @mention notifications via swarm
  // ═══════════════════════════════════════════════════════════════════

  private mentionAlertBuffer: Array<{
    targetUserId: string;
    postId: string;
    triggeredBy: string;
    triggeredByName: string;
    content: string;
    ts: number;
  }> = [];

  broadcastMentionAlert(alert: {
    targetUserId: string;
    postId: string;
    triggeredBy: string;
    triggeredByName: string;
    content: string;
  }): void {
    if (this.phase !== 'online') return;
    const payload = { type: 'mention-alert' as const, ...alert, ts: now(), from: this.peerId };
    this.broadcastInternal(payload);
    // Buffer for offline peers (max 50)
    this.mentionAlertBuffer.push({ ...alert, ts: now() });
    if (this.mentionAlertBuffer.length > 50) this.mentionAlertBuffer.shift();
    console.log(`[SwarmMesh] 📢 Broadcast mention-alert for @${alert.targetUserId.slice(0, 12)}`);
  }

  private handleMentionAlert(_from: string, msg: Record<string, unknown>): void {
    const targetUserId = msg.targetUserId as string;
    if (!targetUserId) return;

    // Check if this mention is for us
    const localNodeId = this.nodeId;
    const localPeerId = this.peerId;
    const localUserId = this.getLocalProfile().userId;
    if (targetUserId !== localNodeId && targetUserId !== localPeerId && targetUserId !== localUserId) {
      // Not for us — relay to other peers (gossip)
      return;
    }

    // Create a local notification
    try {
      import('@/lib/notifications').then(({ createNotification }) => {
        createNotification({
          userId: targetUserId,
          type: 'mention',
          triggeredBy: (msg.triggeredBy as string) || 'unknown',
          triggeredByName: (msg.triggeredByName as string) || 'Someone',
          postId: (msg.postId as string) || undefined,
          content: (msg.content as string) || 'mentioned you',
        });
      }).catch(() => { /* ignore */ });
    } catch { /* ignore */ }
    console.log(`[SwarmMesh] 📬 Received mention-alert — creating notification`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STOP SUPPORT — posts this node sovereignly opted out of
  // (src/lib/content/unsupportedPostsStore.ts owns the list)
  // ═══════════════════════════════════════════════════════════════════

  private unsupportedKnown = new Set<string>();

  private watchUnsupportedPosts(): void {
    this.unsupportedKnown = new Set(listUnsupportedPosts().map((e) => e.postId));
    subscribeUnsupportedPosts(() => this.syncUnsupportedPosts());
    void hydrateUnsupportedPosts();
  }

  /** Apply Stop Support / Resume Support to the live mesh state. */
  private syncUnsupportedPosts(): void {
    const current = listUnsupportedPosts();
    const now = new Set(current.map((e) => e.postId));
    let changed = false;
    for (const entry of current) {
      // Deregister from the local seed pool and drop the relay copy.
      for (const manifestId of entry.manifestIds) {
        this.fileSeeders.get(manifestId)?.delete(this.peerId);
        this.clearAssetRetry(manifestId);
      }
      if (this.contentStore.delete(entry.postId)) changed = true;
    }
    for (const postId of this.unsupportedKnown) {
      if (!now.has(postId)) void this.restoreSupportedPost(postId);
    }
    this.unsupportedKnown = now;
    if (changed) this.emitContentChange();
  }

  /** Resume Support: serve the post again and re-register its media. */
  private async restoreSupportedPost(postId: string): Promise<void> {
    try {
      const { get } = await import('../store');
      const post = await get<Record<string, unknown>>('posts', postId);
      if (!post || isPostUnsupported(postId)) return;
      const createdAt = typeof post.createdAt === 'string' ? post.createdAt : undefined;
      this.contentStore.set(postId, {
        id: postId,
        type: 'post',
        data: post,
        author: typeof post.author === 'string' ? post.author : 'unknown',
        timestamp: createdAt ? new Date(createdAt).getTime() : Date.now(),
        hash: `${postId}-${createdAt ?? Date.now()}`,
      });
      this.emitContentChange();
      const manifestIds = Array.isArray(post.manifestIds)
        ? post.manifestIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
      for (const manifestId of manifestIds) {
        const { complete } = await this.ensureManifestAndChunks(manifestId);
        if (complete) this.announceSeeding(manifestId);
      }
    } catch (err) {
      console.warn('[SwarmMesh] Resume support failed for', postId, err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONTENT LIFECYCLE — signed tombstones, author presence, fadeout
  // (src/lib/p2p/contentLifecycle.ts owns the rules; this is transport)
  // ═══════════════════════════════════════════════════════════════════

  private lifecycle: typeof import('./contentLifecycle') | null = null;
  private lifecycleAttach: Promise<typeof import('./contentLifecycle') | null> | null = null;

  private attachContentLifecycle(): Promise<typeof import('./contentLifecycle') | null> {
    if (!this.lifecycleAttach) {
      this.lifecycleAttach = import('./contentLifecycle')
        .then(async (lc) => {
          await lc.ensureLifecycleLoaded();
          lc.registerTombstoneTransport((tombstones, excludePeerId) => {
            const payload = JSON.stringify({ type: 'content-tombstone', tombstones, from: this.peerId });
            let reached = 0;
            for (const [peerId, conn] of this.connections) {
              if (peerId === excludePeerId || !conn.open) continue;
              try { conn.send(payload); reached++; } catch { /* ignore */ }
            }
            return reached;
          });
          lc.onContentPurged((ids) => {
            let n = 0;
            for (const id of ids) if (this.contentStore.delete(id)) n++;
            if (n > 0) this.emitContentChange();
          });
          this.lifecycle = lc;
          return lc;
        })
        .catch((err) => {
          console.warn('[SwarmMesh] Content lifecycle unavailable:', err);
          this.lifecycleAttach = null;
          return null;
        });
    }
    return this.lifecycleAttach;
  }

  private sendLifecycleState(conn: import('peerjs').DataConnection): void {
    const lc = this.lifecycle;
    if (!lc) return;
    try {
      const hints = lc.getPresenceHints();
      if (Object.keys(hints).length > 0) {
        conn.send(JSON.stringify({ type: 'author-presence', hints, from: this.peerId }));
      }
      const tombstones = lc.getActiveTombstones();
      if (tombstones.length > 0) {
        conn.send(JSON.stringify({ type: 'content-tombstone', tombstones, from: this.peerId }));
      }
    } catch { /* ignore */ }
    // Deletions made while the identity key was locked go out once it can sign.
    void lc.flushPendingTombstones().catch(() => { /* retried on the next connect or sweep */ });
  }

  private sendContentInventory(conn: import('peerjs').DataConnection): void {
    const ids = Array.from(this.contentStore.keys());
    try { conn.send(JSON.stringify({ type: 'content-inventory', ids, from: this.peerId })); } catch { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MESSAGE HANDLING
  // ═══════════════════════════════════════════════════════════════════

  private handleMessage(from: string, raw: unknown): void {
    try {
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!data || typeof data !== 'object') return;
      const msg = data as { type?: string; [key: string]: unknown };

      // Feed every peer message into the shared neural engine
      try {
        import('./sharedNeuralEngine').then(({ getSharedNeuralEngine }) => {
          const engine = getSharedNeuralEngine();
          const kind = msg.type === 'ping' || msg.type === 'pong' ? 'ping' as const
            : msg.type === 'content-push' ? 'sync' as const
            : msg.type === 'blockchain-tx' || msg.type === 'mining-ack' ? 'chunk' as const
            : 'gossip' as const;
          engine.onInteraction(from, { kind, success: true });
        }).catch(() => { /* shared engine not available */ });
      } catch { /* ignore */ }

      if (typeof msg.type === 'string' && msg.type.startsWith('channel:')) {
        this.handleChannelMessage(from, msg.type, msg.payload);
        return;
      }

      switch (msg.type) {
        case 'content-inventory': this.handleInventory(from, msg); break;
        case 'content-request': this.handleRequest(from, msg); break;
        case 'content-push': this.handlePush(from, msg); break;
        case 'file-manifest': void this.handleFileManifest(from, msg); break;
        case 'manifest-request': void this.handleManifestRequest(from, msg); break;
        case 'manifest-response': this.resolveAssetRequest(msg); break;
        case 'chunk-request': void this.handleChunkRequest(from, msg); break;
        case 'chunk-response': this.resolveAssetRequest(msg); break;
        case 'file-data': void this.handleFileData(msg); break;
        case 'seeding-available': this.handleSeedingAvailable(from, msg); break;
        case 'library-exchange': this.handleLibraryExchange(from, msg); break;
        case 'profile-exchange': this.handleProfileExchange(from, msg); break;
        case 'heartbeat': this.handleHeartbeat(from); break;
        case 'heartbeat-ack': this.handleHeartbeatAck(from); break;
        case 'ping': this.handlePing(from, msg); break;
        case 'pong': this.handlePong(from, msg); break;
        case 'blockchain-tx': this.handleMiningBroadcast(from, msg); break;
        case 'mining-ack': this.handleMiningAck(from, msg); break;
        case 'block-vote': this.handleBlockVote(from, msg); break;
        case 'neural-state-digest': this.handleNeuralDigest(from, msg); break;
        case 'chain-sync-request': this.handleChainSyncRequest(from, msg); break;
        case 'chain-sync-response': this.handleChainSyncResponse(from, msg); break;
        case 'chain-block': this.handleChainBlock(from, msg); break;
        case 'market-sync-request': void this.handleMarketSyncRequest(from); break;
        case 'market-sync-response': void this.handleMarketSyncResponse(from, msg); break;
        case 'mention-alert': this.handleMentionAlert(from, msg); break;
        case 'content-tombstone':
          void this.attachContentLifecycle()
            .then((lc) => lc?.receiveTombstones(msg.tombstones, from))
            .catch(() => { /* invalid tombstones are dropped */ });
          break;
        case 'author-presence': this.lifecycle?.receivePresenceHints(msg.hints); break;
        default: break;
      }
    } catch (e) {
      console.warn('[SwarmMesh] Parse error from', from, e);
    }
  }

  private handleInventory(from: string, msg: Record<string, unknown>): void {
    const ids = msg.ids as string[] | undefined;
    if (!Array.isArray(ids)) return;
    const needed = ids.filter(id => !this.contentStore.has(id) && !isPostUnsupported(id));
    if (!needed.length) return;
    const conn = this.connections.get(from);
    if (conn) try { conn.send(JSON.stringify({ type: 'content-request', ids: needed, from: this.peerId })); } catch { /* ignore */ }
  }

  private handleRequest(from: string, msg: Record<string, unknown>): void {
    const ids = msg.ids as string[] | undefined;
    if (!Array.isArray(ids)) return;
    const conn = this.connections.get(from);
    if (!conn) return;
    const items = ids
      .map(id => this.contentStore.get(id))
      .filter((i): i is ContentItem => !!i && !(i.type === 'post' && isPostUnsupported(i.id)));
    if (!items.length) return;
    try {
      conn.send(JSON.stringify({ type: 'content-push', items, from: this.peerId }));
      const p = this.peerData.get(from);
      if (p) p.messagesSent++;
    } catch { /* ignore */ }
  }

  private handlePush(fromPeerId: string, msg: Record<string, unknown>): void {
    const items = msg.items as ContentItem[] | undefined;
    if (!Array.isArray(items)) return;
    let n = 0;
    const refused: Array<{ id?: string; author?: string }> = [];
    for (const item of items) {
      if (!item.id) continue;
      // Stop Support: this node neither stores nor relays the post.
      if (item.type === 'post' && isPostUnsupported(item.id)) continue;
      // Anti-resurrection: never take back deleted content; tell the sender why.
      const lc = this.lifecycle;
      if (lc && (item.type === 'post' || item.type === 'comment')) {
        const data = (item.data ?? {}) as { id?: unknown; author?: unknown };
        const author = typeof data.author === 'string' ? data.author : item.author;
        const postId = item.type === 'post' ? (typeof data.id === 'string' ? data.id : item.id) : undefined;
        if (lc.isPostTombstoned(postId, author)) {
          refused.push({ id: postId, author });
          continue;
        }
      }
      const existing = this.contentStore.get(item.id);
      const incomingTimestamp = typeof item.timestamp === 'number' ? item.timestamp : now();
      const shouldReplace =
        !existing ||
        incomingTimestamp >= existing.timestamp ||
        item.hash !== existing.hash;

      if (!shouldReplace) continue;

      this.contentStore.set(item.id, {
        ...item,
        timestamp: incomingTimestamp,
      });
      n++;
      if (item.type === 'post' && item.data) this.writePostToDB(item.data as Record<string, unknown>, fromPeerId);
      if (item.type === 'comment' && item.data) this.writeCommentToDB(item.data as Record<string, unknown>);
      if (item.type === 'project' && item.data) void this.writeProjectToDB(item.data as Record<string, unknown>);
      for (const h of this.contentHandlers) { try { h(item); } catch { /* ignore */ } }
    }
    if (refused.length > 0 && this.lifecycle) {
      const tombstones = this.lifecycle.tombstonesFor(refused);
      const conn = this.connections.get(fromPeerId);
      if (conn && tombstones.length > 0) {
        try { conn.send(JSON.stringify({ type: 'content-tombstone', tombstones, from: this.peerId })); } catch { /* ignore */ }
      }
    }
    if (n > 0) {
      console.log(`[SwarmMesh] 📦 ${n} new/updated item(s), total: ${this.contentStore.size}`);
      this.emitContentChange();
    }
  }

  private handleChannelMessage(from: string, type: string, payload: unknown): void {
    const channel = type.replace('channel:', '');
    if (!channel) return;
    const handlers = this.channelHandlers.get(channel);
    if (!handlers || handlers.size === 0) return;
    for (const handler of handlers) {
      try {
        handler(from, payload);
      } catch (error) {
        console.warn(`[SwarmMesh] Channel handler error (${channel}):`, error);
      }
    }
  }

  private handleHeartbeat(from: string): void {
    const conn = this.connections.get(from);
    if (conn) try { conn.send(JSON.stringify({ type: 'heartbeat-ack', from: this.peerId, ts: now() })); } catch { /* ignore */ }
  }

  private handleHeartbeatAck(from: string): void {
    const p = this.peerData.get(from);
    if (p) p.lastActivity = now();
    this.miningStats.heartbeatsReceived++;
    this.saveMiningStats();
  }

  private handlePing(from: string, msg: Record<string, unknown>): void {
    const conn = this.connections.get(from);
    if (conn) try { conn.send(JSON.stringify({ type: 'pong', from: this.peerId, echoTs: msg.ts, peerNow: networkNow() })); } catch { /* ignore */ }
  }

  private handlePong(from: string, msg: Record<string, unknown>): void {
    const echoTs = msg.echoTs as number | undefined;
    if (typeof echoTs !== 'number') return;
    const receivedAt = now();
    const rtt = receivedAt - echoTs;
    // Cadence Clock: newer peers also send their clock; older ones don't.
    if (typeof msg.peerNow === 'number') recordPeerClockSample(from, echoTs, msg.peerNow, receivedAt);
    const p = this.peerData.get(from);
    if (p) {
      p.lastRttMs = rtt;
      p.avgRttMs = p.avgRttMs != null ? Math.round(p.avgRttMs * 0.7 + rtt * 0.3) : rtt;
      p.lastActivity = now();
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MINING AS MOTION — mining broadcasts strengthen the mesh
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Handle an incoming mining broadcast from a peer.
   * Treats it as a confirmed liveness signal, performs passive PEX
   * via the librarySnapshot, and sends a mining-ack for RTT measurement.
   */
  private handleMiningBroadcast(from: string, msg: Record<string, unknown>): void {
    const meta = msg.meta as Record<string, unknown> | undefined;
    const blockHeight = meta?.blockHeight ?? '?';
    const peerCount = meta?.peerCount ?? '?';

    // Per-block receive logs are noisy at scale — keep silent unless debugging.
    void blockHeight; void peerCount;

    // ── Stage: Liveness update ──
    const p = this.peerData.get(from);
    if (p) {
      p.lastActivity = now();
      p.lastMinedBlock = now();
    }

    // ── Stage: Track block relay ──
    this.miningStats.blocksRelayed++;

    // ── Stage: Passive PEX ──
    if (meta && Array.isArray(meta.librarySnapshot)) {
      let discovered = 0;
      let refreshed = 0;
      let dialed = 0;
      const activeSeenAt = now();

      const preferredPeerIds: string[] = [];

      for (const snapshotPeerId of meta.librarySnapshot) {
        if (typeof snapshotPeerId !== 'string') continue;
        if (snapshotPeerId === this.peerId || this.blockedPeers.has(snapshotPeerId)) continue;

        if (this.connections.has(snapshotPeerId)) {
          const existing = this.library.get(snapshotPeerId);
          if (existing) {
            existing.lastSeenAt = activeSeenAt;
            if (existing.source !== 'manual') existing.source = 'exchange';
          }
          this.restorePeerEligibility(snapshotPeerId);
          continue;
        }

        const existing = this.library.get(snapshotPeerId);
        if (existing) {
          const prevLastSeen = existing.lastSeenAt;
          existing.lastSeenAt = Math.max(existing.lastSeenAt, activeSeenAt);
          if (existing.source !== 'manual') existing.source = 'exchange';
          if (existing.lastSeenAt > prevLastSeen) refreshed++;
        } else {
          this.library.set(snapshotPeerId, {
            peerId: snapshotPeerId,
            nodeId: snapshotPeerId.replace(/^peer-/, ''),
            alias: `Node ${snapshotPeerId.slice(5, 11)}`,
            addedAt: activeSeenAt,
            lastSeenAt: activeSeenAt,
            autoConnect: true,
            source: 'exchange',
          });
          discovered++;
        }

        this.restorePeerEligibility(snapshotPeerId);

        if (!this.isPeerCoolingDown(snapshotPeerId) && this.isFreshEnoughToDial(snapshotPeerId)) {
          preferredPeerIds.push(snapshotPeerId);
          if (this.dialPeer(snapshotPeerId, 'exchange')) {
            dialed++;
          }
        }
      }

      this.miningStats.peersDiscovered += discovered;
      if (discovered > 0 || refreshed > 0) {
        this.saveLibrary();
      }
      // Only log PEX when something actually changed — silent steady-state.
      if (discovered > 0 || dialed > 0) {
        console.log(
          `[SwarmMesh][Mining] 🔗 PEX from block — discovered=${discovered}, refreshed=${refreshed}, dialed=${dialed}`
        );
      }
      if (preferredPeerIds.length > 0) {
        this.scheduleMeshExpansion('mining-pex-followup', preferredPeerIds, 2_000);
        this.scheduleMeshExpansion('mining-pex-followup', preferredPeerIds, 5_000);
      }
    }
    this.saveMiningStats();

    // ── Stage: Send mining-ack ──
    const conn = this.connections.get(from);
    if (conn) {
      try {
        conn.send(JSON.stringify({
          type: 'mining-ack',
          from: this.peerId,
          blockHeight: this.miningStats.blocksMinedTotal,
          peerCount: this.connections.size,
          echoMinedAt: msg.minedAt,
          ts: now(),
        }));
      } catch (e) {
        console.warn(`[SwarmMesh][Mining] ❌ ACK FAILED to ${from.slice(0, 16)}…`, e);
      }

      // ── Stage: Send block-vote for CREATOR consensus ──
      const pendingBlockId = msg.pendingBlockId as string | undefined;
      const minerBlockHeight = msg.minerBlockHeight as number | undefined;
      if (pendingBlockId && typeof minerBlockHeight === 'number') {
        // Vote: agree if their proposed height seems sequential
        const peerInfo = this.peerData.get(from);
        const lastKnownHeight = peerInfo?.lastMinedBlock ? 1 : 0; // We trust if they're active
        const agree = minerBlockHeight > 0; // Basic validation: height must be positive
        try {
          conn.send(JSON.stringify({
            type: 'block-vote',
            from: this.peerId,
            pendingBlockId,
            minerBlockHeight,
            agree,
            voterBlockHeight: this.miningStats.blockHeight,
            voterConfirmed: this.miningStats.confirmedBlocks,
            ts: now(),
          }));
        } catch {
          console.warn(`[SwarmMesh][Mining] ❌ VOTE FAILED to ${from.slice(0, 16)}…`);
        }
      }
    }
  }

  /**
   * Handle incoming block-vote from a peer responding to our mined block.
   * Checks if majority consensus is reached to confirm the block.
   */
  private handleBlockVote(from: string, msg: Record<string, unknown>): void {
    const pendingBlockId = msg.pendingBlockId as string | undefined;
    const agree = msg.agree as boolean | undefined;
    if (!pendingBlockId) return;

    const pending = this.pendingBlockVotes.get(pendingBlockId);
    if (!pending) {
      return;
    }

    pending.votes.set(from, agree === true);
    const agreeCount = Array.from(pending.votes.values()).filter(v => v).length;
    const needed = Math.floor(pending.totalPeers / 2) + 1;

    void agree;

    // Check consensus: majority of connected peers agree
    if (agreeCount >= needed) {
      this.confirmBlock(pendingBlockId);
    }
  }

  /**
   * Handle a mining-ack response. Calculates RTT from the echoed
   * minedAt timestamp to measure connection quality.
   */
  private handleMiningAck(from: string, msg: Record<string, unknown>): void {
    this.miningStats.acksReceived++;
    this.saveMiningStats();
    const echoMinedAt = msg.echoMinedAt as number | undefined;
    const p = this.peerData.get(from);
    if (p) {
      p.lastActivity = now();
      if (typeof echoMinedAt === 'number') {
        const rtt = now() - echoMinedAt;
        p.miningRtt = rtt;
        p.lastRttMs = rtt;
        p.avgRttMs = p.avgRttMs != null ? Math.round(p.avgRttMs * 0.7 + rtt * 0.3) : rtt;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // NEURAL STATE DIGEST — collective memory exchange
  // ═══════════════════════════════════════════════════════════════════

  private sendNeuralDigest(conn: import('peerjs').DataConnection): void {
    try {
      import('./sharedNeuralEngine').then(({ getSharedNeuralEngine }) => {
        const engine = getSharedNeuralEngine();
        const digest = engine.exportDigest();
        conn.send(JSON.stringify({ type: 'neural-state-digest', digest, from: this.peerId }));
        console.log(`[SwarmMesh] 🧠 Sent neural digest (${digest.neurons.length} neurons, vocab=${Object.keys(digest.vocab ?? {}).length})`);
      }).catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }

  private handleNeuralDigest(_from: string, msg: Record<string, unknown>): void {
    const digest = msg.digest as Record<string, unknown> | undefined;
    if (!digest) return;
    try {
      import('./sharedNeuralEngine').then(({ getSharedNeuralEngine }) => {
        const engine = getSharedNeuralEngine();
        engine.importDigest(digest as any);
        engine.persistToStorage();
        console.log(`[SwarmMesh] 🧠 Merged neural digest from ${_from.slice(0, 16)}…`);
      }).catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  // BLOCKCHAIN CHAIN SYNC — full chain exchange across peers
  // ═══════════════════════════════════════════════════════════════════

  private handleChainSyncRequest(from: string, msg: Record<string, unknown> = {}): void {
    try {
      import('../blockchain/chain').then(({ getSwarmChain }) => {
        const chain = getSwarmChain();
        const blocks = chain.getChain();
        const conn = this.connections.get(from);
        if (!conn) return;
        const since = msg.since as ChainMark | null | undefined;
        // Older peers don't send `since` and don't understand pages: they
        // compare one response's length with their own chain, so give them
        // the whole chain in a single message, as before.
        const legacy = !('since' in msg);
        const pages = planCatchup(blocks, since, legacy ? Infinity : undefined);
        for (const page of pages) {
          conn.send(JSON.stringify({
            type: 'chain-sync-response',
            // `chain` keeps its name so older peers still read the blocks.
            chain: page.blocks,
            fromIndex: page.fromIndex,
            totalLength: page.totalLength,
            tip: page.tip,
            page: page.page,
            pages: page.pages,
            full: page.full,
            from: this.peerId,
          }));
        }
        const sent = blocks.length - (pages[0]?.fromIndex ?? 0);
        console.log(
          `[SwarmMesh] ⛓️ Sent ${sent} of ${blocks.length} blocks to ${from.slice(0, 16)}… ` +
          `(${pages[0]?.full ? 'full chain' : `from #${pages[0]?.fromIndex}`}, ${pages.length} page(s))`,
        );
      }).catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }

  private handleChainSyncResponse(_from: string, msg: Record<string, unknown>): void {
    const receivedChain = msg.chain as unknown[] | undefined;
    if (!Array.isArray(receivedChain)) return;
    // Older peers send one full chain with no paging fields.
    const page = typeof msg.page === 'number' ? msg.page : 0;
    const pages = typeof msg.pages === 'number' ? msg.pages : 1;
    const totalLength = typeof msg.totalLength === 'number' ? msg.totalLength : receivedChain.length;
    const isLastPage = page >= pages - 1;
    if (receivedChain.length === 0 && !isLastPage) return;
    try {
      import('../blockchain/chain').then(({ getSwarmChain }) => {
        const chain = getSwarmChain();
        const localChain = chain.getChain();
        const harvest = totalLength > localChain.length;
        if (harvest && receivedChain.length > 0) {
          console.log(`[SwarmMesh] ⛓️ Received ${receivedChain.length} block(s) from ${_from.slice(0, 16)}… (their chain ${totalLength} vs ours ${localChain.length}) — adopting`);
          // Add missing transactions from received chain
          for (const block of receivedChain as any[]) {
            if (block.transactions) {
              for (const tx of block.transactions) {
                // New coins come only from block rewards: never take a peer's self-issued mint.
                if (isSelfIssuedSwarmMint(tx)) continue;
                try { chain.addTransaction(tx); } catch { /* dup or invalid */ }
                if (typeof tx?.type === 'string' && tx.type.startsWith('coin_market_')) {
                  import('../blockchain/coinMarket')
                    .then(({ applyMarketTransaction }) => applyMarketTransaction(tx))
                    .catch(() => { /* ignore */ });
                }
              }
            }
          }
        }
        // Shared chain: collect the pages, then offer the whole picture to
        // fork choice once the last one is in.
        const fromIndex = typeof msg.fromIndex === 'number' ? msg.fromIndex : 0;
        if (page === 0 || !this.chainSyncPages.has(_from)) {
          this.chainSyncPages.set(_from, { fromIndex, blocks: [] });
        }
        this.chainSyncPages.get(_from)!.blocks.push(...(receivedChain as Record<string, unknown>[]));
        if (!isLastPage) return;
        const collected = this.chainSyncPages.get(_from);
        this.chainSyncPages.delete(_from);
        if (collected && collected.blocks.length > 0) void this.adoptFromSync(_from, collected.fromIndex, collected.blocks);
        // Remember their tip only once we've taken in everything up to it,
        // so next time they send just what's newer.
        if (harvest) saveChainMark(_from, msg.tip as ChainMark | undefined);
        // Markets are derivable from chain history — rebuild anything missing.
        import('../blockchain/marketSync')
          .then(({ rebuildMarketsFromChain }) => rebuildMarketsFromChain())
          .catch(() => { /* ignore */ });
      }).catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }

  /**
   * Shared chain: rebuild the peer's chain from what it sent and let fork
   * choice decide whether to switch to it. A partial answer only works if it
   * attaches to our own chain; if it doesn't, ask that peer for its full chain.
   */
  private async adoptFromSync(from: string, fromIndex: number, blocks: Record<string, unknown>[]): Promise<void> {
    try {
      const { getSwarmChain } = await import('../blockchain/chain');
      const chain = getSwarmChain();
      await chain.whenReady();
      const local = chain.getChain();
      let candidate: SwarmBlockShape[];
      if (fromIndex === 0) {
        candidate = blocks as unknown as SwarmBlockShape[];
      } else {
        const attachAt = local[fromIndex - 1];
        const first = blocks[0] as unknown as SwarmBlockShape | undefined;
        if (!attachAt || !first || first.previousHash !== attachAt.hash) {
          const conn = this.connections.get(from);
          try { conn?.send(JSON.stringify({ type: 'chain-sync-request', from: this.peerId, since: null })); } catch { /* ignore */ }
          return;
        }
        candidate = [...(local.slice(0, fromIndex) as unknown as SwarmBlockShape[]), ...(blocks as unknown as SwarmBlockShape[])];
      }
      const result = await chain.adoptPeerChain(candidate as never);
      if (result === 'adopted') {
        for (const block of candidate) if (typeof block.hash === 'string') this.seenChainBlocks.add(block.hash);
      }
    } catch (err) {
      console.warn('[SwarmMesh] ⛓️ Chain adoption failed:', err);
    }
  }

  /** Shared chain: send a block we just mined to every connected peer. */
  announceChainBlock(block: unknown): void {
    const hash = (block as { hash?: unknown })?.hash;
    if (typeof hash !== 'string') return;
    this.rememberChainBlock(hash);
    this.broadcastInternal({ type: 'chain-block', block });
  }

  private rememberChainBlock(hash: string): void {
    this.seenChainBlocks.add(hash);
    if (this.seenChainBlocks.size > 2_000) {
      const oldest = this.seenChainBlocks.values().next().value;
      if (oldest !== undefined) this.seenChainBlocks.delete(oldest);
    }
  }

  /**
   * Shared chain: a peer mined (or relayed) a block. If it extends our tip,
   * add it and pass it on. If it's ahead of us, catch up from that peer, which
   * also runs fork choice when our chains have split.
   */
  private handleChainBlock(from: string, msg: Record<string, unknown>): void {
    const block = msg.block as SwarmBlockShape | undefined;
    if (!block || typeof block.hash !== 'string' || typeof block.index !== 'number') return;
    if (this.seenChainBlocks.has(block.hash)) return;
    this.rememberChainBlock(block.hash);
    // A live block was mined moments ago: its stamp must sit near the mesh
    // clock. Peers online now are the witnesses that keep block times honest.
    const stamped = Date.parse(String(block.timestamp ?? ''));
    if (!Number.isFinite(stamped) || Math.abs(stamped - networkNow()) > FUTURE_LIMIT_MS) return;
    void (async () => {
      try {
        const { getSwarmChain } = await import('../blockchain/chain');
        const chain = getSwarmChain();
        await chain.whenReady();
        if (await chain.appendPeerBlock(block as never)) {
          const payload = JSON.stringify({ type: 'chain-block', block, from: this.peerId });
          for (const [peerId, conn] of this.connections) {
            if (peerId === from) continue;
            try { conn.send(payload); } catch { /* ignore */ }
          }
          return;
        }
        if (block.index > chain.getLatestBlock().index) {
          const conn = this.connections.get(from);
          try { conn?.send(JSON.stringify({ type: 'chain-sync-request', from: this.peerId, since: getChainMark(from) })); } catch { /* ignore */ }
        }
      } catch (err) {
        console.warn('[SwarmMesh] ⛓️ Peer block failed:', err);
      }
    })();
  }

  // ═══════════════════════════════════════════════════════════════════
  // CREATOR MARKET SYNC — replicate profile markets across the mesh
  // ═══════════════════════════════════════════════════════════════════

  private async handleMarketSyncRequest(from: string): Promise<void> {
    try {
      const { buildMarketSnapshot } = await import('../blockchain/marketSync');
      const snapshot = await buildMarketSnapshot();
      if (!snapshot.tokens.length && !snapshot.vaults.length && !snapshot.holdings.length) return;
      const conn = this.connections.get(from);
      if (!conn) return;
      conn.send(JSON.stringify({ type: 'market-sync-response', from: this.peerId, snapshot }));
      console.log(
        `[SwarmMesh] 🏪 Sent ${snapshot.tokens.length} market(s) to ${from.slice(0, 16)}…`,
      );
    } catch (err) {
      console.warn('[SwarmMesh] market-sync-request failed:', err);
    }
  }

  private async handleMarketSyncResponse(from: string, msg: Record<string, unknown>): Promise<void> {
    const snapshot = msg.snapshot as Parameters<
      typeof import('../blockchain/marketSync')['mergeMarketSnapshot']
    >[0];
    if (!snapshot) return;
    try {
      const [{ mergeMarketSnapshot }, { getCurrentUser }] = await Promise.all([
        import('../blockchain/marketSync'),
        import('../auth'),
      ]);
      const localUserId = getCurrentUser()?.id ?? null;
      const merged = await mergeMarketSnapshot(snapshot, localUserId);
      if (merged.tokens || merged.vaults || merged.holdings) {
        console.log(
          `[SwarmMesh] 🏪 Replicated ${merged.tokens} market(s) / ${merged.vaults} vault(s) / ` +
          `${merged.holdings} holding(s) from ${from.slice(0, 16)}…`,
        );
      }
    } catch (err) {
      console.warn('[SwarmMesh] market-sync-response failed:', err);
    }
  }

  /** Push a market snapshot (optionally a single token) to all connected peers. */
  async broadcastMarketSnapshot(tokenId?: string): Promise<void> {
    try {
      const { buildMarketSnapshot } = await import('../blockchain/marketSync');
      const snapshot = await buildMarketSnapshot(tokenId);
      if (!snapshot.tokens.length && !snapshot.vaults.length) return;
      this.broadcastInternal({ type: 'market-sync-response', snapshot });
      console.log(`[SwarmMesh] 🏪 Broadcast market snapshot (${snapshot.tokens.length} token(s))`);
    } catch (err) {
      console.warn('[SwarmMesh] broadcastMarketSnapshot failed:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERVALS — Heartbeat, RTT ping, Content Sync
  // ═══════════════════════════════════════════════════════════════════

  private startIntervals(): void {
    this.clearIntervals();

    this.heartbeatTimer = setInterval(() => {
      this.observeConnectionTime();
      const t = now();
      for (const [peerId, peer] of this.peerData) {
        // Mining as Motion: peers actively mining get a longer stale threshold
        const isMining = peer.lastMinedBlock != null && (t - peer.lastMinedBlock) < MINING_COLD_THRESHOLD;
        const threshold = isMining ? PEER_STALE_THRESHOLD_MINING : PEER_STALE_THRESHOLD;

        const staleConn = this.connections.get(peerId);
        const linkState = (staleConn as { peerConnection?: RTCPeerConnection } | undefined)?.peerConnection?.connectionState;
        const linkLive = staleConn?.open === true && linkState === 'connected';
        if (shouldEvictQuietPeer(t - peer.lastActivity, threshold, linkLive)) {
          console.log(
            `[SwarmMesh][Mining] 🧊 STALE PEER ${peerId.slice(0, 16)}… removed — ` +
            `idle=${Math.round((t - peer.lastActivity) / 1000)}s, threshold=${threshold / 1000}s, ` +
            `wasMining=${isMining}`
          );
          const conn = this.connections.get(peerId);
          try { conn?.close(); } catch { /* ignore */ }
          this.connections.delete(peerId);
          this.peerData.delete(peerId);
          this.emitPeers();
          this.noteDroppedPeer(peerId);
          continue;
        }
        const conn = this.connections.get(peerId);
        if (conn) {
          try { conn.send(JSON.stringify({ type: 'heartbeat', from: this.peerId })); this.miningStats.heartbeatsSent++; } catch { /* ignore */ }
          try { conn.send(JSON.stringify({ type: 'ping', from: this.peerId, ts: now() })); } catch { /* ignore */ }
          this.miningStats.lastHeartbeatAt = now();
          this.saveMiningStats();
        }
      }

      // ── Feed connection health to neural engine / instinct hierarchy ──
      try {
        const librarySize = Math.max(this.library.size, 1);
        const connectedCount = this.connections.size;
        const connectionHealth = Math.min(1, connectedCount / librarySize);
        import('./sharedNeuralEngine').then(({ getSharedNeuralEngine }) => {
          const engine = getSharedNeuralEngine();
          // Store connectionHealth on the engine for instinct hierarchy consumption
          (engine as unknown as Record<string, number>)._connectionHealth = connectionHealth;
        }).catch(() => { /* ignore */ });
      } catch { /* ignore */ }
    }, HEARTBEAT_INTERVAL);

    this.contentSyncTimer = setInterval(() => {
      for (const [, conn] of this.connections) this.sendContentInventory(conn);
    }, CONTENT_SYNC_INTERVAL);

    // Low-frequency market reconciliation.
    let marketTick = 0;
    this.marketSyncTimer = setInterval(() => {
      marketTick++;
      if (this.connections.size === 0) return;
      for (const [, conn] of this.connections) {
        try { conn.send(JSON.stringify({ type: 'market-sync-request', from: this.peerId })); } catch { /* ignore */ }
      }
      if (marketTick % 3 === 0) {
        import('../blockchain/marketSync')
          .then(({ rebuildMarketsFromChain }) => rebuildMarketsFromChain())
          .catch(() => { /* ignore */ });
      }
    }, MARKET_SYNC_INTERVAL);
  }

  private clearIntervals(): void {
    if (this.heartbeatTimer !== null) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.contentSyncTimer !== null) { clearInterval(this.contentSyncTimer); this.contentSyncTimer = null; }
    if (this.marketSyncTimer !== null) { clearInterval(this.marketSyncTimer); this.marketSyncTimer = null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // BROADCAST
  // ═══════════════════════════════════════════════════════════════════

  private broadcastInternal(msg: Record<string, unknown>): void {
    const payload = JSON.stringify({ ...msg, from: this.peerId });
    for (const [peerId, conn] of this.connections) {
      try {
        conn.send(payload);
        const p = this.peerData.get(peerId);
        if (p) p.messagesSent++;
      } catch { /* ignore */ }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PEER INSTANCE
  // ═══════════════════════════════════════════════════════════════════

  private destroyPeer(): void {
    if (this.peer) { this.destroyPeerInstance(this.peer); this.peer = null; }
  }

  private destroyPeerInstance(peer: import('peerjs').default): void {
    try {
      peer.removeAllListeners?.();
      if (!peer.destroyed) peer.destroy();
    } catch { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVENT SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════════════

  onPhaseChange(handler: PhaseHandler): () => void {
    this.phaseHandlers.add(handler);
    handler(this.phase);
    return () => { this.phaseHandlers.delete(handler); };
  }

  onPeersChange(handler: PeerHandler): () => void {
    this.peerHandlers.add(handler);
    handler(Array.from(this.peerData.values()));
    return () => { this.peerHandlers.delete(handler); };
  }

  onContent(handler: ContentHandler): () => void {
    this.contentHandlers.add(handler);
    return () => { this.contentHandlers.delete(handler); };
  }

  onContentChange(handler: ContentChangeHandler): () => void {
    this.contentChangeHandlers.add(handler);
    handler(this.getContent());
    return () => { this.contentChangeHandlers.delete(handler); };
  }

  onAlert(handler: AlertHandler): () => void {
    this.alertHandlers.add(handler);
    return () => { this.alertHandlers.delete(handler); };
  }

  onToggleChange(handler: ToggleHandler): () => void {
    this.toggleHandlers.add(handler);
    handler(this.getToggles());
    return () => { this.toggleHandlers.delete(handler); };
  }

  onMiningChange(handler: MiningHandler): () => void {
    this.miningHandlers.add(handler);
    handler(this.getMiningStats());
    return () => { this.miningHandlers.delete(handler); };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PROFILE EXCHANGE — peers share identity info on connect
  // ═══════════════════════════════════════════════════════════════════

  private getLocalProfile(): { userId?: string; username?: string; displayName?: string; avatarRef?: string } {
    try {
      const raw = localStorage.getItem('me');
      if (!raw) return {};
      const user = JSON.parse(raw);
      return {
        userId: user._guest === true ? undefined : typeof user.id === 'string' ? user.id : undefined,
        username: user._guest === true ? undefined : user.username || undefined,
        displayName: user._guest === true ? user.guestName?.trim() || 'Guest' : user.displayName || user.username || undefined,
        avatarRef: user.profile?.avatarRef || undefined,
      };
    } catch { return {}; }
  }

  private sendProfileExchange(conn: import('peerjs').DataConnection): void {
    const profile = this.getLocalProfile();
    if (!profile.userId && !profile.username && !profile.displayName) return;
    try {
      conn.send(JSON.stringify({
        type: 'profile-exchange',
        from: this.peerId,
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatarRef: profile.avatarRef,
      }));
    } catch { /* ignore */ }
    if (profile.userId) void import('@/lib/blockchain/wallets/coldKey').then(async ({ getColdKeyReceivingAddress }) => {
      const walletAddress = await getColdKeyReceivingAddress(profile.userId ?? '');
      if (this.getLocalProfile().userId !== profile.userId || !conn.open) return;
      conn.send(JSON.stringify({ type: 'profile-exchange', from: this.peerId, ...profile, walletAddress }));
    }).catch(() => { /* older locked accounts announce identity without a fabricated address */ });
  }

  private handleProfileExchange(fromPeerId: string, msg: Record<string, unknown>): void {
    const userId = typeof msg.userId === 'string' && msg.userId.trim() ? msg.userId.trim() : undefined;
    const username = typeof msg.username === 'string' ? msg.username : undefined;
    const displayName = typeof msg.displayName === 'string' ? msg.displayName : undefined;
    const avatarRef = typeof msg.avatarRef === 'string' ? msg.avatarRef : undefined;

    if (!userId && !username && !displayName) return;

    // A live connection is the strongest sign an author is active (fadeout clock).
    if (userId) this.lifecycle?.noteAuthorSeen(userId);

    const entry = this.library.get(fromPeerId);
    if (entry) {
      if (entry.userId !== userId) this.clearNamespaceAnchor(entry);
      entry.userId = userId;
      entry.username = username;
      entry.displayName = displayName;
      entry.avatarRef = avatarRef;
      if (displayName) entry.alias = displayName;
      this.saveLibrary();
      this.emitPeers();
      if (userId && isPublicWalletAddress(msg.walletAddress)) {
        // Claim the wallet now so any pending derivation for an older wallet is discarded.
        if (entry.walletAddress?.toLowerCase() !== msg.walletAddress.toLowerCase()) this.clearNamespaceAnchor(entry);
        entry.walletAddress = msg.walletAddress;
        this.deriveNamespaceAnchor(fromPeerId, userId, msg.walletAddress);
      }
      if (userId) void import('@/lib/blockchain/wallets/nativeAddress')
        .then(({ hydrateNativeWalletPeer }) => hydrateNativeWalletPeer({ userId, username, displayName, avatarRef }))
        .catch(() => { /* address resolution retries durable hydration */ });
      // Initial library exchange can precede profile arrival. Share the
      // updated active contact with other peers once its own identity arrives.
      if (this.toggles.libraryExchange) this.rebroadcastLibrary(fromPeerId);
      console.log(`[SwarmMesh] 👤 Profile received from ${fromPeerId}: ${displayName ?? username}`);
    }
  }


  private clearNamespaceAnchor(entry: LibraryPeer): void {
    delete entry.walletAddress;
    delete entry.namespaceId;
    delete entry.discriminator;
  }

  /** Derive namespace coordinates locally from a peer's claimed userId + wallet anchor. */
  private deriveNamespaceAnchor(peerId: string, userId: string, walletAddress: string): void {
    void import('@/lib/uqrc/namespaceIdentity').then(async ({ namespaceIdentity }) => {
      const identity = await namespaceIdentity(userId, walletAddress);
      const entry = this.library.get(peerId);
      // Identity or wallet may have rotated while hashing; a superseded
      // derivation must never overwrite the newer anchor.
      if (!entry || entry.userId !== userId || entry.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) return;
      Object.assign(entry, identity, { walletAddress });
      this.saveLibrary();
    }).catch(() => { /* no namespace anchor without a real public address */ });
  }

  private observeConnectionTime(): void {
    const owner = this.getLocalProfile().userId;
    if (!owner) return;
    observeConnections(owner, Array.from(this.peerData.values()).map(peer => ({
      peerId: peer.peerId, connectedAt: peer.connectedAt, userId: this.library.get(peer.peerId)?.userId,
    })));
  }

  private emitPeers(): void {
    this.observeConnectionTime();
    const peers = Array.from(this.peerData.values());
    for (const h of this.peerHandlers) { try { h(peers); } catch { /* ignore */ } }
  }

  private emitAlert(message: string, level: 'info' | 'warn' | 'error'): void {
    console.log(`[SwarmMesh] Alert (${level}): ${message}`);
    for (const h of this.alertHandlers) { try { h(message, level); } catch { /* ignore */ } }
  }

  private emitContentChange(): void {
    const items = this.getContent();
    for (const h of this.contentChangeHandlers) { try { h(items); } catch { /* ignore */ } }
  }

  private emitToggles(): void {
    const t = this.getToggles();
    for (const h of this.toggleHandlers) { try { h(t); } catch { /* ignore */ } }
  }

  private emitMining(): void {
    const s = this.getMiningStats();
    for (const h of this.miningHandlers) { try { h(s); } catch { /* ignore */ } }
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════════

  getStats(): SwarmMeshStandaloneStats {
    const peers = Array.from(this.peerData.values());
    return {
      phase: this.phase,
      peerId: this.phase === 'online' ? this.peerId : null,
      nodeId: this.nodeId,
      connectedPeers: this.connections.size,
      contentItems: this.contentStore.size,
      uptimeMs: this.startedAt ? now() - this.startedAt : 0,
      reconnectAttempt: this.reconnectAttempt,
      flags: this.getFlags(),
      toggles: this.getToggles(),
      miningStats: this.getMiningStats(),
      bootstrapOnline: peers.filter(p => p.source === 'bootstrap').length,
      libraryOnline: peers.filter(p => p.source === 'library' || p.source === 'exchange').length,
      assetSync: {
        manifestsPulled: this._assetSyncCounters.manifestsPulled,
        chunksPulled: this._assetSyncCounters.chunksPulled,
        chunksServed: this._assetSyncCounters.chunksServed,
        pendingManifests: this.assetRetryTimers.size,
        activeRetries: this.assetRetryAttempts.size,
        queuedOffline: this.pendingAssetQueue.size,
      },
  };
  }

  // ── File Transfer Preferences ──────────────────────────────────────

  private static readonly PREFS_KEY = 'swarm-mesh-file-prefs';

  private _filePrefs: Record<string, { paused?: boolean; ignored?: boolean; hostFirst?: boolean }> | null = null;

  private loadFilePrefs(): Record<string, { paused?: boolean; ignored?: boolean; hostFirst?: boolean }> {
    if (this._filePrefs) return this._filePrefs;
    try {
      const raw = localStorage.getItem(StandaloneSwarmMesh.PREFS_KEY);
      this._filePrefs = raw ? JSON.parse(raw) : {};
    } catch { this._filePrefs = {}; }
    return this._filePrefs!;
  }

  private saveFilePrefs(): void {
    try { localStorage.setItem(StandaloneSwarmMesh.PREFS_KEY, JSON.stringify(this._filePrefs ?? {})); } catch {}
  }

  setFilePref(fileId: string, key: 'paused' | 'ignored' | 'hostFirst', value: boolean): void {
    const prefs = this.loadFilePrefs();

    // Enforce single-star: un-star any previously starred file first
    if (key === 'hostFirst' && value) {
      for (const [existingId, existingPref] of Object.entries(prefs)) {
        if (existingId !== fileId && existingPref.hostFirst) {
          existingPref.hostFirst = false;
        }
      }
    }

    if (!prefs[fileId]) prefs[fileId] = {};
    prefs[fileId][key] = value;
    this._filePrefs = prefs;
    this.saveFilePrefs();

    // If ignoring, cancel any pending retry
    if (key === 'ignored' && value) {
      this.clearAssetRetry(fileId);
    }
    // If pausing, cancel pending retry (will resume when unpaused)
    if (key === 'paused' && value) {
      this.clearAssetRetry(fileId);
    }
  }

  getFilePref(fileId: string): { paused: boolean; ignored: boolean; hostFirst: boolean } {
    const prefs = this.loadFilePrefs();
    const p = prefs[fileId];
    return { paused: p?.paused ?? false, ignored: p?.ignored ?? false, hostFirst: p?.hostFirst ?? false };
  }

  isFileBlocked(fileId: string): boolean {
    if (isManifestUnsupported(fileId)) return true;
    const p = this.getFilePref(fileId);
    return p.paused || p.ignored;
  }

  isHostFirst(fileId: string): boolean {
    return this.getFilePref(fileId).hostFirst;
  }

  /**
   * Returns per-file transfer info for the dashboard.
   */
  async getFileTransferList(): Promise<Array<{
    fileId: string;
    name: string;
    mime: string;
    totalChunks: number;
    receivedChunks: number;
    size: number;
    percent: number;
    retrying: boolean;
    owner: string;
    createdAt: number;
    prefs: { paused: boolean; ignored: boolean; hostFirst: boolean };
  }>> {
    try {
      const db = await this.openDB();
      if (!db.objectStoreNames.contains('manifests')) { db.close(); return []; }
      const manifests = await new Promise<StoredManifestLike[]>((resolve) => {
        const tx = db.transaction('manifests', 'readonly');
        const req = tx.objectStore('manifests').getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => resolve([]);
      });

      // Build a set of all existing chunk refs in one pass for performance
      const hasChunkStore = db.objectStoreNames.contains('chunks');
      const existingChunkRefs = new Set<string>();
      if (hasChunkStore) {
        await new Promise<void>((resolve) => {
          const tx = db.transaction('chunks', 'readonly');
          const req = tx.objectStore('chunks').getAllKeys();
          req.onsuccess = () => {
            for (const key of (req.result ?? [])) {
              if (typeof key === 'string') existingChunkRefs.add(key);
            }
            resolve();
          };
          req.onerror = () => resolve();
        });
      }

      const results: Array<{
        fileId: string; name: string; mime: string;
        totalChunks: number; receivedChunks: number; size: number;
        percent: number; retrying: boolean;
        owner: string; createdAt: number;
        prefs: { paused: boolean; ignored: boolean; hostFirst: boolean };
      }> = [];

      for (const m of manifests) {
        const fileId = m.fileId ?? '';
        if (!fileId) continue;
        const chunkRefs = Array.isArray(m.chunks) ? m.chunks.filter((r): r is string => typeof r === 'string') : [];
        const received = chunkRefs.filter(ref => existingChunkRefs.has(ref)).length;
        const mRec = m as Record<string, unknown>;
        const fileSize = typeof mRec.size === 'number' ? mRec.size as number : 0;
        // Fixed 1 MiB chunk size — 1:1 ratio of chunks to file size in MiB (rounded up)
        const total = fileSize > 0 ? Math.max(1, Math.ceil(fileSize / 1_048_576)) : chunkRefs.length;
        // Scale received count proportionally if DB refs use different chunk size
        const scaledReceived = chunkRefs.length > 0 && chunkRefs.length !== total
          ? Math.min(total, Math.round((received / chunkRefs.length) * total))
          : received;
        results.push({
          fileId,
          name: mRec.originalName as string ?? fileId.slice(0, 12),
          mime: mRec.mime as string ?? 'unknown',
          totalChunks: total,
          receivedChunks: scaledReceived,
          size: fileSize,
          percent: total > 0 ? Math.round((scaledReceived / total) * 100) : 100,
          retrying: this.assetRetryTimers.has(fileId),
          owner: (mRec.owner as string) ?? '',
          createdAt: typeof mRec.createdAt === 'string' ? new Date(mRec.createdAt as string).getTime() : (typeof mRec.createdAt === 'number' ? mRec.createdAt as number : 0),
          prefs: this.getFilePref(fileId),
        });
      }
      db.close();
      return results;
    } catch {
      return [];
    }
  }

  getConnectedPeers(): string[] {
    return Array.from(this.connections.keys());
  }

  getConnectedPeerIds(): string[] {
    return this.getConnectedPeers();
  }

  getPeerDetails(): SwarmPeer[] {
    return Array.from(this.peerData.values());
  }

  getContentBlockCount(): number {
    return this.contentStore.size;
  }

  // ═══════════════════════════════════════════════════════════════════
  // TORRENT SWARM — Multi-peer content distribution
  // ═══════════════════════════════════════════════════════════════════

  private torrentSwarmInstance: import('./torrentSwarm.standalone').TorrentSwarm | null = null;
  private torrentSwarmUnsub: (() => void) | null = null;

  private startTorrentSwarm(): void {
    if (this.torrentSwarmInstance) return;
    try {
      // Lazy import to preserve standalone pattern
      import('./meshTorrentAdapter').then(({ createMeshTorrentAdapter }) => {
        import('./torrentSwarm.standalone').then(({ TorrentSwarm }) => {
          if (this.phase !== 'online') return;
          const adapter = createMeshTorrentAdapter(this, this.peerId);
          this.torrentSwarmInstance = new TorrentSwarm(adapter);
          this.torrentSwarmInstance.start();
          console.log('[SwarmMesh] 🌊 TorrentSwarm started — multi-peer content distribution active');

          // Media coins ride the same mesh adapter: whole-coin hand-offs
          // that loop peer to peer back to their creator.
          import('@/lib/blockchain/mediaCoinRuntime')
            .then(({ startMediaCoinRuntime }) => startMediaCoinRuntime(adapter))
            .catch(err => console.warn('[SwarmMesh] Failed to start media coin runtime:', err));

          // Wire Gun relay for secondary content delivery
          this.attachGunRelayToTorrent();

          // Auto re-seed legacy files that used larger chunk sizes
          this.autoReseedLegacyFiles();
        }).catch(err => console.warn('[SwarmMesh] Failed to load torrentSwarm:', err));
      }).catch(err => console.warn('[SwarmMesh] Failed to load meshTorrentAdapter:', err));
    } catch (err) {
      console.warn('[SwarmMesh] Failed to start TorrentSwarm:', err);
    }
  }

  private attachGunRelayToTorrent(): void {
    if (!this.torrentSwarmInstance) return;
    import('./transports/gunAdapter').then(({ GunAdapter }) => {
      if (!this.torrentSwarmInstance) return;
      const gun = new GunAdapter({
        peers: ['https://gun-manhattan.herokuapp.com/gun'],
        graphKey: 'swarm-space/torrent',
      });
      gun.start({ peerId: this.peerId }).then(() => {
        if (!this.torrentSwarmInstance) return;
        this.torrentSwarmInstance.attachGunRelay(gun);
        console.log('[SwarmMesh] 🔗 Gun relay wired to TorrentSwarm');
      }).catch(err => {
        console.warn('[SwarmMesh] Gun relay attach failed:', err);
      });
    }).catch(err => {
      console.warn('[SwarmMesh] Failed to import GunAdapter for torrent relay:', err);
    });
  }

  private stopTorrentSwarm(): void {
    if (this.torrentSwarmInstance) {
      this.torrentSwarmInstance.stop();
      this.torrentSwarmInstance = null;
      import('@/lib/blockchain/mediaCoinRuntime')
        .then(({ stopMediaCoinRuntime }) => stopMediaCoinRuntime())
        .catch(() => {});
      console.log('[SwarmMesh] 🌊 TorrentSwarm stopped');
    }
  }

  getTorrentSwarm(): import('./torrentSwarm.standalone').TorrentSwarm | null {
    return this.torrentSwarmInstance;
  }

  // ═══════════════════════════════════════════════════════════════════
  // DELETE / RESEED — Exposed to dashboard
  // ═══════════════════════════════════════════════════════════════════

  async deleteFile(fileId: string): Promise<void> {
    // Remove from TorrentSwarm in-memory state
    if (this.torrentSwarmInstance) {
      // Try to find manifest by fileId (torrent manifests use their own IDs)
      const allManifests = this.torrentSwarmInstance.getAllManifests();
      for (const m of allManifests) {
        if (m.id === fileId || m.name === fileId) {
          this.torrentSwarmInstance.remove(m.id);
        }
      }
    }

    // Remove file prefs
    const prefs = this.loadFilePrefs();
    delete prefs[fileId];
    this._filePrefs = prefs;
    this.saveFilePrefs();

    // Cancel any pending asset retries
    const retryTimer = this.assetRetryTimers.get(fileId);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this.assetRetryTimers.delete(fileId);
      this.assetRetryAttempts.delete(fileId);
    }

    // Delete from IndexedDB (manifest + chunks)
    try {
      const { deleteManifest } = await import('../fileEncryption');
      await deleteManifest(fileId);
      console.log(`[SwarmMesh] 🗑️ Deleted file ${fileId} from IndexedDB`);
    } catch (err) {
      console.warn('[SwarmMesh] Failed to delete file from IndexedDB:', err);
    }
  }

  async reseedFile(fileId: string): Promise<void> {
    // First, unflag seedingPaused on the manifest in IndexedDB
    try {
      const db = await this.openDB();
      if (db.objectStoreNames.contains('manifests')) {
        await new Promise<void>((resolve) => {
          const tx = db.transaction('manifests', 'readwrite');
          const store = tx.objectStore('manifests');
          const req = store.get(fileId);
          req.onsuccess = () => {
            const record = req.result as Record<string, unknown> | undefined;
            if (record && record.seedingPaused) {
              delete record.seedingPaused;
              delete record.pausedAt;
              store.put(record);
              console.log(`[SwarmMesh] ♻️ Unpaused manifest ${fileId} for re-seed`);
            }
            resolve();
          };
          req.onerror = () => resolve();
          tx.oncomplete = () => db.close();
        });
      } else {
        db.close();
      }
    } catch { /* best effort */ }

    if (!this.torrentSwarmInstance) {
      console.warn('[SwarmMesh] Cannot reseed — TorrentSwarm not running');
      return;
    }
    const allManifests = this.torrentSwarmInstance.getAllManifests();
    for (const m of allManifests) {
      if (m.id === fileId || m.name === fileId) {
        const result = await this.torrentSwarmInstance.reseed(m.id);
        if (result) {
          this.emitAlert(`Re-seeded "${m.name}" with ${result.totalChunks} chunks`, 'info');
        }
        return;
      }
    }
    console.warn(`[SwarmMesh] File "${fileId}" not found in TorrentSwarm for reseed`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTO RE-SEED — Migrate legacy files to 1 MiB chunk standard
  // ═══════════════════════════════════════════════════════════════════

  private autoReseedLegacyFiles(): void {
    if (!this.torrentSwarmInstance) return;
    const ts = this.torrentSwarmInstance;
    const allManifests = ts.getAllManifests();
    if (allManifests.length === 0) return;

    console.log(`[SwarmMesh] 🔄 Checking ${allManifests.length} file(s) for legacy chunk migration…`);

    let reseedQueue: Array<{ id: string; name: string; currentChunks: number; expectedChunks: number }> = [];

    for (const m of allManifests) {
      const size = (m as unknown as Record<string, unknown>).size as number | undefined;
      if (!size || size <= 0) continue;
      const expectedChunks = Math.max(1, Math.ceil(size / 1_048_576));
      if (m.totalChunks !== expectedChunks) {
        reseedQueue.push({
          id: m.id,
          name: m.name,
          currentChunks: m.totalChunks,
          expectedChunks,
        });
      }
    }

    if (reseedQueue.length === 0) {
      console.log('[SwarmMesh] ✅ All files already use 1 MiB chunk standard');
      return;
    }

    console.log(`[SwarmMesh] 🔄 Auto re-seeding ${reseedQueue.length} legacy file(s)…`);

    // Process sequentially with delays to avoid UI freezing
    const processNext = async (index: number) => {
      if (index >= reseedQueue.length || !this.torrentSwarmInstance) return;
      const item = reseedQueue[index];
      try {
        const result = await this.torrentSwarmInstance.reseed(item.id);
        if (result) {
          console.log(`[SwarmMesh] ✅ Re-seeded "${item.name}": ${item.currentChunks} → ${result.totalChunks} chunks`);
          this.emitAlert(`Auto re-seeded "${item.name}" (${item.currentChunks}→${result.totalChunks} chunks)`, 'info');
        }
      } catch (err) {
        console.warn(`[SwarmMesh] ⚠️ Failed to re-seed "${item.name}":`, err);
      }
      // Small delay between files to keep UI responsive
      setTimeout(() => processNext(index + 1), 500);
    };

    // Start after a 2s delay to let the TorrentSwarm fully initialize
    setTimeout(() => processNext(0), 2000);
  }



  addTransaction(actionType: string, _target: string, meta: Record<string, unknown>): string {
    const txId = `tx-${now()}-${Math.random().toString(36).slice(2, 6)}`;
    console.log(`[SwarmMesh] ⛓️ TX: ${actionType} (${txId})`);
    this.broadcastInternal({ type: 'blockchain-tx', txId, actionType, meta });
    return txId;
  }

  async send(channel: string, peerId: string, payload: unknown): Promise<boolean> {
    const conn = this.connections.get(peerId);
    if (!conn) return false;
    try {
      conn.send(JSON.stringify({ type: `channel:${channel}`, payload, from: this.peerId }));
      return true;
    } catch { return false; }
  }

  broadcast(channel: string, payload: unknown): void {
    for (const peerId of this.getConnectedPeerIds()) {
      void this.send(channel, peerId, payload);
    }
  }

  private channelHandlers = new Map<string, Set<(peerId: string, payload: unknown) => void>>();

  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void {
    if (!this.channelHandlers.has(channel)) this.channelHandlers.set(channel, new Set());
    this.channelHandlers.get(channel)!.add(handler);
    return () => { this.channelHandlers.get(channel)?.delete(handler); };
  }

  // ═══════════════════════════════════════════════════════════════════
  // INDEXEDDB BRIDGE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Broadcast attachment manifest metadata so peers can request chunks on-demand.
   */
  private async broadcastFileDataForPost(manifestIds: string[]): Promise<void> {
    try {
      const db = await this.openDB();
      for (const fileId of manifestIds) {
        if (!db.objectStoreNames.contains('manifests')) continue;
        const manifest = await new Promise<Record<string, unknown> | null>(resolve => {
          const tx = db.transaction('manifests', 'readonly');
          const req = tx.objectStore('manifests').get(fileId);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
        });
        if (!manifest) continue;

        // Broadcast manifest only; peers pull chunks individually to avoid large payload failures.
        this.broadcastInternal({
          type: 'file-manifest',
          manifest,
          fileId,
        });
        console.log(`[SwarmMesh] 📎 Broadcast file manifest ${fileId}`);
      }
      db.close();
    } catch (err) {
      console.warn('[SwarmMesh] Failed to broadcast file manifest:', err);
    }
  }

  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('imagination-db');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async loadPostsFromDB(): Promise<void> {
    try {
      const db = await this.openDB();
      if (!db.objectStoreNames.contains('posts')) { db.close(); return; }
      const tx = db.transaction('posts', 'readonly');
      const req = tx.objectStore('posts').getAll();
      await new Promise<void>((resolve, reject) => {
        req.onsuccess = () => {
          const posts = req.result as Array<{ id: string; author?: string; createdAt?: string; [key: string]: unknown }>;
          let n = 0;
          for (const post of posts) {
            if (!post.id || this.contentStore.has(post.id) || isPostUnsupported(post.id)) continue;
            this.contentStore.set(post.id, {
              id: post.id, type: 'post', data: post,
              author: post.author ?? 'unknown',
              timestamp: post.createdAt ? new Date(post.createdAt).getTime() : Date.now(),
              hash: `${post.id}-${post.createdAt ?? Date.now()}`,
            });
            n++;
          }
          console.log(`[SwarmMesh] 📂 Loaded ${n} posts from IndexedDB`);
          this.emitContentChange();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
      db.close();
    } catch (err) {
      console.warn('[SwarmMesh] DB load error:', err);
    }
  }

  private normalizeBlogFlags(postData: Record<string, unknown>): Record<string, unknown> {
    const normalized = { ...postData };
    const explicit = normalized.blogClassification;
    const explicitIsBlog = explicit === 'blog' || explicit === 'book';
    const content = typeof normalized.content === 'string' ? normalized.content : '';
    const charCount = content.length;
    const hasLinks = /https?:\/\/[^\s]+|www\.[^\s]+/i.test(content);
    const manifestIds = Array.isArray(normalized.manifestIds)
      ? normalized.manifestIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    const type = typeof normalized.type === 'string' ? normalized.type : 'text';
    const hasMedia = manifestIds.length > 0 || type === 'image' || type === 'video' || type === 'file';
    const isBook = explicit === 'book' || charCount >= 250_000;
    const shouldBeBlog = isBook || (charCount >= 1_000 && (hasMedia || hasLinks || charCount >= 3_000));

    if (!explicitIsBlog && !shouldBeBlog) {
      return normalized;
    }

    normalized.blogClassification = isBook ? 'book' : 'blog';
    normalized.blogLocked = true;
    return normalized;
  }

  private async writePostToDB(postData: Record<string, unknown>, sourcePeerId?: string): Promise<void> {
    try {
      if (!postData.id) return;
      // Tombstoned, or its author faded here and we did not favorite it: don't store.
      const lc = await this.attachContentLifecycle();
      if (lc && !(await lc.shouldAcceptIncomingPost(postData as { id?: string; author?: string }))) {
        if (this.contentStore.delete(String(postData.id))) this.emitContentChange();
        return;
      }
      const normalizedPostData = this.normalizeBlogFlags(postData);

      const manifestIds = Array.isArray(normalizedPostData.manifestIds)
        ? normalizedPostData.manifestIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
      if (manifestIds.length > 0) {
        void this.ensurePostAssets(manifestIds, sourcePeerId);
      }

      const db = await this.openDB();
      if (!db.objectStoreNames.contains('posts')) { db.close(); return; }
      const tx = db.transaction('posts', 'readwrite');
      const store = tx.objectStore('posts');
      const existing = await new Promise<unknown>(resolve => {
        const req = store.get(normalizedPostData.id as string);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      const existingRecord = (existing ?? null) as Record<string, unknown> | null;
      const incomingTs = Date.parse(String(normalizedPostData.editedAt ?? normalizedPostData.createdAt ?? '')) || 0;
      const existingTs = existingRecord
        ? Date.parse(String(existingRecord.editedAt ?? existingRecord.createdAt ?? '')) || 0
        : 0;
      const changed = !existingRecord || JSON.stringify(existingRecord) !== JSON.stringify(normalizedPostData);

      if (changed && (incomingTs >= existingTs || !existingRecord)) {
        // BUG-12 FIX: Preserve _origin:'local' — never downgrade a locally-created post
        const mergedData: Record<string, unknown> = existingRecord
          ? { ...normalizedPostData }
          : { ...normalizedPostData, _origin: (normalizedPostData._origin as string) ?? 'synced' };
        if (existingRecord && (existingRecord as Record<string, unknown>)._origin === 'local') {
          mergedData._origin = 'local';
        }
        // BUG-13 FIX: Ensure backwards compatibility for legacy flags
        if (mergedData._origin === undefined) {
          mergedData._origin = 'synced';
        }
        store.put(mergedData);
        console.log(`[SwarmMesh] 💾 Upserted post ${String(mergedData.id)} in IndexedDB (origin=${String(mergedData._origin)})`);
        window.dispatchEvent(new Event('p2p-posts-updated'));

        // Trigger entity voice evaluation for new synced posts
        if (mergedData._origin === 'synced') {
          window.dispatchEvent(new CustomEvent('p2p-entity-voice-evaluate', { detail: mergedData }));
        }

        // If this post carries stream metadata, notify the streaming layer
        // so peers can hydrate the room and show Join controls
        const streamMeta = normalizedPostData.stream as Record<string, unknown> | undefined;
        if (streamMeta && typeof streamMeta === 'object' && streamMeta.roomId) {
          window.dispatchEvent(new CustomEvent('p2p-stream-post-received', { detail: normalizedPostData }));
        }
      }
      db.close();
    } catch (err) {
      console.warn('[SwarmMesh] DB write error:', err);
    }
  }

  private async writeCommentToDB(commentData: Record<string, unknown>): Promise<void> {
    try {
      if (!commentData.id) return;
      // Comments on deleted posts or by deleted accounts stay deleted.
      const lc = await this.attachContentLifecycle();
      if (lc && !(await lc.shouldAcceptIncomingComment(commentData))) {
        if (this.contentStore.delete(String(commentData.id))) this.emitContentChange();
        return;
      }
      const db = await this.openDB();
      if (!db.objectStoreNames.contains('comments')) { db.close(); return; }
      const tx = db.transaction('comments', 'readwrite');
      const store = tx.objectStore('comments');
      const existing = await new Promise<unknown>(resolve => {
        const req = store.get(commentData.id as string);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!existing) {
        store.put(commentData);
        console.log(`[SwarmMesh] 💾 Saved comment ${commentData.id} to IndexedDB`);
        window.dispatchEvent(new Event('p2p-comments-updated'));
      }
      db.close();
    } catch (err) {
      console.warn('[SwarmMesh] Comment DB write error:', err);
    }
  }

  private async writeProjectToDB(projectData: Record<string, unknown>): Promise<void> {
    try {
      const id = projectData.id as string;
      if (!id) return;
      const db = await this.openDB();
      if (!db.objectStoreNames.contains('projects')) { db.close(); return; }
      const tx = db.transaction('projects', 'readwrite');
      const store = tx.objectStore('projects');
      const existing = await new Promise<Record<string, unknown> | null>(resolve => {
        const req = store.get(id);
        req.onsuccess = () => resolve((req.result as Record<string, unknown> | undefined) ?? null);
        req.onerror = () => resolve(null);
      });
      const incomingMeta = projectData.meta as { updatedAt?: string; createdAt?: string } | undefined;
      const existingMeta = existing?.meta as { updatedAt?: string; createdAt?: string } | undefined;
      const incomingTs = Date.parse(String(incomingMeta?.updatedAt ?? incomingMeta?.createdAt ?? '')) || 0;
      const existingTs = existing
        ? Date.parse(String(existingMeta?.updatedAt ?? existingMeta?.createdAt ?? '')) || 0
        : 0;
      if (!existing || incomingTs >= existingTs) {
        const merged = existing ? { ...existing, ...projectData } : projectData;
        store.put(merged);
        console.log(`[SwarmMesh] 💾 Upserted project ${id} in IndexedDB`);
        window.dispatchEvent(new Event('p2p-projects-updated'));
      }
      db.close();
    } catch (err) {
      console.warn('[SwarmMesh] Project DB write error:', err);
    }
  }

  private clearPendingAssetRequests(): void {
    for (const pending of this.pendingAssetRequests.values()) {
      clearTimeout(pending.timeoutId);
      pending.resolve(null);
    }
    this.pendingAssetRequests.clear();
  }

  private clearAssetRetry(manifestId: string): void {
    const timer = this.assetRetryTimers.get(manifestId);
    if (timer) {
      clearTimeout(timer);
      this.assetRetryTimers.delete(manifestId);
    }
    this.assetRetryAttempts.delete(manifestId);
  }

  private clearAssetRetryTimers(): void {
    for (const timer of this.assetRetryTimers.values()) {
      clearTimeout(timer);
    }
    this.assetRetryTimers.clear();
    this.assetRetryAttempts.clear();
    this.pendingAssetQueue.clear();
  }

  private scheduleAssetRetry(manifestId: string, sourcePeerId?: string): void {
    if (this.assetRetryTimers.has(manifestId)) {
      return;
    }

    // Skip if previously exhausted (persisted across refreshes)
    if (getExhaustedRetries().has(manifestId)) {
      return;
    }

    // Soft-retry: while the mesh is offline, park the request instead of
    // burning attempts against dead peers. drainPendingAssetQueue() picks
    // it up as soon as any connection lands.
    if (this.connections.size === 0) {
      if (!this.pendingAssetQueue.has(manifestId)) {
        this.pendingAssetQueue.set(manifestId, sourcePeerId);
      }
      return;
    }

    const attempt = (this.assetRetryAttempts.get(manifestId) ?? 0) + 1;
    if (attempt > ASSET_RETRY_MAX_ATTEMPTS) {
      console.warn(`[SwarmMesh] ⚠️ Exhausted asset retries for ${manifestId}`);
      this.assetRetryAttempts.delete(manifestId);
      markRetryExhausted(manifestId);
      return;
    }

    this.assetRetryAttempts.set(manifestId, attempt);
    const timer = setTimeout(() => {
      this.assetRetryTimers.delete(manifestId);
      // Connection may have dropped while the timer was pending — re-check.
      if (this.connections.size === 0) {
        this.pendingAssetQueue.set(manifestId, sourcePeerId);
        return;
      }
      void this.ensurePostAssets([manifestId], sourcePeerId);
    }, ASSET_RETRY_INTERVAL_MS);
    this.assetRetryTimers.set(manifestId, timer);
  }

  /** Fire parked retries once at least one peer is connected. */
  private drainPendingAssetQueue(): void {
    if (this.pendingAssetQueue.size === 0) return;
    if (this.connections.size === 0) return;
    const drained = Array.from(this.pendingAssetQueue.entries());
    this.pendingAssetQueue.clear();
    for (const [manifestId, sourcePeerId] of drained) {
      this.scheduleAssetRetry(manifestId, sourcePeerId);
    }
  }

  private createAssetRequestId(): string {
    return `asset-${now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private getAssetCandidatePeers(sourcePeerId?: string): string[] {
    const ordered: string[] = [];
    if (sourcePeerId && this.connections.has(sourcePeerId)) {
      ordered.push(sourcePeerId);
    }
    for (const peerId of this.connections.keys()) {
      if (!ordered.includes(peerId)) {
        ordered.push(peerId);
      }
    }
    return ordered;
  }

  private async sendAssetRequest(
    peerId: string,
    payload: Record<string, unknown>,
    expectedType: PendingAssetRequest['expectedType']
  ): Promise<Record<string, unknown> | null> {
    const conn = this.connections.get(peerId);
    if (!conn || conn.open !== true) {
      return null;
    }

    const requestId = this.createAssetRequestId();
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        const pending = this.pendingAssetRequests.get(requestId);
        if (!pending) {
          return;
        }
        this.pendingAssetRequests.delete(requestId);
        pending.resolve(null);
      }, ASSET_REQUEST_TIMEOUT_MS);

      this.pendingAssetRequests.set(requestId, {
        resolve,
        timeoutId,
        expectedType,
      });

      try {
        conn.send(JSON.stringify({
          ...payload,
          requestId,
          from: this.peerId,
        }));
      } catch {
        clearTimeout(timeoutId);
        this.pendingAssetRequests.delete(requestId);
        resolve(null);
      }
    });
  }

  private resolveAssetRequest(message: Record<string, unknown>): void {
    const requestId = typeof message.requestId === 'string' ? message.requestId : null;
    const type = typeof message.type === 'string' ? message.type : null;
    if (!requestId || !type) {
      return;
    }

    const pending = this.pendingAssetRequests.get(requestId);
    if (!pending || pending.expectedType !== type) {
      return;
    }

    clearTimeout(pending.timeoutId);
    this.pendingAssetRequests.delete(requestId);
    pending.resolve(message);
  }

  private async getManifestFromDB(fileId: string): Promise<StoredManifestLike | null> {
    const db = await this.openDB();
    try {
      if (!db.objectStoreNames.contains('manifests')) {
        return null;
      }
      return await new Promise<StoredManifestLike | null>((resolve) => {
        const tx = db.transaction('manifests', 'readonly');
        const req = tx.objectStore('manifests').get(fileId);
        req.onsuccess = () => resolve((req.result as StoredManifestLike | null) ?? null);
        req.onerror = () => resolve(null);
      });
    } finally {
      db.close();
    }
  }

  private async saveManifestToDB(manifest: StoredManifestLike): Promise<boolean> {
    const fileId = typeof manifest.fileId === 'string' ? manifest.fileId : null;
    if (!fileId) {
      return false;
    }

    const db = await this.openDB();
    try {
      if (!db.objectStoreNames.contains('manifests')) {
        return false;
      }

      const existing = await new Promise<StoredManifestLike | null>((resolve) => {
        const tx = db.transaction('manifests', 'readonly');
        const req = tx.objectStore('manifests').get(fileId);
        req.onsuccess = () => resolve((req.result as StoredManifestLike | null) ?? null);
        req.onerror = () => resolve(null);
      });

      const shouldWrite = !existing || (!existing.fileKey && Boolean(manifest.fileKey));
      if (!shouldWrite) {
        return false;
      }

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('manifests', 'readwrite');
        tx.objectStore('manifests').put(manifest);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } finally {
      db.close();
    }
  }

  private async getChunkFromDB(chunkRef: string): Promise<StoredChunkLike | null> {
    const db = await this.openDB();
    try {
      if (!db.objectStoreNames.contains('chunks')) {
        return null;
      }
      return await new Promise<StoredChunkLike | null>((resolve) => {
        const tx = db.transaction('chunks', 'readonly');
        const req = tx.objectStore('chunks').get(chunkRef);
        req.onsuccess = () => resolve((req.result as StoredChunkLike | null) ?? null);
        req.onerror = () => resolve(null);
      });
    } finally {
      db.close();
    }
  }

  private async saveChunkToDB(chunk: StoredChunkLike): Promise<boolean> {
    const chunkRef = typeof chunk.ref === 'string' ? chunk.ref : null;
    if (!chunkRef) {
      return false;
    }

    const db = await this.openDB();
    try {
      if (!db.objectStoreNames.contains('chunks')) {
        return false;
      }

      const existing = await new Promise<StoredChunkLike | null>((resolve) => {
        const tx = db.transaction('chunks', 'readonly');
        const req = tx.objectStore('chunks').get(chunkRef);
        req.onsuccess = () => resolve((req.result as StoredChunkLike | null) ?? null);
        req.onerror = () => resolve(null);
      });

      if (existing) {
        return false;
      }

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('chunks', 'readwrite');
        tx.objectStore('chunks').put(chunk);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } finally {
      db.close();
    }
  }

  private async requestManifestFromPeers(manifestId: string, sourcePeerId?: string): Promise<StoredManifestLike | null> {
    const candidates = this.getAssetCandidatePeers(sourcePeerId);
    for (const peerId of candidates) {
      const response = await this.sendAssetRequest(
        peerId,
        { type: 'manifest-request', manifestId },
        'manifest-response',
      );

      if (!response || response.found !== true) {
        continue;
      }

      const manifest = response.manifest as StoredManifestLike | undefined;
      if (manifest && typeof manifest.fileId === 'string') {
        return manifest;
      }
    }

    return null;
  }

  private async requestChunkFromPeers(chunkRef: string, sourcePeerId?: string): Promise<StoredChunkLike | null> {
    const candidates = this.getAssetCandidatePeers(sourcePeerId);
    for (const peerId of candidates) {
      const response = await this.sendAssetRequest(
        peerId,
        { type: 'chunk-request', chunkRef },
        'chunk-response',
      );

      if (!response || response.found !== true) {
        continue;
      }

      const chunk = response.chunk as StoredChunkLike | undefined;
      if (chunk && typeof chunk.ref === 'string') {
        return chunk;
      }
    }

    return null;
  }

  public async ensureManifestAndChunks(
    manifestId: string,
    sourcePeerId?: string
  ): Promise<{ changed: boolean; complete: boolean }> {
    // Respect user file preferences
    if (this.isFileBlocked(manifestId)) {
      return { changed: false, complete: false };
    }

    let changed = false;
    let manifest = await this.getManifestFromDB(manifestId);
    let complete = true;

    if (!manifest) {
      const fetchedManifest = await this.requestManifestFromPeers(manifestId, sourcePeerId);
      if (!fetchedManifest) {
        return { changed: false, complete: false };
      }

      manifest = fetchedManifest;
      changed = (await this.saveManifestToDB(fetchedManifest)) || changed;
      console.log(`[SwarmMesh] 📎 Pulled missing manifest ${manifestId}`);
      this._assetSyncCounters.manifestsPulled++;
    }

    const chunkRefs = Array.isArray(manifest.chunks)
      ? manifest.chunks.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
      : [];

    for (const chunkRef of chunkRefs) {
      const existingChunk = await this.getChunkFromDB(chunkRef);
      if (existingChunk) {
        continue;
      }

      const fetchedChunk = await this.requestChunkFromPeers(chunkRef, sourcePeerId);
      if (!fetchedChunk) {
        complete = false;
        continue;
      }

      const saved = await this.saveChunkToDB(fetchedChunk);
      changed = saved || changed;
      if (saved) {
        console.log(`[SwarmMesh] 📦 Pulled missing chunk ${chunkRef}`);
        this._assetSyncCounters.chunksPulled++;
        // Emit incremental progress every few chunks
        if (this._assetSyncCounters.chunksPulled % 3 === 0) {
          void this.emitTransferProgress(manifestId);
        }
      }
    }

    return { changed, complete };
  }

  private async ensurePostAssets(manifestIds: string[], sourcePeerId?: string): Promise<void> {
    let changed = false;

    // Filter out manifests that have exhausted retries across refreshes
    const exhausted = getExhaustedRetries();
    const eligible = manifestIds.filter(id => !exhausted.has(id));
    if (eligible.length === 0) return;

    // Skip manifests we already have complete locally (self-seeded)
    const needsSync: string[] = [];
    for (const id of eligible) {
      const selfSeeded = this.fileSeeders.get(id)?.has(this.peerId);
      if (selfSeeded) {
        // Already complete — no need to fetch or retry
        this.clearAssetRetry(id);
        continue;
      }
      needsSync.push(id);
    }

    if (needsSync.length === 0) return;

    // Sort by priority: starred first, then smallest size first
    const prioritized = await this.prioritizeManifests(needsSync);

    for (const manifestId of prioritized) {
      const result = await this.ensureManifestAndChunks(manifestId, sourcePeerId);
      changed = result.changed || changed;

      if (result.complete) {
        this.clearAssetRetry(manifestId);
        clearRetryExhausted(manifestId);
        this.announceSeeding(manifestId);
      } else {
        this.scheduleAssetRetry(manifestId, sourcePeerId);
      }

      // Dispatch progress event for UI
      this.emitTransferProgress(manifestId);
    }

    if (changed && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('p2p-posts-updated'));
    }
  }

  /**
   * Sort manifest IDs by priority:
   *   1. Host-first starred item (only one allowed)
   *   2. Smallest file size first
   */
  private async prioritizeManifests(manifestIds: string[]): Promise<string[]> {
    if (manifestIds.length <= 1) return manifestIds;

    const entries: { id: string; starred: boolean; size: number }[] = [];
    for (const id of manifestIds) {
      const pref = this.getFilePref(id);
      let size = Infinity;
      try {
        const manifest = await this.getManifestFromDB(id);
        if (manifest && typeof (manifest as Record<string, unknown>).size === 'number') {
          size = (manifest as Record<string, unknown>).size as number;
        }
      } catch { /* noop */ }
      entries.push({ id, starred: pref.hostFirst, size });
    }

    entries.sort((a, b) => {
      // Starred items always first
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      // Then smaller files first
      return a.size - b.size;
    });

    return entries.map(e => e.id);
  }

  /**
   * Once a file is fully downloaded, announce to all peers
   * that we can now seed it — enabling auto-seeding.
   */
  private announceSeeding(manifestId: string): void {
    if (isManifestUnsupported(manifestId)) return;
    // Track ourselves as a seeder
    if (!this.fileSeeders.has(manifestId)) {
      this.fileSeeders.set(manifestId, new Set());
    }
    this.fileSeeders.get(manifestId)!.add(this.peerId);

    this.broadcastInternal({
      type: 'seeding-available',
      manifestId,
      peerId: this.peerId,
    });
  }

  /**
   * Emit a content-transfer-progress event for UI components (e.g. stream cards).
   */
  private async emitTransferProgress(manifestId: string): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      const manifest = await this.getManifestFromDB(manifestId);
      if (!manifest) return;
      const chunkRefs = Array.isArray(manifest.chunks)
        ? manifest.chunks.filter((r): r is string => typeof r === 'string')
        : [];
      const total = chunkRefs.length;
      if (total === 0) return;

      let received = 0;
      const db = await this.openDB();
      if (db.objectStoreNames.contains('chunks')) {
        const existingKeys = await new Promise<Set<string>>((resolve) => {
          const tx = db.transaction('chunks', 'readonly');
          const req = tx.objectStore('chunks').getAllKeys();
          req.onsuccess = () => {
            const s = new Set<string>();
            for (const k of (req.result ?? [])) {
              if (typeof k === 'string') s.add(k);
            }
            resolve(s);
          };
          req.onerror = () => resolve(new Set());
        });
        received = chunkRefs.filter(r => existingKeys.has(r)).length;
      }
      db.close();

      const mRec = manifest as Record<string, unknown>;
      window.dispatchEvent(new CustomEvent('content-transfer-progress', {
        detail: {
          manifestId,
          fileName: (mRec.originalName as string) ?? manifestId.slice(0, 12),
          mime: (mRec.mime as string) ?? 'unknown',
          totalChunks: total,
          receivedChunks: received,
          percent: Math.round((received / total) * 100),
          size: typeof mRec.size === 'number' ? mRec.size : 0,
          complete: received >= total,
        },
      }));
    } catch { /* noop */ }
  }

  private async handleFileManifest(fromPeerId: string, msg: Record<string, unknown>): Promise<void> {
    const incomingManifest = msg.manifest as StoredManifestLike | undefined;
    const fileIdFromMessage = typeof msg.fileId === 'string' ? msg.fileId : null;
    const manifestFileId = typeof incomingManifest?.fileId === 'string' ? incomingManifest.fileId : null;
    const fileId = fileIdFromMessage ?? manifestFileId;

    if (!incomingManifest || !fileId) {
      return;
    }

    const normalizedManifest: StoredManifestLike = {
      ...incomingManifest,
      fileId,
    };
    const saved = await this.saveManifestToDB(normalizedManifest);
    if (saved) {
      console.log(`[SwarmMesh] 📎 Received manifest ${fileId} from ${fromPeerId}`);
    }

    void this.ensurePostAssets([fileId], fromPeerId);
  }

  private async handleManifestRequest(fromPeerId: string, msg: Record<string, unknown>): Promise<void> {
    const requestId = typeof msg.requestId === 'string' ? msg.requestId : null;
    const manifestId = typeof msg.manifestId === 'string' ? msg.manifestId : null;
    if (!requestId || !manifestId) {
      return;
    }

    const manifest = isManifestUnsupported(manifestId) ? null : await this.getManifestFromDB(manifestId);
    const conn = this.connections.get(fromPeerId);
    if (!conn) {
      return;
    }

    try {
      conn.send(JSON.stringify({
        type: 'manifest-response',
        requestId,
        manifestId,
        found: Boolean(manifest),
        manifest: manifest ?? undefined,
        from: this.peerId,
      }));
    } catch {
      // noop
    }
  }

  private async handleChunkRequest(fromPeerId: string, msg: Record<string, unknown>): Promise<void> {
    const requestId = typeof msg.requestId === 'string' ? msg.requestId : null;
    const chunkRef = typeof msg.chunkRef === 'string' ? msg.chunkRef : null;
    if (!requestId || !chunkRef) {
      return;
    }

    const chunk = isChunkUnsupported(chunkRef) ? null : await this.getChunkFromDB(chunkRef);
    const conn = this.connections.get(fromPeerId);
    if (!conn) {
      return;
    }

    try {
      const found = Boolean(chunk);
      conn.send(JSON.stringify({
        type: 'chunk-response',
        requestId,
        chunkRef,
        found,
        chunk: chunk ?? undefined,
        from: this.peerId,
      }));
      if (found) this._assetSyncCounters.chunksServed++;
    } catch {
      // noop
    }
  }

  /**
   * Handle a peer announcing they finished downloading a file and can now seed it.
   * We can request missing chunks from them.
   */
  private handleSeedingAvailable(fromPeerId: string, msg: Record<string, unknown>): void {
    const manifestId = typeof msg.manifestId === 'string' ? msg.manifestId : null;
    if (!manifestId) return;
    if (this.isFileBlocked(manifestId)) return;

    // Track this peer as a seeder for this file
    if (!this.fileSeeders.has(manifestId)) {
      this.fileSeeders.set(manifestId, new Set());
    }
    this.fileSeeders.get(manifestId)!.add(fromPeerId);

    // If we have an incomplete copy, try to pull from this new seeder
    void this.ensureManifestAndChunks(manifestId, fromPeerId).then(({ complete, changed }) => {
      if (complete) {
        this.clearAssetRetry(manifestId);
        // We are also a seeder now (local)
        this.fileSeeders.get(manifestId)?.add(this.peerId);
      }
      if (changed && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('p2p-posts-updated'));
      }
    });
  }

  /**
   * Get the number of known seeders for a file (peers that have announced seeding).
   * Includes self if we have the complete file.
   */
  getFileSeederCount(manifestId: string): number {
    const seeders = this.fileSeeders.get(manifestId);
    if (!seeders) return 0;
    // Filter to only currently connected peers + self
    let count = 0;
    for (const peerId of seeders) {
      if (peerId === this.peerId || this.connections.has(peerId)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get seeder counts for all tracked files.
   */
  getAllFileSeederCounts(): Map<string, number> {
    const result = new Map<string, number>();
    for (const [manifestId] of this.fileSeeders) {
      result.set(manifestId, this.getFileSeederCount(manifestId));
    }
    return result;
  }

  /**
   * Handle incoming file data (manifest + chunks) from a peer.
   */
  private async handleFileData(msg: Record<string, unknown>): Promise<void> {
    try {
      const manifest = msg.manifest as Record<string, unknown> | undefined;
      const chunks = msg.chunks as Record<string, unknown>[] | undefined;
      const fileId = msg.fileId as string | undefined;
      if (!manifest || !fileId) return;

      const db = await this.openDB();

      // Write manifest to IndexedDB
      if (db.objectStoreNames.contains('manifests')) {
        const existing = await new Promise<unknown>(resolve => {
          const tx = db.transaction('manifests', 'readonly');
          const req = tx.objectStore('manifests').get(fileId);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        });

        // Only write if manifest doesn't exist or existing one lacks fileKey
        const existingManifest = existing as Record<string, unknown> | null;
        if (!existingManifest || !existingManifest.fileKey) {
          const tx = db.transaction('manifests', 'readwrite');
          tx.objectStore('manifests').put(manifest);
          console.log(`[SwarmMesh] 📎 Saved manifest ${fileId}`);
        }
      }

      // Write chunks to IndexedDB
      if (Array.isArray(chunks) && chunks.length > 0 && db.objectStoreNames.contains('chunks')) {
        const tx = db.transaction('chunks', 'readwrite');
        const store = tx.objectStore('chunks');
        for (const chunk of chunks) {
          if (chunk.ref) {
            store.put(chunk);
          }
        }
        console.log(`[SwarmMesh] 📎 Saved ${chunks.length} chunks for ${fileId}`);
      }

      db.close();

      // Notify UI to re-attempt loading attachments
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('p2p-posts-updated'));
      }
    } catch (err) {
      console.warn('[SwarmMesh] File data handling error:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════════════

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════════

let _instance: StandaloneSwarmMesh | null = null;

export function getSwarmMeshStandalone(): StandaloneSwarmMesh {
  if (!_instance) _instance = new StandaloneSwarmMesh();
  return _instance;
}

export function destroySwarmMeshStandalone(): void {
  _instance?.stop();
  _instance = null;
}
