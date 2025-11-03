import { recordP2PDiagnostic } from "./diagnostics";
import type { VerificationProofEnvelope } from "@/types/verification";

type VerificationSyncMessageType = "verification:update";

interface VerificationSyncMessage {
  type: VerificationSyncMessageType;
  envelope: VerificationProofEnvelope;
}

type SendMessageFn = (peerId: string, message: VerificationSyncMessage) => boolean;
type ConnectedPeersFn = () => string[];

export interface VerificationEnvelopeEvent {
  peerId: string;
  envelope: VerificationProofEnvelope;
}

type VerificationListener = (event: VerificationEnvelopeEvent) => void;

export class VerificationSync {
  private readonly messageType: VerificationSyncMessageType = "verification:update";
  private readonly listeners = new Set<VerificationListener>();
  private latestEnvelope: VerificationProofEnvelope | null = null;

  constructor(
    private readonly sendMessage: SendMessageFn,
    private readonly getConnectedPeers: ConnectedPeersFn,
  ) {}

  setLocalEnvelope(envelope: VerificationProofEnvelope | null): void {
    this.latestEnvelope = envelope;
  }

  broadcastEnvelope(envelope: VerificationProofEnvelope): void {
    this.latestEnvelope = envelope;
    const peers = this.getConnectedPeers();
    if (peers.length === 0) {
      return;
    }

    const payload: VerificationSyncMessage = {
      type: this.messageType,
      envelope,
    };

    recordP2PDiagnostic({
      level: "info",
      source: "verification-sync",
      code: "verification-broadcast",
      message: "Broadcasting verification envelope to peers",
      context: { peerCount: peers.length, issuedAt: envelope.payload.issuedAt },
    });

    peers.forEach((peerId) => {
      const sent = this.sendMessage(peerId, payload);
      if (!sent) {
        recordP2PDiagnostic({
          level: "warn",
          source: "verification-sync",
          code: "verification-send-failed",
          message: "Failed to send verification envelope to peer",
          context: { peerId },
        });
      }
    });
  }

  handlePeerConnected(peerId: string): void {
    if (!this.latestEnvelope) {
      return;
    }

    const sent = this.sendMessage(peerId, {
      type: this.messageType,
      envelope: this.latestEnvelope,
    });

    if (!sent) {
      recordP2PDiagnostic({
        level: "warn",
        source: "verification-sync",
        code: "verification-send-failed",
        message: "Failed to send verification envelope to newly connected peer",
        context: { peerId },
      });
    }
  }

  handleMessage(peerId: string, payload: unknown): void {
    if (!this.isVerificationMessage(payload)) {
      return;
    }

    recordP2PDiagnostic({
      level: "info",
      source: "verification-sync",
      code: "verification-received",
      message: "Received verification envelope from peer",
      context: { peerId, issuedAt: payload.envelope.payload.issuedAt },
    });

    this.emit({ peerId, envelope: payload.envelope });
  }

  subscribe(listener: VerificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  reset(): void {
    this.latestEnvelope = null;
    this.listeners.clear();
  }

  private emit(event: VerificationEnvelopeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn("[VerificationSync] Listener threw", error);
      }
    }
  }

  private isVerificationMessage(message: unknown): message is VerificationSyncMessage {
    if (!message || typeof message !== "object" || !("type" in message)) {
      return false;
    }

    const typed = message as { type: string };
    return typed.type === this.messageType;
  }
}
