// Integrated transport: WebTorrent DHT + GUN signaling + WebRTC DataChannels
type WebTorrent = any;
type Gun = any;
type GunInstance = any;

import type {
  TransportMessageHandler,
  TransportPeerListener,
  TransportRuntimeStatus,
  TransportStateValue,
  TransportStatusListener,
} from './types';
import { SignalingBridge, type SignalingMessage } from './signalingBridge';

export interface IntegratedAdapterOptions {
  swarmId: string;
  trackers?: string[];
  gunPeers?: string[];
  channelName?: string;
}

interface PeerConnection {
  peerId: string;
  dataChannel: RTCDataChannel | null;
  peerConnection: RTCPeerConnection | null;
  state: 'discovering' | 'signaling' | 'connected' | 'failed';
  connectionTimeout?: ReturnType<typeof setTimeout>;
}

const DEFAULT_CHANNEL = 'swarm-space-integrated';

export class IntegratedAdapter {
  private webTorrentClient: WebTorrent | null = null;
  private gun: GunInstance | null = null;
  private signalingBridge: SignalingBridge | null = null;
  private broadcast: BroadcastChannel | null = null;
  private readonly peers = new Map<string, PeerConnection>();
  private readonly messageHandlers = new Map<string, Set<TransportMessageHandler>>();
  private readonly peerListeners = new Set<TransportPeerListener>();
  private readonly statusListeners = new Set<TransportStatusListener>();
  private status: TransportRuntimeStatus = { state: 'idle', lastError: null };
  private localPeerId: string | null = null;
  private teardownListeners: Array<() => void> = [];

  constructor(private readonly options: IntegratedAdapterOptions) {}

  async start(context: { peerId: string }): Promise<void> {
    if (this.localPeerId === context.peerId && this.status.state !== 'idle') {
      return;
    }

    this.localPeerId = context.peerId;
    this.updateStatus('initializing');

    // Start GUN first (needed for signaling)
    const gunStarted = await this.tryStartGun();
    if (!gunStarted) {
      this.updateStatus('degraded', 'GUN unavailable - signaling disabled');
      this.ensureBroadcastChannel();
      return;
    }

    // Initialize signaling bridge
    if (this.gun) {
      this.signalingBridge = new SignalingBridge({
        gun: this.gun,
        localPeerId: context.peerId,
      });
      const cleanupFallback = this.signalingBridge.onAnySignal((message) => {
        void this.handleIncomingSignal(message);
      });
      this.teardownListeners.push(cleanupFallback);
    }

    // Start WebTorrent for peer discovery
    const wtStarted = await this.tryStartWebTorrent();
    if (!wtStarted) {
      this.updateStatus('degraded', 'WebTorrent unavailable - using GUN mesh only');
    } else {
      this.updateStatus('ready');
    }

    this.ensureBroadcastChannel();
  }

  connectToPeer(peerId: string): void {
    if (!peerId || peerId === this.localPeerId) {
      return;
    }
    const existing = this.peers.get(peerId);
    if (existing?.state === 'connected' || existing?.state === 'signaling') {
      return;
    }

    const peer = this.getOrCreatePeer(peerId);
    this.initiateWebRTC(peer.peerId);
  }

  stop(): void {
    this.broadcast?.close();
    this.broadcast = null;

    // Clean up all peer connections
    for (const peer of this.peers.values()) {
      this.disconnectPeer(peer.peerId);
    }
    this.peers.clear();

    // Clean up signaling bridge
    this.signalingBridge?.destroy();
    this.signalingBridge = null;

    // Clean up WebTorrent
    if (this.webTorrentClient) {
      try {
        this.webTorrentClient.destroy();
      } catch (error) {
        console.warn('[IntegratedAdapter] Failed to destroy WebTorrent', error);
      }
      this.webTorrentClient = null;
    }

    // Clean up GUN
    if (typeof (this.gun as { close?: () => void } | null)?.close === 'function') {
      try {
        (this.gun as { close?: () => void } | null)?.close?.();
      } catch (error) {
        console.warn('[IntegratedAdapter] Failed to close GUN', error);
      }
    }
    this.gun = null;

    this.localPeerId = null;
    this.updateStatus('idle');

    for (const teardown of this.teardownListeners) {
      try {
        teardown();
      } catch (error) {
        console.warn('[IntegratedAdapter] Teardown listener failed', error);
      }
    }
    this.teardownListeners = [];
  }

