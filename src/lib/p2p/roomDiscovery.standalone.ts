/**
 * ═══════════════════════════════════════════════════════════════════════
 * DETERMINISTIC ROOM DISCOVERY — Standalone Overlay
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Supplements (never replaces) the existing Cascade Connect strategy.
 * Generates a deterministic room ID from the browser pathname, then
 * uses multiple discovery channels to find peers on the same page:
 *
 *   1. Mesh broadcast — for peers already connected via SWARM
 *   2. BroadcastChannel — for same-origin cross-tab discovery (instant)
 *   3. PeerJS Rendezvous Beacon — for cross-device isolated peer discovery
 *      Creates a temporary PeerJS peer with a deterministic room-based ID
 *      so two isolated peers converge on the same signaling identity.
 *
 * Design principles:
 *   - Zero interference with existing network schemas
 *   - All PeerJS / dial failures are SILENT (no user-facing alerts)
 *   - Logging is strong and detailed for diagnostics
 *   - Completely standalone — reads the mesh singleton but owns no state in it
 *   - Does NOT break the Never-Rotate identity rule (beacon is separate & temporary)
 *   - Does NOT interfere with the main PeerJS instance
 *
 * Timing strategy (low overhead):
 *   - Connected peers: broadcast room presence every 2 minutes
 *   - Isolated peers (0 connections): scan/dial every 3 minutes
 *   - Beacon lifecycle: 3 minutes active, then destroyed and retried next cycle
 *   - On initial connection: immediately join room & announce
 *   - Stale peers pruned after 8 minutes
 * ═══════════════════════════════════════════════════════════════════════
 */

import { getSwarmMeshStandalone } from './swarmMesh.standalone';

// ── Constants ──────────────────────────────────────────────────────────

const CHANNEL = 'room-discovery';
const BROADCAST_INTERVAL = 120_000;       // 2 minutes — connected peers announce
const ISOLATED_SCAN_INTERVAL = 180_000;   // 3 minutes — isolated peers try to find the room
const STALE_THRESHOLD = 480_000;          // 8 minutes — prune peers not seen
const CLEANUP_INTERVAL = 120_000;         // 2 minutes — stale check
const BEACON_LIFETIME = 180_000;          // 3 minutes — beacon auto-destroys
const BEACON_RETRY_DELAY = 10_000;        // 10s before retrying beacon after failure
const LOG_PREFIX = '[RoomDiscovery]';
const BC_CHANNEL_NAME = 'room-discovery-bc';

// ── Deterministic Hash ─────────────────────────────────────────────────

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function pathnameToRoomId(pathname: string): string {
  const normalized = (pathname || '/').replace(/\/+$/, '') || '/';
  return `room-${fnv1aHash(normalized.toLowerCase())}`;
}

// ── Types ──────────────────────────────────────────────────────────────

interface RoomPeerEntry {
  peerId: string;
  roomId: string;
  lastSeen: number;
}

interface RoomAnnounce {
  roomId: string;
  peerId: string;
  ts: number;
  /** Gossip hop count — 0 = origin, 1 = relayed once. Max 1 hop. */
  hops?: number;
  /** Unique nonce to deduplicate relayed announcements */
  nonce?: string;
}

// ── Singleton Class ────────────────────────────────────────────────────

class RoomDiscoveryStandalone {
  private running = false;
  private currentRoomId: string | null = null;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;
  private isolatedScanTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private phaseUnsub: (() => void) | null = null;
  private roomPeers = new Map<string, RoomPeerEntry>();
  private dialedThisSession = new Set<string>();
  private patchedMethods = new Set<string>();
  /** Recently seen nonces to prevent re-relaying the same announcement */
  private seenNonces = new Set<string>();
  private static readonly MAX_NONCES = 200;
  private static readonly MAX_HOPS = 1;

  // ── BroadcastChannel (same-origin cross-tab) ──────────────────────
  private bc: BroadcastChannel | null = null;

  // ── PeerJS Rendezvous Beacon (cross-device isolated discovery) ────
  private beaconPeer: import('peerjs').default | null = null;
  private beaconTimer: ReturnType<typeof setTimeout> | null = null;
  private beaconActive = false;

  // ── Lifecycle ──────────────────────────────────────────────────────

