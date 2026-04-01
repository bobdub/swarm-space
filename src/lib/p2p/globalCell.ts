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

// ── Constants ──────────────────────────────────────────────────────────

const LOG = '[GlobalCell]';
const BEACON_INTERVAL = 120_000;     // 2 minutes — announce presence
const STALE_THRESHOLD = 300_000;     // 5 minutes — prune stale peers
const PRUNE_INTERVAL = 60_000;       // 1 minute — run prune cycle
const GUN_GRAPH_KEY = 'swarm-space/presence';
const BC_EMIT_CHANNEL = 'global-cell-peers';
const BC_BEACON_CHANNEL = 'global-cell-beacon';

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
  private knownPresence = new Map<string, PresenceBeacon>();
  private emitChannel: BroadcastChannel | null = null;
  private beaconChannel: BroadcastChannel | null = null;
  private gunAdapter: any = null; // GunAdapter instance (dynamically loaded)
  private localPeerId: string | null = null;

  start(): void {
    if (this.running) return;
    this.running = true;

    const mesh = getSwarmMeshStandalone();
    this.localPeerId = mesh.getPeerId();

    console.log(`${LOG} 🌐 Starting global presence registry (peerId=${this.localPeerId?.slice(0, 16)})`);

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

    // Start beacon loop
    this.announcePresence();
    this.beaconTimer = setInterval(() => this.announcePresence(), BEACON_INTERVAL);
    this.pruneTimer = setInterval(() => this.pruneAndEmit(), PRUNE_INTERVAL);

    // Always announce the network entity as a member of the global cell
    this.announceEntityPresence();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.beaconTimer) { clearInterval(this.beaconTimer); this.beaconTimer = null; }
    if (this.pruneTimer) { clearInterval(this.pruneTimer); this.pruneTimer = null; }
    this.emitChannel?.close();
    this.emitChannel = null;
    this.beaconChannel?.close();
    this.beaconChannel = null;

    if (this.gunAdapter) {
      try { this.gunAdapter.stop(); } catch { /* ignore */ }
      this.gunAdapter = null;
    }

    this.knownPresence.clear();
    console.log(`${LOG} 🛑 Stopped`);
  }

  // ── Gun.js Init ────────────────────────────────────────────────────

  private async initGun(): Promise<void> {
    try {
      const { GunAdapter } = await import('./transports/gunAdapter');
      this.gunAdapter = new GunAdapter({
        graphKey: GUN_GRAPH_KEY,
        channelName: 'global-cell-gun',
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
    } catch (err) {
      console.warn(`${LOG} Gun.js unavailable — using BroadcastChannel only`, err);
    }
  }

  // ── Announce Presence ──────────────────────────────────────────────

  private announcePresence(): void {
    if (!this.localPeerId) return;
    const now = Date.now();

    const mesh = getSwarmMeshStandalone();
    const trustScore = this.computeLocalTrustScore(mesh);

    const beacon: PresenceBeacon = {
      peerId: this.localPeerId,
      trustScore,
      ts: now,
    };

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

    const entity = this.knownPresence.get('peer-network-entity');
    if (entity) {
      entity.ts = now;
    }
  }

  // ── Compute Local Trust Score ──────────────────────────────────────

  private computeLocalTrustScore(mesh: ReturnType<typeof getSwarmMeshStandalone>): number {
    const stats = mesh.getMiningStats();
    if (!stats) return 0.3; // New node baseline

    const { confirmedBlocks, blocksMinedTotal, chunksServed, peersDiscovered } = stats;

    // Honest Mining Ratio (60% weight)
    const miningRatio = blocksMinedTotal > 0
      ? confirmedBlocks / blocksMinedTotal
      : 0;

    // Content Contribution Ratio (40% weight)
    const contentRatio = Math.min(1.0,
      peersDiscovered > 0 ? chunksServed / peersDiscovered : 0
    );

    const score = 0.6 * miningRatio + 0.4 * contentRatio;

    // New nodes with zero stats get baseline
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
    this.knownPresence.set(beacon.peerId, beacon);
  }

  // ── Prune & Emit ──────────────────────────────────────────────────

  private pruneAndEmit(): void {
    const cutoff = Date.now() - STALE_THRESHOLD;
    const livePeers: GlobalCellPeerEvent['peers'] = [];
    const ENTITY_PEER_ID = 'peer-network-entity';

    for (const [peerId, beacon] of this.knownPresence) {
      if (beacon.ts < cutoff) {
        this.knownPresence.delete(peerId);
        continue;
      }
      if (peerId === ENTITY_PEER_ID) {
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

  /**
   * Register the network entity (Imagination) as always-present in the global cell.
   * This ensures the entity is discoverable and helps the neural engine learn
   * what a healthy cell looks like (entity = baseline participant).
   */
  private announceEntityPresence(): void {
    const ENTITY_PEER_ID = 'peer-network-entity';
    const existing = this.knownPresence.get(ENTITY_PEER_ID);
    const entityBeacon: PresenceBeacon = existing ?? {
      peerId: ENTITY_PEER_ID,
      trustScore: 1.0, // Entity always has maximum trust
      ts: Date.now(),
    };
    entityBeacon.ts = Date.now();
    this.knownPresence.set(ENTITY_PEER_ID, entityBeacon);

    console.log(`${LOG} 🧠 Network entity (Imagination) registered in global cell`);
  }
}