  send(channel: string, peerId: string, payload: unknown): 'confirmed' | 'relayed' | 'failed' {
    let confirmedDelivery = false;
    let relayedDelivery = false;

    // Try WebRTC DataChannel first (direct P2P)
    const peer = this.peers.get(peerId);
    if (peer?.dataChannel?.readyState === 'open') {
      try {
        const message = JSON.stringify({ channel, payload, from: this.localPeerId });
        peer.dataChannel.send(message);
        confirmedDelivery = true;
        this.updateStatus('active');
      } catch (error) {
        console.warn('[IntegratedAdapter] DataChannel send failed', error);
      }
    }

    // Fallback to GUN mesh relay
    if (!confirmedDelivery && this.gun && this.localPeerId) {
      try {
        const messageKey = `messages/${peerId}`;
        this.gun.get(messageKey).set({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          channel,
          payload,
          from: this.localPeerId,
          timestamp: Date.now(),
        } as never);
        this.updateStatus('active');
        relayedDelivery = true;
      } catch (error) {
        console.warn('[IntegratedAdapter] GUN relay failed', error);
      }
    }

    // Last resort: BroadcastChannel (same-origin tabs)
    if (!confirmedDelivery && this.broadcast && this.localPeerId) {
      try {
        this.broadcast.postMessage({
          channel,
          payload,
          from: this.localPeerId,
          target: peerId,
          transport: 'integrated',
        });
        confirmedDelivery = true;
      } catch (error) {
        console.warn('[IntegratedAdapter] BroadcastChannel failed', error);
      }
    }

    // Only short-circuit fallback chains when we have a confirmed delivery path.
    // Returning "relayed" after a mesh handoff allows legacy transports to retry
    // when the integrated mesh might not be active on the remote peer.
    if (confirmedDelivery) {
      return 'confirmed';
    }

    if (relayedDelivery) {
      return 'relayed';
    }

    return 'failed';
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
    listener(Array.from(this.peers.keys()));
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
      const WebTorrentCtor: any = module?.default ?? module;
      if (!WebTorrentCtor) {
        return false;
      }

      this.webTorrentClient = new WebTorrentCtor({
        tracker: { announce: this.options.trackers ?? [] },
      });

      const magnet = `magnet:?xt=urn:btih:${encodeURIComponent(this.options.swarmId)}`;
      const torrent = this.webTorrentClient.add(magnet, {
        announce: this.options.trackers ?? [],
      });

      torrent.on('wire', (wire: { peerId?: string }) => {
        if (wire.peerId && wire.peerId !== this.localPeerId) {
          this.onPeerDiscovered(wire.peerId);
        }
      });

      return true;
    } catch (error) {
      console.warn('[IntegratedAdapter] WebTorrent init failed', error);
      return false;
    }
  }

  private async tryStartGun(): Promise<boolean> {
    try {
      const GunCtor = await this.resolveGunConstructor();
      if (!GunCtor) {
        return false;
      }

      this.gun = GunCtor({
        peers: this.options.gunPeers ?? [],
        radisk: false,
        localStorage: false,
      });

      // Listen for GUN relay messages
      if (this.localPeerId) {
        const messageKey = `messages/${this.localPeerId}`;
        const listener = (data: { id: string; channel: string; payload: unknown; from: string; timestamp: number }) => {
          if (!data || !data.from || data.from === this.localPeerId) {
            return;
          }
          this.emitMessage(data.channel, data.from, data.payload);
        };
        this.gun.get(messageKey).map().on(listener);
        this.teardownListeners.push(() => {
          try {
            this.gun?.get(messageKey).off();
          } catch (error) {
            console.warn('[IntegratedAdapter] Failed to detach GUN listener', error);
          }
        });
      }

      return true;
    } catch (error) {
      console.warn('[IntegratedAdapter] GUN init failed', error);
      return false;
    }
  }

  private async resolveGunConstructor(): Promise<any | null> {
    if (typeof window === 'undefined') {
      return null;
    }

    const typedWindow = window as typeof window & { Gun?: any };
    if (typedWindow.Gun) {
      return typedWindow.Gun;
    }

    const localGun = await import('gun')
      .then((module: any) => module?.default ?? module)
      .catch((error) => {
        console.warn('[IntegratedAdapter] Failed to load local GUN module', error);
        return null;
      });

    if (localGun) {
      typedWindow.Gun = localGun;
      return localGun;
    }

    try {
      await this.loadGunFromCdn('https://cdn.jsdelivr.net/npm/gun/gun.js');
    } catch (error) {
      console.warn('[IntegratedAdapter] Failed to load GUN from CDN', error);
      return null;
    }

    return typedWindow.Gun ?? null;
  }

  private loadGunFromCdn(url: string): Promise<void> {
    if (typeof document === 'undefined') {
      return Promise.reject(new Error('Document is unavailable'));
    }

    const existingScript = document.querySelector<HTMLScriptElement>(`script[data-integrated-gun="${url}"]`);
    if (existingScript?.dataset.loaded === 'true') {
      return Promise.resolve();
    }

    if (existingScript) {
      return new Promise((resolve, reject) => {
        existingScript.addEventListener('load', () => resolve(), { once: true });
        existingScript.addEventListener('error', () => reject(new Error('GUN script failed to load')), {
          once: true,
        });
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.dataset.integratedGun = url;
      script.addEventListener(
        'load',
        () => {
          script.dataset.loaded = 'true';
          resolve();
        },
        { once: true },
      );
      script.addEventListener(
        'error',
        () => {
          script.remove();
          reject(new Error('GUN script failed to load'));
        },
        { once: true },
      );
      document.head.appendChild(script);
    });
  }

  private onPeerDiscovered(peerId: string): void {
    if (this.peers.has(peerId)) {
      return;
    }

    console.log('[IntegratedAdapter] Peer discovered via DHT:', peerId);

    const peerConnection: PeerConnection = {
      peerId,
      dataChannel: null,
      peerConnection: null,
      state: 'discovering',
    };
    this.peers.set(peerId, peerConnection);
    this.emitPeerUpdate();

    // Initiate WebRTC connection via GUN signaling
    this.initiateWebRTC(peerId);
  }

  private async initiateWebRTC(remotePeerId: string): Promise<void> {
    if (!this.signalingBridge || !this.localPeerId) {
      return;
    }

    const peer = this.peers.get(remotePeerId);
    if (!peer) {
      return;
    }

    try {
      const pc = this.createPeerConnection(remotePeerId, peer);

      // Create data channel
      const dc = pc.createDataChannel('swarm-space');
      this.attachDataChannel(peer, dc, remotePeerId);

      // Handle incoming signaling
      const cleanupSignaling = this.signalingBridge.onSignal(remotePeerId, async (msg) => {
        try {
          if (msg.type === 'answer' && msg.sdp) {
            await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
          } else if (msg.type === 'ice-candidate' && msg.candidate) {
            await pc.addIceCandidate(msg.candidate);
          }
        } catch (error) {
          console.warn('[IntegratedAdapter] Signaling error', error);
        }
      });
      this.teardownListeners.push(cleanupSignaling);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const signalSent = await this.signalingBridge.sendSignal(remotePeerId, {
        type: 'offer',
        sdp: offer.sdp!,
      });

      if (!signalSent) {
        console.warn('[IntegratedAdapter] Failed to send WebRTC offer after retries');
        peer.state = 'failed';
        this.disconnectPeer(remotePeerId);
        return;
      }

      // Set connection timeout
      this.scheduleConnectionTimeout(peer, remotePeerId);
    } catch (error) {
      console.warn('[IntegratedAdapter] Failed to initiate WebRTC', error);
      peer.state = 'failed';
      this.disconnectPeer(remotePeerId);
      this.updateStatus('degraded', error instanceof Error ? error.message : String(error));
    }
  }

  private disconnectPeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) {
      return;
    }

    try {
      peer.dataChannel?.close();
      peer.peerConnection?.close();
    } catch (error) {
      console.warn('[IntegratedAdapter] Failed to close peer connection', error);
    }

    this.clearPeerTimeout(peer);

    this.peers.delete(peerId);
    this.emitPeerUpdate();
  }

  private getOrCreatePeer(remotePeerId: string): PeerConnection {
    let peer = this.peers.get(remotePeerId);
    if (!peer) {
      peer = {
        peerId: remotePeerId,
        dataChannel: null,
        peerConnection: null,
        state: 'discovering',
      };
      this.peers.set(remotePeerId, peer);
      this.emitPeerUpdate();
    }
    return peer;
  }

  private createPeerConnection(remotePeerId: string, peer: PeerConnection): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    peer.peerConnection = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalingBridge?.sendSignal(remotePeerId, {
          type: 'ice-candidate',
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        this.disconnectPeer(remotePeerId);
      }
    };

    pc.ondatachannel = (event) => {
      this.attachDataChannel(peer, event.channel, remotePeerId);
    };

    return pc;
  }

  private attachDataChannel(peer: PeerConnection, channel: RTCDataChannel, remotePeerId: string): void {
    peer.dataChannel = channel;
    peer.state = 'signaling';
    this.emitPeerUpdate();

    channel.onopen = () => {
      peer.state = 'connected';
      this.clearPeerTimeout(peer);
      this.emitPeerUpdate();
      this.updateStatus('active');
    };

    channel.onclose = () => {
      peer.state = 'failed';
      this.emitPeerUpdate();
      this.disconnectPeer(remotePeerId);
    };

    channel.onerror = () => {
      peer.state = 'failed';
      this.emitPeerUpdate();
      this.disconnectPeer(remotePeerId);
    };

    channel.onmessage = (event) => {
      try {
        const { channel: inboundChannel, payload, from } = JSON.parse(event.data);
        this.emitMessage(inboundChannel, from, payload);
      } catch (error) {
        console.warn('[IntegratedAdapter] Failed to parse DataChannel message', error);
      }
    };
  }

  private scheduleConnectionTimeout(peer: PeerConnection, remotePeerId: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.clearPeerTimeout(peer);

    peer.connectionTimeout = window.setTimeout(() => {
      if (peer.state !== 'connected') {
        console.warn('[IntegratedAdapter] WebRTC connection timeout');
        peer.state = 'failed';
        this.emitPeerUpdate();
        this.disconnectPeer(remotePeerId);
      }
    }, 30000) as any;
  }

  private clearPeerTimeout(peer: PeerConnection): void {
    if (peer.connectionTimeout) {
      clearTimeout(peer.connectionTimeout);
      peer.connectionTimeout = undefined;
    }
  }

  private async handleIncomingSignal(message: SignalingMessage): Promise<void> {
    if (!this.localPeerId || message.from === this.localPeerId) {
      return;
    }

    const peer = this.getOrCreatePeer(message.from);

    if (message.type === 'offer') {
      if (!message.sdp) {
        console.warn('[IntegratedAdapter] Received offer without SDP');
        return;
      }

      try {
        const pc = peer.peerConnection ?? this.createPeerConnection(message.from, peer);
        peer.state = 'signaling';
        this.emitPeerUpdate();

        await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.signalingBridge?.sendSignal(message.from, {
          type: 'answer',
          sdp: answer.sdp!,
        });

        this.scheduleConnectionTimeout(peer, message.from);
      } catch (error) {
        console.warn('[IntegratedAdapter] Failed to handle incoming offer', error);
        peer.state = 'failed';
        this.emitPeerUpdate();
        this.disconnectPeer(message.from);
      }
      return;
    }

    if (message.type === 'ice-candidate' && message.candidate) {
      if (!peer.peerConnection) {
        peer.peerConnection = this.createPeerConnection(message.from, peer);
      }
      try {
        await peer.peerConnection!.addIceCandidate(message.candidate);
      } catch (error) {
        console.warn('[IntegratedAdapter] Failed to add incoming ICE candidate', error);
      }
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

    const listener = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.transport !== 'integrated' || !data.from || data.from === this.localPeerId) {
        return;
      }
      if (data.target && data.target !== this.localPeerId) {
        return;
      }
      this.emitMessage(data.channel, data.from, data.payload);
    };

    this.broadcast.addEventListener('message', listener);
    this.teardownListeners.push(() => {
      this.broadcast?.removeEventListener('message', listener);
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
        console.warn('[IntegratedAdapter] Message handler failed', error);
      }
    }
  }

  private emitPeerUpdate(): void {
    const peerIds = Array.from(this.peers.keys());
    for (const listener of this.peerListeners) {
      try {
        listener(peerIds);
      } catch (error) {
        console.warn('[IntegratedAdapter] Peer listener failed', error);
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
        console.warn('[IntegratedAdapter] Status listener failed', listenerError);
      }
    }
  }
}
