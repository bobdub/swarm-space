/**
 * Stalled-dial tracking for the per-peer relay fallback.
 *
 * Two devices behind the same home router sometimes never open a direct
 * WebRTC data channel (hairpin NAT, mDNS-only host candidates, client
 * isolation). PeerJS signaling still delivers the handshake, so both sides
 * know about each other; only the direct path is stuck.
 *
 * This module only watches NEW dials. A dial whose channel has not opened
 * after `DIAL_STALL_MS` (or whose ICE reports `failed`) marks that one peer
 * as "direct path stalled". The mesh then routes that peer's chat, presence
 * and post sync over the Gun relay while the direct attempt keeps going.
 * When the direct channel opens, the relay route is dropped.
 *
 * Hard rules (see AGENTS.md):
 * - Never fires for a peer that is already connected.
 * - Never closes, renegotiates or redials anything. It has no dial power.
 *
 * Pure state + injected clock/timers so it is testable without WebRTC.
 */

export const DIAL_STALL_MS = 8_000;
/** A relay route with no relayed traffic for this long is dropped. */
export const RELAY_ROUTE_IDLE_MS = 5 * 60 * 1000;

export type StallReason = 'timeout' | 'ice-failed';

export interface StalledDialDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** The peer has an open direct data channel. */
  isConnected(peerId: string): boolean;
  /** A new dial stalled: start relaying for this peer. */
  onStall(peerId: string, reason: StallReason): void;
  /** The relay route for this peer ended (direct opened, idle, or dropped). */
  onRouteEnded(peerId: string, why: 'direct' | 'idle' | 'dropped'): void;
}

interface WatchedDial {
  startedAt: number;
  timer: unknown;
}

export interface RelayRoute {
  peerId: string;
  since: number;
  lastRelayAt: number;
  reason: StallReason;
  /** First time the peer answered over the relay; null until then. */
  confirmedAt: number | null;
}

export class StalledDialTracker {
  private readonly dials = new Map<string, WatchedDial>();
  private readonly routes = new Map<string, RelayRoute>();

  constructor(private readonly deps: StalledDialDeps) {}

  /**
   * Start watching a fresh dial. Returns false (and watches nothing) when the
   * peer is already connected or a dial to it is already being watched.
   */
  watchNewDial(peerId: string): boolean {
    if (this.deps.isConnected(peerId)) return false;
    if (this.dials.has(peerId)) return false;
    const timer = this.deps.setTimer(() => this.fire(peerId, 'timeout'), DIAL_STALL_MS);
    this.dials.set(peerId, { startedAt: this.deps.now(), timer });
    return true;
  }

  /** ICE gave up on the watched dial: it is stalled now, not in 8 s. */
  noteIceFailed(peerId: string): void {
    if (!this.dials.has(peerId)) return;
    this.fire(peerId, 'ice-failed');
  }

  /** The direct data channel opened: stop watching and drop any relay route. */
  noteOpen(peerId: string): void {
    this.stopWatching(peerId);
    if (this.routes.delete(peerId)) this.deps.onRouteEnded(peerId, 'direct');
  }

  /**
   * The dial ended without opening (error, close, pending timeout). The relay
   * route, if any, stays: normal backoff decides when a direct dial is tried
   * again, and the route idles out on its own.
   */
  noteDialEnded(peerId: string): void {
    this.stopWatching(peerId);
  }

  /**
   * The peer's traffic arrived over the relay: keep the route alive. Returns
   * true the first time, when the route becomes confirmed (the peer is really
   * there), which is what "Connected (relay)" requires.
   */
  noteRelayActivity(peerId: string): boolean {
    const route = this.routes.get(peerId);
    if (!route) return false;
    route.lastRelayAt = this.deps.now();
    if (route.confirmedAt !== null) return false;
    route.confirmedAt = route.lastRelayAt;
    return true;
  }

  /** The route exists and the peer has answered over it. */
  isConfirmed(peerId: string): boolean {
    return (this.routes.get(peerId)?.confirmedAt ?? null) !== null;
  }

  /** Drop a peer's route (goodbye, block). */
  drop(peerId: string): void {
    this.stopWatching(peerId);
    if (this.routes.delete(peerId)) this.deps.onRouteEnded(peerId, 'dropped');
  }

  /** Drop routes with no relayed traffic for RELAY_ROUTE_IDLE_MS. */
  pruneIdle(): string[] {
    const cutoff = this.deps.now() - RELAY_ROUTE_IDLE_MS;
    const dropped: string[] = [];
    for (const [peerId, route] of this.routes) {
      if (route.lastRelayAt >= cutoff) continue;
      this.routes.delete(peerId);
      dropped.push(peerId);
      this.deps.onRouteEnded(peerId, 'idle');
    }
    return dropped;
  }

  isWatching(peerId: string): boolean {
    return this.dials.has(peerId);
  }

  isRelayed(peerId: string): boolean {
    return this.routes.has(peerId);
  }

  relayedPeerIds(): string[] {
    return [...this.routes.keys()];
  }

  getRoute(peerId: string): RelayRoute | undefined {
    const route = this.routes.get(peerId);
    return route ? { ...route } : undefined;
  }

  /** Forget everything (mesh stopped). Fires no callbacks. */
  reset(): void {
    for (const dial of this.dials.values()) this.deps.clearTimer(dial.timer);
    this.dials.clear();
    this.routes.clear();
  }

  private stopWatching(peerId: string): void {
    const dial = this.dials.get(peerId);
    if (!dial) return;
    this.deps.clearTimer(dial.timer);
    this.dials.delete(peerId);
  }

  private fire(peerId: string, reason: StallReason): void {
    this.stopWatching(peerId);
    // Opened (or a duplicate channel opened) while we waited: nothing stalled.
    if (this.deps.isConnected(peerId)) return;
    if (this.routes.has(peerId)) return;
    const t = this.deps.now();
    this.routes.set(peerId, { peerId, since: t, lastRelayAt: t, reason, confirmedAt: null });
    this.deps.onStall(peerId, reason);
  }
}