  start(): void {
    if (this.running) {
      console.log(`${LOG_PREFIX} Already running, skipping start`);
      return;
    }

    try {
      const mesh = getSwarmMeshStandalone();
      const phase = mesh.getPhase();

      if (phase === 'off') {
        console.log(`${LOG_PREFIX} Mesh is off — deferring start until mesh activates`);
        this.waitForMeshActivation();
        return;
      }

      this.running = true;
      this.updateRoom();

      // Listen for channel messages
      this.unsubscribe = mesh.onMessage(CHANNEL, (_fromPeerId: string, payload: unknown) => {
        this.handleAnnouncement(payload);
      });

      // Listen for phase changes — announce immediately when going online
      this.phaseUnsub = mesh.onPhaseChange((newPhase) => {
        if (newPhase === 'online') {
          console.log(`${LOG_PREFIX} 🟢 Mesh went online — immediate room announce`);
          this.announce();
          this.attemptRoomDials();
          // Destroy beacon if we got a real connection
          this.destroyBeacon('mesh went online');
        }
      });

      // Connected broadcast: every 2 minutes
      this.broadcastTimer = setInterval(() => this.announce(), BROADCAST_INTERVAL);

      // Isolated scan: every 3 minutes — tries to dial known room peers or launch beacon
      this.isolatedScanTimer = setInterval(() => this.isolatedScan(), ISOLATED_SCAN_INTERVAL);

      // Stale cleanup
      this.cleanupTimer = setInterval(() => this.cleanupStale(), CLEANUP_INTERVAL);

      // Start BroadcastChannel for same-origin discovery
      this.startBroadcastChannel();

      // Immediate first announce (even during 'connecting' phase)
      this.announce();

      // If already isolated, start beacon immediately
      setTimeout(() => {
        if (this.running && mesh.getConnectedPeerIds().length === 0) {
          console.log(`${LOG_PREFIX} 🔦 Initially isolated — launching beacon`);
          void this.launchBeacon();
        }
      }, 15_000); // Wait 15s for cascade to settle first

      // SPA route handling
      if (typeof window !== 'undefined') {
        window.addEventListener('popstate', this.onRouteChange);
        this.patchHistoryMethod('pushState');
        this.patchHistoryMethod('replaceState');
      }

      console.log(`${LOG_PREFIX} ✅ Started — room: ${this.currentRoomId}, phase: ${phase}, peerId: ${mesh.getPeerId()}`);
    } catch (err) {
      console.warn(`${LOG_PREFIX} ⚠️ Failed to start (silent):`, err);
    }
  }

