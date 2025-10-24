/**
 * P2P Signaling Layer
 * Uses BroadcastChannel for same-origin tab communication
 * Can be extended with WebSocket relay for internet-wide signaling
 */

export type SignalingMessageType =
  | 'announce'      // Announce presence
  | 'offer'         // WebRTC offer
  | 'answer'        // WebRTC answer
  | 'ice'           // ICE candidate
  | 'query'         // Query for content
  | 'available'     // Announce available content
  | 'goodbye';      // Peer leaving

export interface SignalingPayloadMap {
  announce: { availableContent: string[] };
  offer: { offer: RTCSessionDescriptionInit };
  answer: { answer: RTCSessionDescriptionInit };
  ice: { candidate: RTCIceCandidateInit };
  query: { manifestHash: string };
  available: { manifestHashes: string[] };
  goodbye: Record<string, never>;
}

type SignalingMessageBase = {
  from: string;        // Peer ID
  to?: string;         // Target peer ID (optional, for direct messages)
  userId: string;      // User ID of sender
  timestamp: number;
};

export type SignalingMessage = {
  [K in SignalingMessageType]: SignalingMessageBase & {
    type: K;
    payload: SignalingPayloadMap[K];
  };
}[SignalingMessageType];

type SignalingMessageHandlers = {
  [K in SignalingMessageType]: (msg: Extract<SignalingMessage, { type: K }>) => void;
};

export interface PeerAnnouncement {
  peerId: string;
  userId: string;
  availableContent: string[]; // manifest hashes
}

export class SignalingChannel {
  private channel: BroadcastChannel;
  private localPeerId: string;
  private localUserId: string;
  private messageHandlers: Partial<SignalingMessageHandlers> = {};
  private knownPeers: Set<string> = new Set();

  constructor(localPeerId: string, localUserId: string, channelName: string = 'imagination-network-p2p') {
    this.localPeerId = localPeerId;
    this.localUserId = localUserId;
    this.channel = new BroadcastChannel(channelName);
    
    this.channel.onmessage = (event) => {
      this.handleMessage(event.data as SignalingMessage);
    };
    
    console.log(`[Signaling] Initialized for peer ${localPeerId}`);
  }

  /**
   * Send a signaling message
   */
  send<K extends SignalingMessageType>(
    type: K,
    payload: SignalingPayloadMap[K],
    targetPeerId?: string
  ): void {
    const message: Extract<SignalingMessage, { type: K }> = {
      type,
      from: this.localPeerId,
      to: targetPeerId,
      userId: this.localUserId,
      payload,
      timestamp: Date.now()
    };
    
    console.log(`[Signaling] Sending ${type} message`, targetPeerId ? `to ${targetPeerId}` : 'broadcast');
    this.channel.postMessage(message);
  }

  /**
   * Announce presence to all peers
   */
  announce(availableContent: string[] = []): void {
    this.send('announce', {
      availableContent
    });
  }

  /**
   * Send WebRTC offer
   */
  sendOffer(targetPeerId: string, offer: RTCSessionDescriptionInit): void {
    this.send('offer', { offer }, targetPeerId);
  }

  /**
   * Send WebRTC answer
   */
  sendAnswer(targetPeerId: string, answer: RTCSessionDescriptionInit): void {
    this.send('answer', { answer }, targetPeerId);
  }

  /**
   * Send ICE candidate
   */
  sendIceCandidate(targetPeerId: string, candidate: RTCIceCandidateInit): void {
    this.send('ice', { candidate }, targetPeerId);
  }

  /**
   * Query for specific content
   */
  queryContent(manifestHash: string): void {
    this.send('query', { manifestHash });
  }

  /**
   * Announce available content
   */
  announceContent(manifestHashes: string[]): void {
    this.send('available', { manifestHashes });
  }

  /**
   * Announce departure
   */
  goodbye(): void {
    this.send('goodbye', {});
  }

  /**
   * Register a handler for a specific message type
   */
  on<K extends SignalingMessageType>(
    type: K,
    handler: SignalingMessageHandlers[K]
  ): void {
    this.messageHandlers[type] = handler;
  }

  /**
   * Get list of known peers
   */
  getKnownPeers(): string[] {
    return Array.from(this.knownPeers);
  }

  /**
   * Close the signaling channel
   */
  close(): void {
    this.goodbye();
    this.channel.close();
    console.log(`[Signaling] Channel closed for peer ${this.localPeerId}`);
  }

  // Private methods

  private handleMessage(message: SignalingMessage): void {
    // Ignore own messages
    if (message.from === this.localPeerId) {
      return;
    }

    // Check if message is targeted to us
    if (message.to && message.to !== this.localPeerId) {
      return;
    }

    console.log(`[Signaling] Received ${message.type} from ${message.from}`);

    // Track known peers
    if (message.type === 'announce') {
      this.knownPeers.add(message.from);
    } else if (message.type === 'goodbye') {
      this.knownPeers.delete(message.from);
    }

    // Call registered handler
    const handler = this.messageHandlers[message.type] as
      | SignalingMessageHandlers[typeof message.type]
      | undefined;
    if (handler) {
      handler(message as Extract<SignalingMessage, { type: typeof message.type }>);
    }
  }
}

/**
 * Helper to generate a unique peer ID
 */
const PEER_ID_STORAGE_KEY = "p2p-peer-id";

export function generatePeerId(): string {
  const createPeerId = () => `peer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  if (typeof window === "undefined") {
    return createPeerId();
  }

  try {
    const existing = window.sessionStorage.getItem(PEER_ID_STORAGE_KEY);
    if (existing) {
      return existing;
    }

    const peerId = createPeerId();
    window.sessionStorage.setItem(PEER_ID_STORAGE_KEY, peerId);
    return peerId;
  } catch (error) {
    console.warn("[Signaling] Unable to persist peer ID to sessionStorage:", error);
    return createPeerId();
  }
}
