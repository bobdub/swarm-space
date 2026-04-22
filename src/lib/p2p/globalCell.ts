/**
 * ═══════════════════════════════════════════════════════════════════════
 * GLOBAL CELL — Gun.js Presence Registry & Global Discovery
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Provides a global discovery channel so peers can find each other even
 * without shared library entries or same-page room discovery.
 *
 * Uses two channels:
 *   1. Gun.js graph — writes presence beacons to `swarm-space/presence`
 *   2. BroadcastChannel — fallback for same-origin tab discovery
 *
 * Emits discovered peers via a `global-cell-peers` BroadcastChannel
 * that the SwarmMesh subscribes to for auto-import.
 *
 * Design principles:
 *   - Fully standalone — reads the mesh singleton but owns no state in it
 *   - No PeerJS instances — avoids ID collisions
 *   - Gun.js adapter is imported dynamically (already a dependency)
 *   - Graceful degradation: if Gun.js fails, BroadcastChannel still works
 * ═══════════════════════════════════════════════════════════════════════
 */

import { getSwarmMeshStandalone } from './swarmMesh.standalone';
import { recordP2PDiagnostic } from './diagnostics';

// ── Shared Constants (exported so SwarmMesh uses the same values) ──────

/** Beacon announcement interval in ms (steady state, mesh at target) */
export const GLOBAL_CELL_BEACON_INTERVAL = 45_000;

/** Faster beacon interval used while the mesh is under-connected */
export const GLOBAL_CELL_FAST_BEACON_INTERVAL = 8_000;

/** Emergency beacon interval used when severely under-connected (ratio < 0.30) */
export const GLOBAL_CELL_EMERGENCY_BEACON_INTERVAL = 3_000;

/** Peers not seen within this window are considered stale / offline */
export const GLOBAL_CELL_STALE_THRESHOLD = 75_000;

// ── Internal Constants ────────────────────────────────────────────────

const LOG = '[GlobalCell]';
const PRUNE_INTERVAL = 15_000;
const UNDER_CONNECTED_PRESENCE_INTERVAL = 6_000;
const UNDER_CONNECTED_TARGET_CONNECTIONS = 20;
/** Severe under-connection threshold — ratio < 0.30 triggers escalation */
const EMERGENCY_PEER_THRESHOLD = 6;
/** Tighter reachability pulse cadence under emergency conditions */
const EMERGENCY_PRESENCE_INTERVAL = 2_500;
const ONLINE_READINESS_POLL_MS = 500;
const GUN_GRAPH_KEY = 'swarm-space/presence';
const BC_EMIT_CHANNEL = 'global-cell-peers';
const BC_BEACON_CHANNEL = 'global-cell-beacon';
const DEFAULT_GUN_RELAY_PEERS = [
  'https://gun-manhattan.herokuapp.com/gun',
  'https://gun-us.herokuapp.com/gun',
  'https://gun-eu.herokuapp.com/gun',
];

// ── Types ──────────────────────────────────────────────────────────────

interface PresenceBeacon {
  peerId: string;
  trustScore: number;
  ts: number;
}

interface GlobalCellPeerEvent {
  type: 'discovered';
  peers: Array<{ peerId: string; trustScore: number; lastSeenAt: number }>;
}

// ── Singleton ──────────────────────────────────────────────────────────

let instance: GlobalCell | null = null;

export function getGlobalCell(): GlobalCell {
  if (!instance) instance = new GlobalCell();
  return instance;
}

// ── Global Cell Class ──────────────────────────────────────────────────

class GlobalCell {
  private running = false;
  private beaconTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private discoveryPulseTimer: ReturnType<typeof setInterval> | null = null;
  private readinessTimer: ReturnType<typeof setInterval> | null = null;
  private knownPresence = new Map<string, PresenceBeacon>();
  private emitChannel: BroadcastChannel | null = null;
  private beaconChannel: BroadcastChannel | null = null;
  private gunAdapter: any = null;
  private localPeerId: string | null = null;
  private lastBeaconAt = 0;
  private currentBeaconInterval = GLOBAL_CELL_BEACON_INTERVAL;

