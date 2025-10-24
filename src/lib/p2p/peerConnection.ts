/**
 * WebRTC Peer Connection Manager
 * Handles the lifecycle of peer-to-peer connections
 */

export interface PeerConnectionConfig {
  iceServers: RTCIceServer[];
  maxRetries: number;
  connectionTimeout: number;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'failed';

export interface PeerInfo {
  id: string;
  userId: string;
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  state: ConnectionState;
  availableContent: Set<string>;
  lastSeen: Date;
  rtt: number;
  retryCount: number;
}

export class PeerConnectionManager {
  private peers: Map<string, PeerInfo> = new Map();
  private config: PeerConnectionConfig;
  private localUserId: string;
  private onMessageCallback?: (peerId: string, message: any) => void;
  private onStateChangeCallback?: (peerId: string, state: ConnectionState) => void;

  constructor(localUserId: string, config?: Partial<PeerConnectionConfig>) {
    this.localUserId = localUserId;
    this.config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ],
      maxRetries: 3,
      connectionTimeout: 10000,
      ...config
    };
  }

  /**
   * Create a new peer connection as the initiator
   */
  async createOffer(peerId: string, remoteUserId: string): Promise<RTCSessionDescriptionInit> {
    console.log(`[P2P] Creating offer for peer ${peerId}`);
    
    const pc = this.createPeerConnection(peerId, remoteUserId);
    const dc = pc.createDataChannel('chunks', {
      ordered: true,
      maxRetransmits: 3
    });
    
    this.setupDataChannel(peerId, dc);
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    return offer;
  }

  /**
   * Accept an incoming connection offer
   */
  async acceptOffer(
    peerId: string,
    remoteUserId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit> {
    console.log(`[P2P] Accepting offer from peer ${peerId}`);
    
    const pc = this.createPeerConnection(peerId, remoteUserId);
    
    // Data channel will be created by remote peer
    pc.ondatachannel = (event) => {
      console.log(`[P2P] Data channel received from ${peerId}`);
      this.setupDataChannel(peerId, event.channel);
    };
    
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    return answer;
  }

  /**
   * Complete the connection with the remote answer
   */
  async acceptAnswer(peerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    console.log(`[P2P] Accepting answer from peer ${peerId}`);
    
    const peer = this.peers.get(peerId);
    if (!peer) {
      throw new Error(`Peer ${peerId} not found`);
    }
    
    await peer.connection.setRemoteDescription(answer);
  }

  /**
   * Add an ICE candidate
   */
  async addIceCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      console.warn(`[P2P] Cannot add ICE candidate, peer ${peerId} not found`);
      return;
    }
    
    try {
      await peer.connection.addIceCandidate(candidate);
    } catch (error) {
      console.error(`[P2P] Error adding ICE candidate for ${peerId}:`, error);
    }
  }

  /**
   * Send a message to a peer
   */
  sendMessage(peerId: string, message: any): boolean {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.dataChannel || peer.dataChannel.readyState !== 'open') {
      console.warn(`[P2P] Cannot send message, peer ${peerId} not ready`);
      return false;
    }
    
    try {
      peer.dataChannel.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error(`[P2P] Error sending message to ${peerId}:`, error);
      return false;
    }
  }

  /**
   * Close connection to a peer
   */
  closePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    
    console.log(`[P2P] Closing connection to peer ${peerId}`);
    
    if (peer.dataChannel) {
      peer.dataChannel.close();
    }
    peer.connection.close();
    this.peers.delete(peerId);
    
    this.onStateChangeCallback?.(peerId, 'disconnected');
  }

  /**
   * Get all connected peers
   */
  getConnectedPeers(): PeerInfo[] {
    return Array.from(this.peers.values()).filter(p => p.state === 'connected');
  }

  /**
   * Get peer info by ID
   */
  getPeer(peerId: string): PeerInfo | undefined {
    return this.peers.get(peerId);
  }

  /**
   * Set callback for incoming messages
   */
  onMessage(callback: (peerId: string, message: any) => void): void {
    this.onMessageCallback = callback;
  }

  /**
   * Set callback for connection state changes
   */
  onStateChange(callback: (peerId: string, state: ConnectionState) => void): void {
    this.onStateChangeCallback = callback;
  }

  /**
   * Update peer's available content
   */
  updatePeerContent(peerId: string, manifestHashes: string[]): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.availableContent = new Set(manifestHashes);
      peer.lastSeen = new Date();
    }
  }

  /**
   * Find peers that have specific content
   */
  findPeersWithContent(manifestHash: string): PeerInfo[] {
    return this.getConnectedPeers().filter(p => p.availableContent.has(manifestHash));
  }

  /**
   * Cleanup disconnected peers
   */
  cleanup(maxAge: number = 300000): void {
    const now = Date.now();
    for (const [peerId, peer] of this.peers.entries()) {
      if (peer.state === 'disconnected' && now - peer.lastSeen.getTime() > maxAge) {
        console.log(`[P2P] Cleaning up stale peer ${peerId}`);
        this.closePeer(peerId);
      }
    }
  }

  // Private methods

  private createPeerConnection(peerId: string, remoteUserId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.config.iceServers });
    
    const peerInfo: PeerInfo = {
      id: peerId,
      userId: remoteUserId,
      connection: pc,
      dataChannel: null,
      state: 'connecting',
      availableContent: new Set(),
      lastSeen: new Date(),
      rtt: 0,
      retryCount: 0
    };
    
    this.peers.set(peerId, peerInfo);
    
    // Connection state monitoring
    pc.onconnectionstatechange = () => {
      console.log(`[P2P] Connection state for ${peerId}: ${pc.connectionState}`);
      this.updateConnectionState(peerId, pc.connectionState);
    };
    
    pc.oniceconnectionstatechange = () => {
      console.log(`[P2P] ICE state for ${peerId}: ${pc.iceConnectionState}`);
    };
    
    pc.onicegatheringstatechange = () => {
      console.log(`[P2P] ICE gathering state for ${peerId}: ${pc.iceGatheringState}`);
    };
    
    // ICE candidate handling - will be sent via signaling
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[P2P] New ICE candidate for ${peerId}`);
        // ICE candidates will be sent via signaling layer
      }
    };
    
    return pc;
  }

  private setupDataChannel(peerId: string, dc: RTCDataChannel): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    
    peer.dataChannel = dc;
    
    dc.onopen = () => {
      console.log(`[P2P] Data channel open for ${peerId}`);
      peer.state = 'connected';
      peer.lastSeen = new Date();
      this.onStateChangeCallback?.(peerId, 'connected');
    };
    
    dc.onclose = () => {
      console.log(`[P2P] Data channel closed for ${peerId}`);
      peer.state = 'disconnected';
      this.onStateChangeCallback?.(peerId, 'disconnected');
    };
    
    dc.onerror = (error) => {
      console.error(`[P2P] Data channel error for ${peerId}:`, error);
      peer.state = 'failed';
      this.onStateChangeCallback?.(peerId, 'failed');
    };
    
    dc.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        peer.lastSeen = new Date();
        this.onMessageCallback?.(peerId, message);
      } catch (error) {
        console.error(`[P2P] Error parsing message from ${peerId}:`, error);
      }
    };
  }

  private updateConnectionState(peerId: string, state: RTCPeerConnectionState): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    
    switch (state) {
      case 'connected':
        peer.state = 'connected';
        peer.retryCount = 0;
        break;
      case 'disconnected':
        peer.state = 'disconnected';
        break;
      case 'failed':
        peer.state = 'failed';
        if (peer.retryCount < this.config.maxRetries) {
          console.log(`[P2P] Connection failed for ${peerId}, will retry`);
          peer.retryCount++;
        } else {
          console.log(`[P2P] Max retries reached for ${peerId}, giving up`);
          this.closePeer(peerId);
        }
        break;
    }
    
    this.onStateChangeCallback?.(peerId, peer.state);
  }
}
