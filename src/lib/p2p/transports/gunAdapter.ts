// Type reference only - actual import happens dynamically
type Gun = any;
type GunInstance = any;
import type {
  TransportMessageHandler,
  TransportPeerListener,
  TransportRuntimeStatus,
  TransportStateValue,
  TransportStatusListener,
} from './types';

interface BroadcastEnvelope {
  type: string;
  payload: unknown;
  from: string;
  target?: string | null;
  transport: 'gun';
  id: string;
}

export interface GunAdapterOptions {
  peers?: string[];
  channelName?: string;
  graphKey?: string;
}

const DEFAULT_CHANNEL = 'swarm-space-gun';
const DEFAULT_GRAPH_KEY = 'swarm-space/chunks';

export class GunAdapter {
  private gun: GunInstance | null = null;
  private broadcast: BroadcastChannel | null = null;
  private readonly messageHandlers = new Map<string, Set<TransportMessageHandler>>();
  private readonly peerListeners = new Set<TransportPeerListener>();
  private readonly statusListeners = new Set<TransportStatusListener>();
  private readonly peerIds = new Set<string>();
  private readonly seenMessageIds = new Set<string>();
  private status: TransportRuntimeStatus = { state: 'idle', lastError: null };
  private localPeerId: string | null = null;
  private teardownListeners: Array<() => void> = [];

  constructor(private readonly options: GunAdapterOptions = {}) {}

  async start(context: { peerId: string }): Promise<void> {
    if (this.localPeerId === context.peerId && (this.status.state === 'ready' || this.status.state === 'active')) {
      return;
    }

    this.localPeerId = context.peerId;
    this.updateStatus('initializing');

    const joined = await this.tryStartGun();
    if (!joined) {
      this.updateStatus('degraded', 'GUN.js unavailable - using broadcast fallback');
    } else {
      this.updateStatus('ready');
    }

    this.ensureBroadcastChannel();
  }

  stop(): void {
    this.broadcast?.close();
    this.broadcast = null;
    if (typeof (this.gun as { close?: () => void } | null)?.close === 'function') {
      try {
        (this.gun as { close?: () => void } | null)?.close?.();
      } catch (error) {
        console.warn('[GunAdapter] Failed to close GUN instance', error);
      }
    }
    try {
      this.gun?.off();
    } catch (error) {
      console.warn('[GunAdapter] Failed to detach GUN listeners', error);
    }
    this.gun = null;
    this.peerIds.clear();
    this.seenMessageIds.clear();
    this.localPeerId = null;
    this.updateStatus('idle');
    for (const teardown of this.teardownListeners) {
      try {
        teardown();
      } catch (error) {
        console.warn('[GunAdapter] Teardown listener failed', error);
      }
    }
    this.teardownListeners = [];
  }

  send(channel: string, peerId: string, payload: unknown): boolean {
    let delivered = false;
    const id = this.createMessageId();

    if (this.gun && this.localPeerId) {
      try {
        const graphKey = this.options.graphKey ?? DEFAULT_GRAPH_KEY;
        const envelope = {
          id,
          type: channel,
          payload,
          from: this.localPeerId,
          target: peerId,
          transport: 'gun' as const,
          timestamp: Date.now(),
        };
        console.log(`[GunAdapter] 📤 Sending to ${peerId} on channel ${channel}`);
        this.gun.get(graphKey).set(envelope as never);
        delivered = true;
      } catch (error) {
        console.warn('[GunAdapter] Failed to publish message to GUN graph', error);
      }
    }

    if (!delivered && this.broadcast && this.localPeerId) {
      const envelope: BroadcastEnvelope = {
        id,
        type: channel,
        payload,
        from: this.localPeerId,
        target: peerId,
        transport: 'gun',
      };
      try {
        this.broadcast.postMessage(envelope);
        delivered = true;
      } catch (error) {
        console.warn('[GunAdapter] Failed to broadcast fallback message', error);
      }
    }

    if (delivered) {
      this.updateStatus('active');
    }

    return delivered;
  }

  /**
   * Broadcast a message to ALL peers (no specific target)
   */
  broadcastToAll(channel: string, payload: unknown): boolean {
    let delivered = false;
    const id = this.createMessageId();

    if (this.gun && this.localPeerId) {
      try {
        const graphKey = this.options.graphKey ?? DEFAULT_GRAPH_KEY;
        const envelope = {
          id,
          type: channel,
          payload,
          from: this.localPeerId,
          target: null, // No specific target = broadcast to all
          transport: 'gun' as const,
          timestamp: Date.now(),
        };
        console.log(`[GunAdapter] 📡 Broadcasting on channel ${channel}`);
        this.gun.get(graphKey).set(envelope as never);
        delivered = true;
      } catch (error) {
        console.warn('[GunAdapter] Failed to broadcast message to GUN graph', error);
      }
    }

    if (delivered) {
      this.updateStatus('active');
    }

    return delivered;
  }

