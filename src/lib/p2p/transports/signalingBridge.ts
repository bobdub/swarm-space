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
  signalingTimeoutMs?: number;
  maxRetries?: number;
}

export class SignalingBridge {
  private readonly gun: GunInstance;
  private readonly localPeerId: string;
  private readonly signalingKey: string;
  private readonly signalingTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly handlers = new Map<string, (msg: SignalingMessage) => void>();
  private readonly pendingSignals = new Map<string, { timer: ReturnType<typeof setTimeout>; retries: number }>();
  private cleanupFn: (() => void) | null = null;

  constructor(options: SignalingBridgeOptions) {
    this.gun = options.gun;
    this.localPeerId = options.localPeerId;
    this.signalingKey = options.signalingKey ?? 'swarm-space/signaling';
    this.signalingTimeoutMs = options.signalingTimeoutMs ?? 15000; // 15 seconds default
    this.maxRetries = options.maxRetries ?? 2;
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

  sendSignal(targetPeerId: string, message: Omit<SignalingMessage, 'from' | 'to' | 'timestamp'>): Promise<boolean> {
    return new Promise((resolve) => {
      const envelope: SignalingMessage = {
        ...message,
        from: this.localPeerId,
        to: targetPeerId,
        timestamp: Date.now(),
      };
      
      const signalId = `${targetPeerId}-${message.type}-${Date.now()}`;
      let retries = 0;

      const attemptSend = () => {
        try {
          this.gun.get(this.signalingKey).set(envelope as never);
          
          // Set timeout for acknowledgment
          const timer = setTimeout(() => {
            if (retries < this.maxRetries) {
              retries++;
              console.warn(`[SignalingBridge] Signal timeout, retry ${retries}/${this.maxRetries}`);
              attemptSend();
            } else {
              console.warn('[SignalingBridge] Signal failed after max retries');
              this.pendingSignals.delete(signalId);
              resolve(false);
            }
          }, this.signalingTimeoutMs);

          this.pendingSignals.set(signalId, { timer, retries });
          
          // Optimistically resolve after first send
          if (retries === 0) {
            resolve(true);
          }
        } catch (error) {
          console.warn('[SignalingBridge] Failed to send signal', error);
          if (retries < this.maxRetries) {
            retries++;
            setTimeout(attemptSend, 1000);
          } else {
            resolve(false);
          }
        }
      };

      attemptSend();
    });
  }

  acknowledgeSignal(signalId: string): void {
    const pending = this.pendingSignals.get(signalId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingSignals.delete(signalId);
    }
  }

  onSignal(remotePeerId: string, handler: (msg: SignalingMessage) => void): () => void {
    this.handlers.set(remotePeerId, handler);
    return () => {
      this.handlers.delete(remotePeerId);
    };
  }

  destroy(): void {
    // Clear all pending signal timers
    for (const [_, pending] of this.pendingSignals) {
      clearTimeout(pending.timer);
    }
    this.pendingSignals.clear();

    if (this.cleanupFn) {
      this.cleanupFn();
      this.cleanupFn = null;
    }
    this.handlers.clear();
  }
}