  private waitForMeshActivation(): void {
    try {
      const mesh = getSwarmMeshStandalone();
      this.phaseUnsub = mesh.onPhaseChange((phase) => {
        if (phase !== 'off') {
          if (this.phaseUnsub) { this.phaseUnsub(); this.phaseUnsub = null; }
          this.start();
        }
      });
    } catch {
      // Silent
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.broadcastTimer) { clearInterval(this.broadcastTimer); this.broadcastTimer = null; }
    if (this.isolatedScanTimer) { clearInterval(this.isolatedScanTimer); this.isolatedScanTimer = null; }
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    if (this.phaseUnsub) { this.phaseUnsub(); this.phaseUnsub = null; }

    this.stopBroadcastChannel();
    this.destroyBeacon('stopping');

    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.onRouteChange);
    }

    this.roomPeers.clear();
    this.dialedThisSession.clear();
    this.currentRoomId = null;
    console.log(`${LOG_PREFIX} ⏹️ Stopped`);
  }

  // ── Room Management ────────────────────────────────────────────────

  private updateRoom(): void {
    if (typeof window === 'undefined') return;
    const newRoom = pathnameToRoomId(window.location.pathname);
    if (newRoom !== this.currentRoomId) {
      const oldRoom = this.currentRoomId;
      this.currentRoomId = newRoom;
      this.roomPeers.clear();
      this.dialedThisSession.clear();
      console.log(`${LOG_PREFIX} 🚪 Room: ${oldRoom ?? '(init)'} → ${newRoom} (${window.location.pathname})`);
      this.announce();
      this.announceBroadcastChannel();
      // Restart beacon with new room ID
      this.destroyBeacon('room changed');
    }
  }

  private onRouteChange = (): void => {
    this.updateRoom();
  };

  private patchHistoryMethod(method: 'pushState' | 'replaceState'): void {
    if (typeof window === 'undefined' || this.patchedMethods.has(method)) return;
    this.patchedMethods.add(method);

    const original = history[method].bind(history);
    history[method] = (...args: Parameters<typeof history.pushState>) => {
      const result = original(...args);
      setTimeout(() => this.onRouteChange(), 0);
      return result;
    };
  }

  // ═════════════════════════════════════════════════════════════════════
  // BROADCAST CHANNEL — Same-origin cross-tab discovery (instant)
  // ═════════════════════════════════════════════════════════════════════

  private startBroadcastChannel(): void {
    try {
      if (typeof BroadcastChannel === 'undefined') return;
      this.bc = new BroadcastChannel(BC_CHANNEL_NAME);
      this.bc.onmessage = (ev) => {
        try {
          const data = ev.data as RoomAnnounce;
          if (!data || typeof data.roomId !== 'string' || typeof data.peerId !== 'string') return;
          this.handleDiscoveredPeer(data.peerId, data.roomId, 'broadcastchannel');
        } catch {
          // Silent
        }
      };
      console.log(`${LOG_PREFIX} 📺 BroadcastChannel started`);
    } catch {
      // BroadcastChannel not available (e.g., some private browsing modes)
    }
  }

  private stopBroadcastChannel(): void {
    if (this.bc) {
      try { this.bc.close(); } catch { /* ignore */ }
      this.bc = null;
    }
  }

  private announceBroadcastChannel(): void {
    if (!this.bc || !this.currentRoomId) return;
    try {
      const mesh = getSwarmMeshStandalone();
      const payload: RoomAnnounce = {
        roomId: this.currentRoomId,
        peerId: mesh.getPeerId(),
        ts: Date.now(),
      };
      this.bc.postMessage(payload);
      console.debug(`${LOG_PREFIX} 📺 BC announce: ${this.currentRoomId}`);
    } catch {
      // Silent
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // PEERJS RENDEZVOUS BEACON — Cross-device isolated discovery
  // ═════════════════════════════════════════════════════════════════════
  //
  // When isolated (0 mesh connections), creates a temporary PeerJS peer
  // with a deterministic room-based ID: `rmbeacon-{roomHash}`
  //
  // Two isolated peers on the same page converge on this ID:
  //   - First peer registers as the beacon → waits for connections
  //   - Second peer connects to the beacon → they exchange real peer IDs
  //   - Both then dial each other's real mesh peer IDs
  //   - Beacon is destroyed after exchange or after BEACON_LIFETIME
  //
  // This is a SEPARATE PeerJS instance from the main mesh identity.
  // It is short-lived (max 3 minutes) and only active when isolated.
  // ═════════════════════════════════════════════════════════════════════

  private getBeaconId(): string {
    if (!this.currentRoomId) return 'rmbeacon-fallback';
    return `rmbeacon-${this.currentRoomId.replace('room-', '')}`;
  }

  private async launchBeacon(): Promise<void> {
    if (!this.running || this.beaconActive) return;

    const mesh = getSwarmMeshStandalone();
    const phase = mesh.getPhase();
    if (phase === 'off') return;

    // Don't launch if we already have connections
    if (mesh.getConnectedPeerIds().length > 0) {
      console.debug(`${LOG_PREFIX} 🔦 Beacon skipped — already connected`);
      return;
    }

    const beaconId = this.getBeaconId();
    const realPeerId = mesh.getPeerId();

    console.log(`${LOG_PREFIX} 🔦 Launching rendezvous beacon: ${beaconId}`);

    try {
      const Peer = (await import('peerjs')).default;

      // Phase 1: Try to CONNECT to existing beacon (another peer may already be waiting)
      const connected = await this.tryConnectToBeacon(Peer, beaconId, realPeerId);
      if (connected) return; // Successfully found a peer via their beacon

      // Phase 2: No beacon found — BECOME the beacon
      await this.becomeBeacon(Peer, beaconId, realPeerId);

    } catch (err) {
      console.debug(`${LOG_PREFIX} 🔦 Beacon launch error (silent):`, err);
      this.beaconActive = false;
    }
  }

  private tryConnectToBeacon(
    PeerClass: typeof import('peerjs').default,
    beaconId: string,
    realPeerId: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const probePeerId = `probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      let resolved = false;
      const done = (success: boolean) => {
        if (resolved) return;
        resolved = true;
        try { probePeer.destroy(); } catch { /* ignore */ }
        resolve(success);
      };

      const probePeer = new PeerClass(probePeerId, {
        debug: 0,
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        path: '/',
      });

      // Timeout: if probe doesn't connect within 8s, give up
      const timeout = setTimeout(() => done(false), 8_000);

      probePeer.on('open', () => {
        console.log(`${LOG_PREFIX} 🔦 Probe open, connecting to beacon ${beaconId}...`);
        const conn = probePeer.connect(beaconId, { metadata: { type: 'room-beacon-probe', realPeerId } });

        conn.on('open', () => {
          console.log(`${LOG_PREFIX} 🔦 ✅ Connected to existing beacon ${beaconId}!`);
          // Send our real peer ID
          conn.send(JSON.stringify({ type: 'beacon-exchange', realPeerId }));
        });

        conn.on('data', (raw) => {
          try {
            const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (msg && msg.type === 'beacon-exchange' && msg.realPeerId) {
              console.log(`${LOG_PREFIX} 🔦 🎯 Beacon exchange: discovered real peer ${msg.realPeerId}`);
              this.handleDiscoveredPeer(msg.realPeerId, this.currentRoomId || '', 'beacon');
              clearTimeout(timeout);
              setTimeout(() => done(true), 500);
            }
          } catch { /* ignore */ }
        });

        conn.on('error', () => {
          clearTimeout(timeout);
          done(false);
        });
      });

      probePeer.on('error', (err) => {
        console.debug(`${LOG_PREFIX} 🔦 Probe error: ${err.type} — no beacon found, will become one`);
        clearTimeout(timeout);
        done(false);
      });
    });
  }

  private async becomeBeacon(
    PeerClass: typeof import('peerjs').default,
    beaconId: string,
    realPeerId: string,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      this.beaconActive = true;

      const beaconPeer = new PeerClass(beaconId, {
        debug: 0,
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        path: '/',
      });

      this.beaconPeer = beaconPeer;

      // Auto-destroy after BEACON_LIFETIME
      this.beaconTimer = setTimeout(() => {
        console.log(`${LOG_PREFIX} 🔦 Beacon expired after ${BEACON_LIFETIME / 1000}s`);
        this.destroyBeacon('expired');
        resolve();
      }, BEACON_LIFETIME);

      beaconPeer.on('open', () => {
        console.log(`${LOG_PREFIX} 🔦 📡 Beacon active as ${beaconId} — waiting for peers...`);
      });

      beaconPeer.on('connection', (conn) => {
        console.log(`${LOG_PREFIX} 🔦 🔗 Incoming beacon connection from ${conn.peer}`);

        conn.on('open', () => {
          // Send our real peer ID
          conn.send(JSON.stringify({ type: 'beacon-exchange', realPeerId }));
        });

        conn.on('data', (raw) => {
          try {
            const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (msg && msg.type === 'beacon-exchange' && msg.realPeerId) {
              console.log(`${LOG_PREFIX} 🔦 🎯 Beacon discovered real peer ${msg.realPeerId}`);
              this.handleDiscoveredPeer(msg.realPeerId, this.currentRoomId || '', 'beacon');
              // Keep beacon alive briefly for more peers, then destroy
              setTimeout(() => this.destroyBeacon('exchange complete'), 5_000);
            }
          } catch { /* ignore */ }
        });
      });

      beaconPeer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          // Another peer already claimed the beacon — try connecting to it instead
          console.log(`${LOG_PREFIX} 🔦 Beacon ID taken — connecting to existing beacon`);
          this.destroyBeacon('id taken');
          // Retry as a connector after a brief delay
          setTimeout(() => void this.launchBeacon(), BEACON_RETRY_DELAY);
        } else {
          console.debug(`${LOG_PREFIX} 🔦 Beacon error: ${err.type}`);
        }
        resolve();
      });

      beaconPeer.on('disconnected', () => {
        console.debug(`${LOG_PREFIX} 🔦 Beacon disconnected from signaling`);
      });
    });
  }

  private destroyBeacon(reason: string): void {
    if (this.beaconTimer) {
      clearTimeout(this.beaconTimer);
      this.beaconTimer = null;
    }
    if (this.beaconPeer) {
      console.log(`${LOG_PREFIX} 🔦 Destroying beacon (${reason})`);
      try { this.beaconPeer.destroy(); } catch { /* ignore */ }
      this.beaconPeer = null;
    }
    this.beaconActive = false;
  }

  // ═════════════════════════════════════════════════════════════════════
  // UNIFIED PEER DISCOVERY HANDLER
  // ═════════════════════════════════════════════════════════════════════

  private handleDiscoveredPeer(peerId: string, roomId: string, source: string): void {
    try {
      const mesh = getSwarmMeshStandalone();
      if (peerId === mesh.getPeerId()) return;

      // Track the peer
      const existing = this.roomPeers.get(peerId);
      if (existing) {
        existing.lastSeen = Date.now();
      } else {
        this.roomPeers.set(peerId, { peerId, roomId, lastSeen: Date.now() });
        console.log(`${LOG_PREFIX} 🆕 Discovered ${peerId} via ${source} in ${roomId}`);
      }

      // Dial if not already connected
      if (!this.dialedThisSession.has(peerId) || source === 'beacon' || source === 'broadcastchannel') {
        this.dialedThisSession.add(peerId);
        this.silentDial(peerId);
      }
    } catch {
      // Silent
    }
  }

  // ── Announcements ──────────────────────────────────────────────────

  private generateNonce(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private trackNonce(nonce: string): boolean {
    if (this.seenNonces.has(nonce)) return false; // Already seen
    this.seenNonces.add(nonce);
    // Cap nonce memory
    if (this.seenNonces.size > RoomDiscoveryStandalone.MAX_NONCES) {
      const first = this.seenNonces.values().next().value;
      if (first) this.seenNonces.delete(first);
    }
    return true; // First time seen
  }

  private announce(): void {
    if (!this.running || !this.currentRoomId) return;

    // Always announce via BroadcastChannel (works with 0 mesh connections)
    this.announceBroadcastChannel();

    try {
      const mesh = getSwarmMeshStandalone();
      const phase = mesh.getPhase();

      // Allow announce during 'connecting' AND 'online' — not just online
      if (phase === 'off') return;

      const connectedCount = mesh.getConnectedPeerIds().length;
      if (connectedCount === 0) {
        console.debug(`${LOG_PREFIX} No connected peers to broadcast to — skipping mesh announce (BC still sent)`);
        return;
      }

      const nonce = this.generateNonce();
      this.trackNonce(nonce); // Mark our own nonce as seen

      const payload: RoomAnnounce = {
        roomId: this.currentRoomId,
        peerId: mesh.getPeerId(),
        ts: Date.now(),
        hops: 0,
        nonce,
      };

      mesh.broadcast(CHANNEL, payload);
      console.debug(`${LOG_PREFIX} 📡 Announced ${this.currentRoomId} (nonce: ${nonce}) to ${connectedCount} peer(s) [phase: ${phase}]`);
    } catch {
      // Silent
    }
  }

  // ── Isolated Scan (3-minute cycle for disconnected users) ─────────

  private isolatedScan(): void {
    if (!this.running) return;
    try {
      const mesh = getSwarmMeshStandalone();
      const phase = mesh.getPhase();
      if (phase === 'off') return;

      const connectedCount = mesh.getConnectedPeerIds().length;

      if (connectedCount > 0) {
        // Not isolated — the regular broadcast handles discovery
        // Destroy beacon if it's still alive
        if (this.beaconActive) this.destroyBeacon('no longer isolated');
        console.debug(`${LOG_PREFIX} 🔍 Isolated scan skipped — ${connectedCount} connection(s) active`);
        return;
      }

      console.log(`${LOG_PREFIX} 🔍 Isolated scan — 0 connections, attempting room dials + beacon`);
      this.attemptRoomDials();

      // Launch beacon if not already active
      if (!this.beaconActive) {
        void this.launchBeacon();
      }
    } catch {
      // Silent
    }
  }

  /**
   * Attempt to dial any known room peers we haven't connected to yet.
   * Also re-enables dialing for peers that may have been marked stale.
   */
  private attemptRoomDials(): void {
    try {
      const mesh = getSwarmMeshStandalone();
      const phase = mesh.getPhase();
      if (phase === 'off') return;

      // Re-try all known room peers (reset dialed set for re-attempts)
      const knownPeers = Array.from(this.roomPeers.keys());
      if (knownPeers.length > 0) {
        console.log(`${LOG_PREFIX} 🔗 Re-dialing ${knownPeers.length} known room peer(s)`);
        for (const peerId of knownPeers) {
          this.silentDial(peerId);
        }
      } else {
        console.log(`${LOG_PREFIX} 📭 No known room peers to dial`);
      }
    } catch {
      // Silent
    }
  }

  // ── Handling Peer Announcements (from mesh channel) ────────────────

  private handleAnnouncement(payload: unknown): void {
    try {
      const data = payload as RoomAnnounce;
      if (!data || typeof data.roomId !== 'string' || typeof data.peerId !== 'string') return;

      const hops = typeof data.hops === 'number' ? data.hops : 0;
      const nonce = data.nonce || '';

      // Deduplicate by nonce — if we've already processed this exact announcement, drop it
      if (nonce && !this.trackNonce(nonce)) {
        console.debug(`${LOG_PREFIX} Duplicate nonce ${nonce} from ${data.peerId}, dropping`);
        return;
      }

      const mesh = getSwarmMeshStandalone();
      if (data.peerId === mesh.getPeerId()) return;

      // ── Gossip relay: forward to our other peers if hops < MAX ──
      // This is the KEY fix: even if we're not in the same room, we relay
      // so that peers connected through us can discover each other.
      if (hops < RoomDiscoveryStandalone.MAX_HOPS) {
        try {
          const relayPayload: RoomAnnounce = {
            ...data,
            hops: hops + 1,
            nonce: nonce,
          };
          mesh.broadcast(CHANNEL, relayPayload);
          console.debug(`${LOG_PREFIX} 🔀 Relayed announcement from ${data.peerId} (hop ${hops}→${hops + 1}, room ${data.roomId})`);
        } catch {
          // Silent relay failure
        }
      }

      // Only process peer tracking for OUR room
      if (data.roomId !== this.currentRoomId) {
        console.debug(`${LOG_PREFIX} Peer ${data.peerId} in different room ${data.roomId}, relayed but not tracking`);
        return;
      }

      this.handleDiscoveredPeer(data.peerId, data.roomId, `mesh-hop${hops}`);
    } catch {
      // Silent — malformed payloads dropped
    }
  }

  private silentDial(remotePeerId: string): void {
    try {
      const mesh = getSwarmMeshStandalone();
      const phase = mesh.getPhase();

      // Allow dial during 'connecting' AND 'online' — relaxed gate
      if (phase === 'off') {
        console.debug(`${LOG_PREFIX} ⏳ Mesh off, skipping dial to ${remotePeerId}`);
        return;
      }

      if (mesh.getConnectedPeerIds().includes(remotePeerId)) {
        console.debug(`${LOG_PREFIX} ✅ Already connected to ${remotePeerId}`);
        return;
      }

      console.log(`${LOG_PREFIX} 🔗 Silent dial → ${remotePeerId} [phase: ${phase}]`);
      mesh.connectToPeer(remotePeerId);
    } catch {
      console.debug(`${LOG_PREFIX} Dial to ${remotePeerId} failed (swallowed)`);
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────

  private cleanupStale(): void {
    const cutoff = Date.now() - STALE_THRESHOLD;
    const stale: string[] = [];
    for (const [peerId, entry] of this.roomPeers) {
      if (entry.lastSeen < cutoff) stale.push(peerId);
    }
    if (stale.length > 0) {
      for (const id of stale) {
        this.roomPeers.delete(id);
        this.dialedThisSession.delete(id);
      }
      console.log(`${LOG_PREFIX} 🧹 Pruned ${stale.length} stale peer(s)`);
    }
  }

  // ── Public Getters ─────────────────────────────────────────────────

  getCurrentRoomId(): string | null { return this.currentRoomId; }
  getRoomPeers(): RoomPeerEntry[] { return Array.from(this.roomPeers.values()); }
  isRunning(): boolean { return this.running; }
  isBeaconActive(): boolean { return this.beaconActive; }

  getStats(): { roomId: string | null; peerCount: number; dialedCount: number; beaconActive: boolean } {
    return {
      roomId: this.currentRoomId,
      peerCount: this.roomPeers.size,
      dialedCount: this.dialedThisSession.size,
      beaconActive: this.beaconActive,
    };
  }
}

// ── Singleton Export ────────────────────────────────────────────────────

let instance: RoomDiscoveryStandalone | null = null;

export function getRoomDiscovery(): RoomDiscoveryStandalone {
  if (!instance) instance = new RoomDiscoveryStandalone();
  return instance;
}

export { pathnameToRoomId, fnv1aHash };
