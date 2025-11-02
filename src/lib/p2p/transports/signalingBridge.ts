// GUN-based WebRTC signaling exchange helper
type Gun = any;
type GunInstance = any;

export interface SignalingMessage {
  from: string;
  to: string;
  type: 'offer' | 'answer' | 'ice-candidate';
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  timestamp: number;
}

export interface SignalingBridgeOptions {
  gun: GunInstance;
  localPeerId: string;
  signalingKey?: string;
}

export class SignalingBridge {
  private readonly gun: GunInstance;
  private readonly localPeerId: string;
  private readonly signalingKey: string;
  private readonly handlers = new Map<string, (msg: SignalingMessage) => void>();
  private cleanupFn: (() => void) | null = null;

  constructor(options: SignalingBridgeOptions) {
    this.gun = options.gun;
    this.localPeerId = options.localPeerId;
    this.signalingKey = options.signalingKey ?? 'swarm-space/signaling';
    this.attachListener();
  }

  private attachListener(): void {
    const channel = this.gun.get(this.signalingKey);
    const listener = (data: SignalingMessage & { _: unknown }) => {
      if (!data || typeof data !== 'object' || data._ === undefined) {
        return;
      }
      if (data.to !== this.localPeerId) {
        return;
      }
      if (!data.from || data.from === this.localPeerId) {
        return;
      }
      const handler = this.handlers.get(data.from);
      if (handler) {
        try {
          handler(data);
        } catch (error) {
          console.warn('[SignalingBridge] Handler failed', error);
        }
      }
    };
    channel.map().on(listener);
    this.cleanupFn = () => {
      try {
        channel.off();
      } catch (error) {
        console.warn('[SignalingBridge] Failed to detach listener', error);
      }
    };
  }

  sendSignal(targetPeerId: string, message: Omit<SignalingMessage, 'from' | 'to' | 'timestamp'>): void {
    const envelope: SignalingMessage = {
      ...message,
      from: this.localPeerId,
      to: targetPeerId,
      timestamp: Date.now(),
    };
    try {
      this.gun.get(this.signalingKey).set(envelope as never);
    } catch (error) {
      console.warn('[SignalingBridge] Failed to send signal', error);
    }
  }

  onSignal(remotePeerId: string, handler: (msg: SignalingMessage) => void): () => void {
    this.handlers.set(remotePeerId, handler);
    return () => {
      this.handlers.delete(remotePeerId);
    };
  }

  destroy(): void {
    if (this.cleanupFn) {
      this.cleanupFn();
      this.cleanupFn = null;
    }
    this.handlers.clear();
  }
}
