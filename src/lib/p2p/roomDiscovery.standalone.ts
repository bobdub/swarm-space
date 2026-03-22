/**
 * ═══════════════════════════════════════════════════════════════════════
 * DETERMINISTIC ROOM DISCOVERY — Standalone Overlay
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Supplements (never replaces) the existing Cascade Connect strategy.
 * Generates a deterministic room ID from the browser pathname, then
 * uses the SWARM Mesh channel system to announce and discover peers
 * who are viewing the same page.
 *
 * Design principles:
 *   - Zero interference with existing network schemas
 *   - All PeerJS / dial failures are SILENT (no user-facing alerts)
 *   - Logging is strong and detailed for diagnostics
 *   - Completely standalone — reads the mesh singleton but owns no state in it
 *   - Does NOT break the Never-Rotate identity rule
 *   - Does NOT create its own PeerJS instance
 *
 * Timing strategy (low overhead):
 *   - Connected peers: broadcast room presence every 2 minutes
 *   - Isolated peers (0 connections): scan/dial every 3 minutes
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
const LOG_PREFIX = '[RoomDiscovery]';

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
        }
      });

      // Connected broadcast: every 2 minutes
      this.broadcastTimer = setInterval(() => this.announce(), BROADCAST_INTERVAL);

      // Isolated scan: every 3 minutes — tries to dial known room peers or bootstrap
      this.isolatedScanTimer = setInterval(() => this.isolatedScan(), ISOLATED_SCAN_INTERVAL);

      // Stale cleanup
      this.cleanupTimer = setInterval(() => this.cleanupStale(), CLEANUP_INTERVAL);

      // Immediate first announce (even during 'connecting' phase)
      this.announce();

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
    try {
      const mesh = getSwarmMeshStandalone();
      const phase = mesh.getPhase();

      // Allow announce during 'connecting' AND 'online' — not just online
      if (phase === 'off') return;

      const connectedCount = mesh.getConnectedPeerIds().length;
      if (connectedCount === 0) {
        console.debug(`${LOG_PREFIX} No connected peers to broadcast to — skipping announce`);
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
        console.debug(`${LOG_PREFIX} 🔍 Isolated scan skipped — ${connectedCount} connection(s) active`);
        return;
      }

      console.log(`${LOG_PREFIX} 🔍 Isolated scan — 0 connections, attempting room dials`);
      this.attemptRoomDials();
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

  // ── Handling Peer Announcements ────────────────────────────────────

  private handleAnnouncement(payload: unknown): void {
    try {
      const data = payload as RoomAnnounce;
      if (!data || typeof data.roomId !== 'string' || typeof data.peerId !== 'string') return;

      if (data.roomId !== this.currentRoomId) {
        console.debug(`${LOG_PREFIX} Peer ${data.peerId} in different room ${data.roomId}, ignoring`);
        return;
      }

      const mesh = getSwarmMeshStandalone();
      if (data.peerId === mesh.getPeerId()) return;

      const existing = this.roomPeers.get(data.peerId);
      if (existing) {
        existing.lastSeen = Date.now();
        console.debug(`${LOG_PREFIX} 🔄 Refreshed ${data.peerId} in ${data.roomId}`);
      } else {
        this.roomPeers.set(data.peerId, {
          peerId: data.peerId,
          roomId: data.roomId,
          lastSeen: Date.now(),
        });
        console.log(`${LOG_PREFIX} 🆕 Discovered ${data.peerId} in ${data.roomId}`);

        if (!this.dialedThisSession.has(data.peerId)) {
          this.dialedThisSession.add(data.peerId);
          this.silentDial(data.peerId);
        }
      }
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

  getStats(): { roomId: string | null; peerCount: number; dialedCount: number } {
    return {
      roomId: this.currentRoomId,
      peerCount: this.roomPeers.size,
      dialedCount: this.dialedThisSession.size,
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
