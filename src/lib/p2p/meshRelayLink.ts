/**
 * Gun relay link for peers whose direct dial stalled.
 *
 * Uses the same GunAdapter transport the HybridOrchestrator wraps as its Gun
 * layer, in per-peer inbox mode (`swarm-space/mesh-relay/<peerId>`), so each
 * node only receives what is addressed to it. Started lazily on the first
 * stall: a network where every dial opens never touches the relay.
 */

import { GUN_RELAYS } from './gunRelays';

export const MESH_RELAY_CHANNEL = 'mesh-relay';
export const MESH_RELAY_GRAPH_KEY = 'swarm-space/mesh-relay';
/** Relayed envelopes older than this are stale history, not live traffic. */
export const MESH_RELAY_MAX_AGE_MS = 60_000;
const MAX_QUEUED = 50;

export interface RelayTransport {
  start(context: { peerId: string }): Promise<void>;
  stop(): void;
  send(channel: string, peerId: string, payload: unknown): boolean;
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void;
}

export type RelayTransportFactory = () => Promise<RelayTransport>;

export const defaultRelayTransportFactory: RelayTransportFactory = async () => {
  const { GunAdapter } = await import('./transports/gunAdapter');
  return new GunAdapter({
    peers: GUN_RELAYS,
    graphKey: MESH_RELAY_GRAPH_KEY,
    inbox: true,
    maxAgeMs: MESH_RELAY_MAX_AGE_MS,
  });
};

export class MeshRelayLink {
  private transport: RelayTransport | null = null;
  private starting: Promise<void> | null = null;
  private localPeerId: string | null = null;
  private queue: Array<{ target: string; raw: string }> = [];
  private unsubscribe: (() => void) | null = null;
  private readonly handlers = new Set<(from: string, raw: string) => void>();

  constructor(private readonly factory: RelayTransportFactory = defaultRelayTransportFactory) {}

  isStarted(): boolean {
    return this.transport !== null;
  }

  /** Starts the relay once; later calls share the same start. */
  ensureStarted(localPeerId: string): Promise<void> {
    if (this.transport && this.localPeerId === localPeerId) return Promise.resolve();
    if (this.starting) return this.starting;
    this.localPeerId = localPeerId;
    this.starting = (async () => {
      const transport = await this.factory();
      await transport.start({ peerId: localPeerId });
      if (this.localPeerId !== localPeerId) { transport.stop(); return; }
      this.transport = transport;
      this.unsubscribe = transport.onMessage(MESH_RELAY_CHANNEL, (from, payload) => {
        if (typeof payload !== 'string') return;
        for (const handler of this.handlers) {
          try { handler(from, payload); } catch { /* ignore */ }
        }
      });
      const queued = this.queue;
      this.queue = [];
      for (const { target, raw } of queued) transport.send(MESH_RELAY_CHANNEL, target, raw);
    })().catch((err) => {
      console.warn('[MeshRelay] Relay start failed:', err);
    }).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** Sends one serialized mesh message to `target`; queues while starting. */
  send(target: string, raw: string): boolean {
    if (this.transport) return this.transport.send(MESH_RELAY_CHANNEL, target, raw);
    if (!this.starting) return false;
    if (this.queue.length >= MAX_QUEUED) this.queue.shift();
    this.queue.push({ target, raw });
    return true;
  }

  onMessage(handler: (from: string, raw: string) => void): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    try { this.transport?.stop(); } catch { /* ignore */ }
    this.transport = null;
    this.localPeerId = null;
    this.queue = [];
  }
}