  start(): void {
    if (this.running) return;
    this.running = true;

    const mesh = getSwarmMeshStandalone();
    this.localPeerId = mesh.getPeerId();

    console.log(`${LOG} 🌐 Starting global presence registry (peerId=${this.localPeerId?.slice(0, 16)}, beacon=${GLOBAL_CELL_BEACON_INTERVAL / 1000}s, stale=${GLOBAL_CELL_STALE_THRESHOLD / 1000}s)`);

    // Set up BroadcastChannels
    try {
      this.emitChannel = new BroadcastChannel(BC_EMIT_CHANNEL);
      this.beaconChannel = new BroadcastChannel(BC_BEACON_CHANNEL);
      this.beaconChannel.onmessage = (ev: MessageEvent) => this.handleBeaconMessage(ev.data);
    } catch {
      console.warn(`${LOG} BroadcastChannel unavailable`);
    }

    // Start Gun.js presence (async, non-blocking)
    void this.initGun();

    // Start beacon loop (actual announce waits until mesh is online)
    this.announcePresence();
    this.currentBeaconInterval = GLOBAL_CELL_FAST_BEACON_INTERVAL;
    this.beaconTimer = setInterval(() => {
      this.announcePresence();
      this.adjustBeaconCadence();
    }, this.currentBeaconInterval);
    this.pruneTimer = setInterval(() => this.pruneAndEmit(), PRUNE_INTERVAL);
    this.discoveryPulseTimer = setInterval(() => this.maintainReachabilityPulse(), UNDER_CONNECTED_PRESENCE_INTERVAL);
    this.scheduleOnlinePresenceRetry();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.beaconTimer) { clearInterval(this.beaconTimer); this.beaconTimer = null; }
    if (this.pruneTimer) { clearInterval(this.pruneTimer); this.pruneTimer = null; }
    if (this.discoveryPulseTimer) { clearInterval(this.discoveryPulseTimer); this.discoveryPulseTimer = null; }
    if (this.readinessTimer) { clearInterval(this.readinessTimer); this.readinessTimer = null; }
    this.emitChannel?.close();
    this.emitChannel = null;
    this.beaconChannel?.close();
    this.beaconChannel = null;

    if (this.gunAdapter) {
      try { this.gunAdapter.stop(); } catch { /* ignore */ }
      this.gunAdapter = null;
    }

