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

import { getSwarmMeshStandalone } from './swarmMesh.standalone';

// ── Constants ──────────────────────────────────────────────────────────

const CHANNEL = 'room-discovery';
const ANNOUNCE_INTERVAL = 8_000;
const STALE_THRESHOLD = 30_000;
const CLEANUP_INTERVAL = 15_000;
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
}

// ── Singleton Class ────────────────────────────────────────────────────

class RoomDiscoveryStandalone {
  private running = false;
  private currentRoomId: string | null = null;
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private roomPeers = new Map<string, RoomPeerEntry>();
  private dialedThisSession = new Set<string>();
  private patchedMethods = new Set<string>();

  // ── Lifecycle ──────────────────────────────────────────────────────

  start(): void {
    if (this.running) {
      console.log(`${LOG_PREFIX} Already running, skipping start`);
      return;
    }

    try {
      const mesh = getSwarmMeshStandalone();

      if (mesh.getPhase() === 'off') {
        console.log(`${LOG_PREFIX} Mesh is off — deferring until online`);
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

      this.unsubscribe = mesh.onMessage(CHANNEL, (_fromPeerId: string, payload: unknown) => {
        this.handleAnnouncement(payload);
      });

      this.announceTimer = setInterval(() => this.announce(), ANNOUNCE_INTERVAL);
      this.announce();

      this.cleanupTimer = setInterval(() => this.cleanupStale(), CLEANUP_INTERVAL);

      if (typeof window !== 'undefined') {
        window.addEventListener('popstate', this.onRouteChange);
        this.patchHistoryMethod('pushState');
        this.patchHistoryMethod('replaceState');
      }

      console.log(`${LOG_PREFIX} ✅ Started — room: ${this.currentRoomId}, peerId: ${mesh.getPeerId()}`);
    } catch (err) {
      console.warn(`${LOG_PREFIX} ⚠️ Failed to start (silent):`, err);
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

  private announce(): void {
    if (!this.running || !this.currentRoomId) return;
    try {
      const mesh = getSwarmMeshStandalone();
      if (mesh.getPhase() !== 'online') return;

      const payload: RoomAnnounce = {
        roomId: this.currentRoomId,
        peerId: mesh.getPeerId(),
        ts: Date.now(),
      };

      mesh.broadcast(CHANNEL, payload);
      console.debug(`${LOG_PREFIX} 📡 Announced ${this.currentRoomId} to ${mesh.getConnectedPeerIds().length} peer(s)`);
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
      if (mesh.getPhase() !== 'online') {
        console.log(`${LOG_PREFIX} ⏳ Mesh not online, skipping dial to ${remotePeerId}`);
        return;
      }

      if (mesh.getConnectedPeerIds().includes(remotePeerId)) {
        console.log(`${LOG_PREFIX} ✅ Already connected to ${remotePeerId}`);
        return;
      }

      console.log(`${LOG_PREFIX} 🔗 Silent dial → ${remotePeerId}`);
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
