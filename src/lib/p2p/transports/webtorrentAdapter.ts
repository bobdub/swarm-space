import type WebTorrent from 'webtorrent';
import type {
  TransportMessageHandler,
  TransportPeerListener,
  TransportRuntimeStatus,
  TransportStateValue,
  TransportStatusListener,
} from './types';

export interface WebTorrentAdapterOptions {
  swarmId: string;
  trackers?: string[];
  channelName?: string;
}

interface BroadcastEnvelope {
  type: string;
  payload: unknown;
  from: string;
  target?: string | null;
  transport: 'webtorrent';
}

const DEFAULT_CHANNEL = 'swarm-space-webtorrent';

export class WebTorrentAdapter {
  private client: WebTorrent | null = null;
  private torrent: { wires: Array<{ peerId?: string; extended: (ext: string, payload: Uint8Array) => void }>; destroy: () => void } | null = null;
  private broadcast: BroadcastChannel | null = null;
  private readonly messageHandlers = new Map<string, Set<TransportMessageHandler>>();
  private readonly peerListeners = new Set<TransportPeerListener>();
  private readonly statusListeners = new Set<TransportStatusListener>();
  private readonly peerIds = new Set<string>();
  private status: TransportRuntimeStatus = { state: 'idle', lastError: null };
  private localPeerId: string | null = null;
  private teardownListeners: Array<() => void> = [];

  constructor(private readonly options: WebTorrentAdapterOptions) {}

  async start(context: { peerId: string }): Promise<void> {
    if (this.localPeerId === context.peerId && (this.status.state === 'ready' || this.status.state === 'active')) {
      return;
    }

    this.localPeerId = context.peerId;
    this.updateStatus('initializing');

    const joined = await this.tryStartWebTorrent();
    if (!joined) {
      this.updateStatus('degraded', 'WebTorrent library unavailable - using broadcast fallback');
    } else {
      this.updateStatus('ready');
    }

    this.ensureBroadcastChannel();
  }

  stop(): void {
    this.broadcast?.close();
    this.broadcast = null;
    if (this.torrent) {
      try {
        this.torrent.destroy();
      } catch (error) {
        console.warn('[WebTorrentAdapter] Failed to destroy torrent', error);
      }
    }
    if (this.client) {
      try {
        this.client.destroy();
      } catch (error) {
        console.warn('[WebTorrentAdapter] Failed to destroy client', error);
      }
    }
    this.client = null;
    this.torrent = null;
    this.peerIds.clear();
    this.localPeerId = null;
    this.updateStatus('idle');
    for (const teardown of this.teardownListeners) {
      try {
        teardown();
      } catch (error) {
        console.warn('[WebTorrentAdapter] Teardown listener failed', error);
      }
    }
    this.teardownListeners = [];
  }

  send(channel: string, peerId: string, payload: unknown): boolean {
    let delivered = false;

    if (this.torrent && this.torrent.wires.length > 0 && this.localPeerId) {
      try {
        const message = JSON.stringify({
          type: channel,
          payload,
          from: this.localPeerId,
          target: peerId,
          transport: 'webtorrent' as const,
        });
        const encoded = new TextEncoder().encode(message);
        for (const wire of this.torrent.wires) {
          try {
            wire.extended('swarm-space', encoded);
            delivered = true;
          } catch (error) {
            console.warn('[WebTorrentAdapter] Failed to send via wire extension', error);
          }
        }
      } catch (error) {
        console.warn('[WebTorrentAdapter] Unable to encode WebTorrent payload', error);
      }
    }

    if (!delivered && this.broadcast && this.localPeerId) {
      const envelope: BroadcastEnvelope = {
        type: channel,
        payload,
        from: this.localPeerId,
        target: peerId,
        transport: 'webtorrent',
      };
      try {
        this.broadcast.postMessage(envelope);
        delivered = true;
      } catch (error) {
        console.warn('[WebTorrentAdapter] Failed to broadcast fallback message', error);
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

  private async tryStartWebTorrent(): Promise<boolean> {
    try {
      const module = await import('webtorrent');
      const WebTorrentCtor: typeof WebTorrent = module?.default ?? (module as unknown as typeof WebTorrent);
      if (!WebTorrentCtor) {
        return false;
      }
      this.client = new WebTorrentCtor({
        tracker: {
          announce: this.options.trackers ?? [],
        },
      });

      const magnet = this.createMagnetURI();
      const torrent = this.client.add(magnet, { announce: this.options.trackers ?? [] });
      this.attachTorrent(torrent);
      return true;
    } catch (error) {
      console.warn('[WebTorrentAdapter] Failed to initialize WebTorrent', error);
      this.updateStatus('degraded', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private attachTorrent(torrent: { wires: Array<{ peerId?: string; extended: (ext: string, payload: Uint8Array) => void }>; on: (event: string, handler: (...args: unknown[]) => void) => void; destroy: () => void }): void {
    this.torrent = torrent;
    try {
      torrent.on('wire', (wire: { peerId?: string }) => {
        if (wire.peerId) {
          this.peerIds.add(wire.peerId);
          this.emitPeerUpdate();
        }
      });
    } catch (error) {
      console.warn('[WebTorrentAdapter] Failed to attach wire listener', error);
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
      if (!data || data.transport !== 'webtorrent') {
        return;
      }
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
    const handlers = this.messageHandlers.get(channel);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      try {
        handler(peerId, payload);
      } catch (error) {
        console.warn('[WebTorrentAdapter] Message handler failed', error);
      }
    }
  }

  private emitPeerUpdate(): void {
    const peers = Array.from(this.peerIds);
    for (const listener of this.peerListeners) {
      try {
        listener(peers);
      } catch (error) {
        console.warn('[WebTorrentAdapter] Peer listener failed', error);
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
        console.warn('[WebTorrentAdapter] Status listener failed', listenerError);
      }
    }
  }

  private createMagnetURI(): string {
    const swarmId = this.options.swarmId || 'swarm-space';
    return `magnet:?xt=urn:btih:${encodeURIComponent(swarmId)}`;
  }
}
