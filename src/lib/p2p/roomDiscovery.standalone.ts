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
 * How it works:
 *   1. Hash the current pathname → deterministic roomId
 *   2. Every ANNOUNCE_INTERVAL, broadcast {roomId, peerId} on the
 *      'room-discovery' channel via the mesh
 *   3. When a peer announces the same roomId, attempt to connect
 *      (silent on failure — PeerJS Cloud false-unavailable is swallowed)
 *   4. Route changes automatically update the room
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Constants ──────────────────────────────────────────────────────────

const CHANNEL = 'room-discovery';
const ANNOUNCE_INTERVAL = 8_000;        // 8s — frequent enough for discovery
const STALE_THRESHOLD = 30_000;         // 30s — evict peers not seen recently
const CLEANUP_INTERVAL = 15_000;        // 15s — prune stale entries
const LOG_PREFIX = '[RoomDiscovery]';

// ── Deterministic Hash ─────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash → hex string.
 * Deterministic: same input always yields same output.
 */
function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function pathnameToRoomId(pathname: string): string {
  // Normalize: strip trailing slash, lowercase
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
}

// ── Singleton ──────────────────────────────────────────────────────────

class RoomDiscoveryStandalone {
  private running = false;
  private currentRoomId: string | null = null;
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private roomPeers = new Map<string, RoomPeerEntry>();
  private dialedThisSession = new Set<string>();  // avoid re-dial spam

  // ── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Attach to the SWARM Mesh and begin room-based discovery.
   * Safe to call multiple times — idempotent.
   */
  start(): void {
    if (this.running) {
      console.log(`${LOG_PREFIX} Already running, skipping start`);
      return;
    }

    try {
      const { getSwarmMeshStandalone } = this.requireMesh();
      const mesh = getSwarmMeshStandalone();

      if (mesh.getPhase() === 'off') {
        console.log(`${LOG_PREFIX} Mesh is off — deferring start`);
        // Listen for phase change
        const unsub = mesh.onPhaseChange((phase) => {
          if (phase === 'online') {
            unsub();
            this.start();
          }
        });
        return;
      }

      this.running = true;
      this.updateRoom();

      // Subscribe to room announcements from peers
      this.unsubscribe = mesh.onMessage(CHANNEL, (fromPeerId: string, payload: unknown) => {
        this.handleAnnouncement(fromPeerId, payload);
      });

      // Periodic announcements
      this.announceTimer = setInterval(() => this.announce(), ANNOUNCE_INTERVAL);
      // Initial announce
      this.announce();

      // Periodic cleanup of stale peers
      this.cleanupTimer = setInterval(() => this.cleanupStale(), CLEANUP_INTERVAL);

      // Listen for route changes (SPA navigation)
      if (typeof window !== 'undefined') {
        window.addEventListener('popstate', this.onRouteChange);
        // Patch pushState/replaceState for SPA routers
        this.patchHistoryMethod('pushState');
        this.patchHistoryMethod('replaceState');
      }

      console.log(`${LOG_PREFIX} ✅ Started — room: ${this.currentRoomId}, mesh peerId: ${mesh.getPeerId()}`);
    } catch (err) {
      // Silent failure — don't disrupt the app
      console.warn(`${LOG_PREFIX} ⚠️ Failed to start:`, err);
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.announceTimer) { clearInterval(this.announceTimer); this.announceTimer = null; }
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }

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
      // Clear peers from old room
      this.roomPeers.clear();
      this.dialedThisSession.clear();
      console.log(`${LOG_PREFIX} 🚪 Room changed: ${oldRoom ?? '(none)'} → ${newRoom} (path: ${window.location.pathname})`);
      // Announce immediately on room change
      this.announce();
    }
  }

  private onRouteChange = (): void => {
    this.updateRoom();
  };

  // Patch history methods so SPA navigations trigger room updates
  private patchedMethods = new Set<string>();

  private patchHistoryMethod(method: 'pushState' | 'replaceState'): void {
    if (typeof window === 'undefined' || this.patchedMethods.has(method)) return;
    this.patchedMethods.add(method);

    const original = history[method].bind(history);
    history[method] = (...args: Parameters<typeof history.pushState>) => {
      const result = original(...args);
      // Defer so the URL is updated before we read it
      setTimeout(() => this.onRouteChange(), 0);
      return result;
    };
  }

  // ── Announcements ──────────────────────────────────────────────────

  private announce(): void {
    if (!this.running || !this.currentRoomId) return;

    try {
      const mesh = this.getMesh();
      if (!mesh || mesh.getPhase() !== 'online') return;

      const payload: RoomAnnounce = {
        roomId: this.currentRoomId,
        peerId: mesh.getPeerId(),
        ts: Date.now(),
      };

      mesh.broadcast(CHANNEL, payload);
      console.debug(`${LOG_PREFIX} 📡 Announced room ${this.currentRoomId} to ${mesh.getConnectedPeerIds().length} peer(s)`);
    } catch {
      // Silent — never disrupt
    }
  }

  // ── Handling Peer Announcements ────────────────────────────────────

  private handleAnnouncement(fromPeerId: string, payload: unknown): void {
    try {
      const data = payload as RoomAnnounce;
      if (!data || typeof data.roomId !== 'string' || typeof data.peerId !== 'string') return;

      // Only care about peers in our room
      if (data.roomId !== this.currentRoomId) {
        console.debug(`${LOG_PREFIX} Ignoring peer ${data.peerId} in different room ${data.roomId}`);
        return;
      }

      const mesh = this.getMesh();
      if (!mesh) return;
      const myPeerId = mesh.getPeerId();
      if (data.peerId === myPeerId) return; // ignore self

      // Update or add peer entry
      const existing = this.roomPeers.get(data.peerId);
      if (existing) {
        existing.lastSeen = Date.now();
        console.debug(`${LOG_PREFIX} 🔄 Updated peer ${data.peerId} in room ${data.roomId}`);
      } else {
        this.roomPeers.set(data.peerId, {
          peerId: data.peerId,
          roomId: data.roomId,
          lastSeen: Date.now(),
        });
        console.log(`${LOG_PREFIX} 🆕 Discovered peer ${data.peerId} in room ${data.roomId}`);

        // Attempt to connect if not already connected and not already dialed
        if (!this.dialedThisSession.has(data.peerId)) {
          this.dialedThisSession.add(data.peerId);
          this.silentDial(data.peerId);
        }
      }
    } catch {
      // Silent — malformed announcements are dropped
    }
  }

  /**
   * Attempt to dial a discovered peer through the mesh.
   * All failures are completely silent — no user alerts, no thrown errors.
   * Strong logging only.
   */
  private silentDial(remotePeerId: string): void {
    try {
      const mesh = this.getMesh();
      if (!mesh || mesh.getPhase() !== 'online') {
        console.log(`${LOG_PREFIX} ⏳ Mesh not online, skipping dial to ${remotePeerId}`);
        return;
      }

      // Check if already connected
      const connected = mesh.getConnectedPeerIds();
      if (connected.includes(remotePeerId)) {
        console.log(`${LOG_PREFIX} Already connected to ${remotePeerId}, skipping dial`);
        return;
      }

      console.log(`${LOG_PREFIX} 🔗 Attempting silent dial to room peer ${remotePeerId}...`);
      // connectToPeer is the public method — it handles dedup and validation
      // We suppress its alert by catching; the mesh logs internally
      mesh.connectToPeer(remotePeerId);
    } catch {
      // Completely silent — PeerJS Cloud false-unavailable responses are swallowed
      console.debug(`${LOG_PREFIX} Silent dial to ${remotePeerId} failed (swallowed)`);
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
      console.log(`${LOG_PREFIX} 🧹 Cleaned ${stale.length} stale peer(s) from room`);
    }
  }

  // ── Mesh Access (lazy, no hard import) ─────────────────────────────

  private requireMesh() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./swarmMesh.standalone');
  }

  private getMesh(): ReturnType<typeof import('./swarmMesh.standalone').getSwarmMeshStandalone> | null {
    try {
      const { getSwarmMeshStandalone } = this.requireMesh();
      return getSwarmMeshStandalone();
    } catch {
      return null;
    }
  }

  // ── Public Getters ─────────────────────────────────────────────────

  getCurrentRoomId(): string | null {
    return this.currentRoomId;
  }

  getRoomPeers(): RoomPeerEntry[] {
    return Array.from(this.roomPeers.values());
  }

  isRunning(): boolean {
    return this.running;
  }

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

// Re-export hash utility for testing
export { pathnameToRoomId, fnv1aHash };