    this.knownPresence.clear();
    this.lastBeaconAt = 0;
    console.log(`${LOG} 🛑 Stopped`);
  }

  // ── Countdown Helper ──────────────────────────────────────────────

  /**
   * Returns the number of milliseconds until the next beacon announcement.
   * Returns 0 if no beacon has been sent yet.
   */
  getNextBeaconInMs(): number {
    if (this.lastBeaconAt === 0 || !this.running) return 0;
    const elapsed = Date.now() - this.lastBeaconAt;
    return Math.max(0, this.currentBeaconInterval - elapsed);
  }

  /**
   * Returns the number of seconds (rounded) until the next beacon.
   */
  getNextBeaconInSeconds(): number {
    return Math.ceil(this.getNextBeaconInMs() / 1000);
  }

  isRunning(): boolean {
    return this.running;
  }

  getKnownPeersCount(): number {
    return this.knownPresence.size;
  }

  /**
   * Return all currently-known (non-stale) peers so SwarmMesh can
   * seed its first cascade without waiting for a BroadcastChannel emit.
   */
  getKnownPeers(): Array<{ peerId: string; trustScore: number; lastSeenAt: number }> {
    const cutoff = Date.now() - GLOBAL_CELL_STALE_THRESHOLD;
    const result: Array<{ peerId: string; trustScore: number; lastSeenAt: number }> = [];
    for (const [, beacon] of this.knownPresence) {
      if (beacon.ts >= cutoff) {
        result.push({ peerId: beacon.peerId, trustScore: beacon.trustScore, lastSeenAt: beacon.ts });
      }
    }
    return result;
  }

  pulsePresence(reason = 'manual-pulse'): void {
    if (!this.running) return;
    console.log(`${LOG} 📣 Presence pulse requested (${reason})`);
    this.announcePresence();
  }

  private maintainReachabilityPulse(): void {
    if (!this.running) return;

    const mesh = getSwarmMeshStandalone();
    const stats = mesh.getStats();
    if (stats.phase !== 'online') return;
    if (stats.connectedPeers >= UNDER_CONNECTED_TARGET_CONNECTIONS) return;
    if (Date.now() - this.lastBeaconAt < UNDER_CONNECTED_PRESENCE_INTERVAL) return;

    console.log(
      `${LOG} 🔁 Under-connected reachability pulse ` +
      `(peers=${stats.connectedPeers}/${UNDER_CONNECTED_TARGET_CONNECTIONS})`
    );
    this.announcePresence();

    // Re-scan registry: re-emit known peers so the mesh runs an expansion
    // pass against any cached-but-unreached peer (covers cases where no new
    // Gun event arrived but a cooldown has elapsed).
    const known = this.getKnownPeers();
    if (known.length > 0) {
      const event: GlobalCellPeerEvent = { type: 'discovered', peers: known };
      try { this.emitChannel?.postMessage(event); } catch { /* ignore */ }
      console.log(`${LOG} 🔄 Re-emitted ${known.length} known peer(s) for expansion retry`);
    }
  }

  /**
   * Adapt the beacon cadence: fast (8s) while under-connected, slow (45s)
   * once the mesh has reached its target. Restarts the timer when the
   * cadence flips so we don't have to wait for the current tick to finish.
   */
  private adjustBeaconCadence(): void {
    if (!this.running) return;
    const mesh = getSwarmMeshStandalone();
    const stats = mesh.getStats();
    const desired = stats.connectedPeers >= UNDER_CONNECTED_TARGET_CONNECTIONS
      ? GLOBAL_CELL_BEACON_INTERVAL
      : GLOBAL_CELL_FAST_BEACON_INTERVAL;
    if (desired === this.currentBeaconInterval) return;

    this.currentBeaconInterval = desired;
    if (this.beaconTimer) clearInterval(this.beaconTimer);
    this.beaconTimer = setInterval(() => {
      this.announcePresence();
      this.adjustBeaconCadence();
    }, this.currentBeaconInterval);
    console.log(`${LOG} ⏱️ Beacon cadence -> ${this.currentBeaconInterval / 1000}s`);
  }

  // ── Gun.js Init ────────────────────────────────────────────────────

  private async initGun(): Promise<void> {
    try {
      const { GunAdapter } = await import('./transports/gunAdapter');
      this.gunAdapter = new GunAdapter({
        peers: DEFAULT_GUN_RELAY_PEERS,
        graphKey: GUN_GRAPH_KEY,
        channelName: 'global-cell-gun',
        registryMode: true,
      });
      await this.gunAdapter.start({ peerId: this.localPeerId! });

      // Listen for presence messages via Gun
      this.gunAdapter.onMessage('presence', (_fromPeerId: string, payload: unknown) => {
        const beacon = payload as PresenceBeacon;
        if (beacon && beacon.peerId && beacon.peerId !== this.localPeerId) {
          this.recordPresence(beacon);
        }
      });

      console.log(`${LOG} ✅ Gun.js presence registry active`);
      this.announcePresence();
      this.scheduleOnlinePresenceRetry();
    } catch (err) {
      console.warn(`${LOG} Gun.js unavailable — using BroadcastChannel only`, err);
    }
  }

  private isMeshOnline(): boolean {
    try {
      return getSwarmMeshStandalone().getStats().phase === 'online';
    } catch {
      return false;
    }
  }

  private scheduleOnlinePresenceRetry(): void {
    if (this.readinessTimer || !this.running) return;

    if (this.isMeshOnline()) {
      this.announcePresence();
      return;
    }

    this.readinessTimer = setInterval(() => {
      if (!this.running) {
        if (this.readinessTimer) {
          clearInterval(this.readinessTimer);
          this.readinessTimer = null;
        }
        return;
      }

      if (!this.isMeshOnline()) return;

      if (this.readinessTimer) {
        clearInterval(this.readinessTimer);
        this.readinessTimer = null;
      }

      console.log(`${LOG} ⚡ Mesh is online — announcing reachability now`);
      this.announcePresence();
    }, ONLINE_READINESS_POLL_MS);
  }

  // ── Announce Presence ──────────────────────────────────────────────

  private announcePresence(): void {
    const mesh = getSwarmMeshStandalone();
    this.localPeerId = mesh.getPeerId();
    if (!this.localPeerId) return;

    if (mesh.getStats().phase !== 'online') {
      this.scheduleOnlinePresenceRetry();
      return;
    }

    const trustScore = this.computeLocalTrustScore(mesh);

    const beacon: PresenceBeacon = {
      peerId: this.localPeerId,
      trustScore,
      ts: Date.now(),
    };

    this.lastBeaconAt = Date.now();

    // Broadcast via BroadcastChannel (same-origin tabs)
    try {
      this.beaconChannel?.postMessage(beacon);
    } catch { /* ignore */ }

    // Broadcast via Gun.js (cross-device)
    if (this.gunAdapter) {
      try {
        this.gunAdapter.broadcastToAll('presence', beacon);
      } catch { /* ignore */ }
    }

    recordP2PDiagnostic({
      level: 'info',
      source: 'bootstrap',
      code: 'cell-beacon-announce',
      message: `Beacon announced (trust=${trustScore.toFixed(2)}, known=${this.knownPresence.size})`,
      context: { trustScore, knownPeers: this.knownPresence.size },
    });
  }

  // ── Compute Local Trust Score ──────────────────────────────────────

  private computeLocalTrustScore(mesh: ReturnType<typeof getSwarmMeshStandalone>): number {
    const stats = mesh.getMiningStats();
    if (!stats) return 0.3;

    const { confirmedBlocks, blocksMinedTotal, chunksServed, peersDiscovered } = stats;

    const miningRatio = blocksMinedTotal > 0
      ? confirmedBlocks / blocksMinedTotal
      : 0;

    const contentRatio = Math.min(1.0,
      peersDiscovered > 0 ? chunksServed / peersDiscovered : 0
    );

    const score = 0.6 * miningRatio + 0.4 * contentRatio;

    if (blocksMinedTotal === 0 && chunksServed === 0) return 0.3;

    return Math.max(0, Math.min(1, score));
  }

  // ── Handle Incoming Beacons ────────────────────────────────────────

  private handleBeaconMessage(data: unknown): void {
    const beacon = data as PresenceBeacon;
    if (!beacon || !beacon.peerId || beacon.peerId === this.localPeerId) return;
    this.recordPresence(beacon);
  }

  private recordPresence(beacon: PresenceBeacon): void {
    const existing = this.knownPresence.get(beacon.peerId);
    // Only update if newer
    if (existing && existing.ts >= beacon.ts) return;

    const isNew = !existing;
    this.knownPresence.set(beacon.peerId, beacon);

    recordP2PDiagnostic({
      level: 'info',
      source: 'bootstrap',
      code: isNew ? 'cell-beacon-new-peer' : 'cell-beacon-update',
      message: isNew
        ? `New peer discovered: ${beacon.peerId.slice(0, 16)} (trust=${beacon.trustScore.toFixed(2)})`
        : `Beacon update: ${beacon.peerId.slice(0, 16)} (trust=${beacon.trustScore.toFixed(2)})`,
      context: { peerId: beacon.peerId, trustScore: beacon.trustScore, isNew },
    });

    const event: GlobalCellPeerEvent = {
      type: 'discovered',
      peers: [{ peerId: beacon.peerId, trustScore: beacon.trustScore, lastSeenAt: beacon.ts }],
    };
    try {
      this.emitChannel?.postMessage(event);
    } catch { /* ignore */ }
    console.log(
      `${LOG} ⚡ Immediate emit for ${isNew ? 'new peer' : 'peer update'} ${beacon.peerId.slice(0, 16)}`
    );
  }

  // ── Prune & Emit ──────────────────────────────────────────────────

  private pruneAndEmit(): void {
    const cutoff = Date.now() - GLOBAL_CELL_STALE_THRESHOLD;
    const livePeers: GlobalCellPeerEvent['peers'] = [];

    for (const [peerId, beacon] of this.knownPresence) {
      if (beacon.ts < cutoff) {
        this.knownPresence.delete(peerId);
        continue;
      }
      livePeers.push({
        peerId: beacon.peerId,
        trustScore: beacon.trustScore,
        lastSeenAt: beacon.ts,
      });
    }

    if (livePeers.length === 0) return;

    // Emit to SwarmMesh via BroadcastChannel
    const event: GlobalCellPeerEvent = { type: 'discovered', peers: livePeers };
    try {
      this.emitChannel?.postMessage(event);
    } catch { /* ignore */ }

    console.log(`${LOG} 📡 Emitting ${livePeers.length} live peer(s) from global presence`);
  }
}