  onMessage(channel: string, handler: TransportMessageHandler): () => void {
    if (!this.messageHandlers.has(channel)) {
      this.messageHandlers.set(channel, new Set());
    }
    const handlers = this.messageHandlers.get(channel)!;
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.messageHandlers.delete(channel);
      }
    };
  }

  onPeerUpdate(listener: TransportPeerListener): () => void {
    this.peerListeners.add(listener);
    listener(Array.from(this.peerIds));
    return () => {
      this.peerListeners.delete(listener);
    };
  }

  onStatusChange(listener: TransportStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private async tryStartGun(): Promise<boolean> {
    try {
      const module = await import('gun');
      const GunCtor: any = module?.default ?? module;
      if (!GunCtor) {
        return false;
      }
      this.gun = GunCtor({
        peers: this.options.peers ?? [],
        radisk: false,
        localStorage: false,
      });

      const graphKey = this.options.graphKey ?? DEFAULT_GRAPH_KEY;
      console.log(`[GunAdapter] 👂 Listening on GUN graph: ${graphKey}`);
      const chain = this.gun.get(graphKey);
      const listener = (data: BroadcastEnvelope & { timestamp?: number }) => {
        if (!data || typeof data !== 'object') {
          return;
        }
        if (!data.id || this.seenMessageIds.has(data.id)) {
          return;
        }
        this.seenMessageIds.add(data.id);
        if (!data.from || data.from === this.localPeerId) {
          return;
        }
        // Accept broadcast messages (target=null) or messages targeting us
        if (data.target && this.localPeerId && data.target !== this.localPeerId) {
          return;
        }
        
        console.log(`[GunAdapter] 📨 Received message from ${data.from} on channel ${data.type}`, data.target ? `(targeted)` : '(broadcast)');
        
        this.peerIds.add(data.from);
        this.emitPeerUpdate();
        this.emitMessage(data.type, data.from, data.payload);
        this.updateStatus('active');
      };
      chain.map().on(listener);  // Use map().on() to listen for all entries
      this.teardownListeners.push(() => {
        try {
          chain.off();
        } catch (error) {
          console.warn('[GunAdapter] Failed to remove GUN listener', error);
        }
      });
      this.teardownListeners.push(() => {
        try {
          chain.off();
        } catch (error) {
          console.warn('[GunAdapter] Failed to remove GUN listener', error);
        }
      });
      return true;
    } catch (error) {
      console.warn('[GunAdapter] Failed to initialize GUN', error);
      this.updateStatus('degraded', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private ensureBroadcastChannel(): void {
    if (typeof window === 'undefined' || typeof window.BroadcastChannel === 'undefined') {
      return;
    }
    if (this.broadcast) {
      return;
    }
    const channelName = this.options.channelName ?? DEFAULT_CHANNEL;
    this.broadcast = new BroadcastChannel(channelName);
    const listener = (event: MessageEvent<BroadcastEnvelope>) => {
      const data = event.data;
      if (!data || data.transport !== 'gun') {
        return;
      }
      if (this.seenMessageIds.has(data.id)) {
        return;
      }
      this.seenMessageIds.add(data.id);
      if (data.target && this.localPeerId && data.target !== this.localPeerId) {
        return;
      }
      if (!data.from || data.from === this.localPeerId) {
        return;
      }
      this.peerIds.add(data.from);
      this.emitPeerUpdate();
      this.emitMessage(data.type, data.from, data.payload);
      this.updateStatus('active');
    };
    this.broadcast.addEventListener('message', listener as EventListener);
    this.teardownListeners.push(() => {
      this.broadcast?.removeEventListener('message', listener as EventListener);
    });
  }

  private emitMessage(channel: string, peerId: string, payload: unknown): void {
    // Emit to specific channel handlers
    const handlers = this.messageHandlers.get(channel);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(peerId, payload);
        } catch (error) {
          console.warn('[GunAdapter] Message handler failed', error);
        }
      }
    }
    
    // Emit to wildcard handlers with channel info wrapped
    const wildcardHandlers = this.messageHandlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler(peerId, { channel, payload });
        } catch (error) {
          console.warn('[GunAdapter] Wildcard handler failed', error);
        }
      }
    }
  }

  private emitPeerUpdate(): void {
    const peers = Array.from(this.peerIds);
    for (const listener of this.peerListeners) {
      try {
        listener(peers);
      } catch (error) {
        console.warn('[GunAdapter] Peer listener failed', error);
      }
    }
  }

  private updateStatus(state: TransportStateValue, error?: string | null): void {
    this.status = {
      state,
      lastError: error ?? this.status.lastError,
    };
    for (const listener of this.statusListeners) {
      try {
        listener(this.status);
      } catch (listenerError) {
        console.warn('[GunAdapter] Status listener failed', listenerError);
      }
    }
  }

  private createMessageId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}
