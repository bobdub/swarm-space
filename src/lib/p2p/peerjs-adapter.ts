/**
 * PeerJS Adapter for P2P Networking
 * 
 * Uses PeerJS's cloud-hosted signaling server for cross-device discovery
 * while maintaining direct P2P data channels for actual content transfer.
 * 
 * PeerJS provides:
 * - Zero-configuration signaling (no .env files needed)
 * - Cross-device WebRTC discovery
 * - Automatic NAT traversal (STUN/TURN)
 * - Reliable connection management
 * 
 * Note: Initial peer discovery uses PeerJS cloud infrastructure.
 * Once connected, all data flows directly peer-to-peer.
 */

import Peer, { DataConnection } from 'peerjs';

export interface PeerJSMessage {
  type: string;
  payload: unknown;
  from: string;
  timestamp: number;
}

export interface PeerInfo {
  id: string;
  userId: string;
  connection: DataConnection;
}

export class PeerJSAdapter {
  private peer: Peer | null = null;
  private connections = new Map<string, DataConnection>();
  private messageHandlers = new Map<string, (msg: PeerJSMessage) => void>();
  private connectionHandlers: ((peerId: string) => void)[] = [];
  private disconnectionHandlers: ((peerId: string) => void)[] = [];
  private readyHandlers: (() => void)[] = [];
  private signalingDisconnectedHandlers: (() => void)[] = [];
  private localUserId: string;
  private peerId: string | null = null;
  private isSignalingConnected = false;

  constructor(localUserId: string) {
    this.localUserId = localUserId;
    console.log('[PeerJS] Initializing adapter for user:', localUserId);
  }

  /**
   * Initialize PeerJS with default cloud signaling (with retry)
   */
  async initialize(retryCount = 0, maxRetries = 3): Promise<string> {
    return new Promise((resolve, reject) => {
      const attempt = retryCount + 1;
      console.log(`[PeerJS] 🔌 Connecting to PeerJS cloud (attempt ${attempt}/${maxRetries + 1})...`);
      
      // Let PeerJS assign a fresh ID each time to avoid conflicts
      // Using alternative PeerJS server configuration for better reliability
      this.peer = new Peer({
        host: 'peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        debug: 2,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        },
        pingInterval: 5000
      });

      let resolved = false;
      let timeoutHandle: NodeJS.Timeout;

      const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      };

      this.peer.on('open', (id) => {
        cleanup();
        this.peerId = id;
        this.isSignalingConnected = true;
        
        console.log('[PeerJS] ✅ Connected! Peer ID:', id);
        console.log('[PeerJS] 🌐 Connected to signaling server successfully');
        this.readyHandlers.forEach(h => h());
        if (!resolved) {
          resolved = true;
          resolve(id);
        }
      });

      this.peer.on('error', (error) => {
        console.error('[PeerJS] ❌ Error:', error);
        console.error('[PeerJS] Error type:', error.type);
        console.error('[PeerJS] Error message:', error.message);
        
        if (!resolved && !this.peerId) {
          cleanup();
          resolved = true;
          
          // Retry on connection errors
          if (retryCount < maxRetries) {
            console.log(`[PeerJS] 🔄 Retrying connection (${retryCount + 1}/${maxRetries})...`);
            this.peer?.destroy();
            this.peer = null;
            
            // Progressive delay: 1s, 2s, 3s
            const delay = (retryCount + 1) * 1000;
            setTimeout(() => {
              this.initialize(retryCount + 1, maxRetries)
                .then(resolve)
                .catch(reject);
            }, delay);
          } else {
            console.error('[PeerJS] ❌ All retry attempts failed');
            this.peer?.destroy();
            this.peer = null;
            reject(new Error('PeerJS connection failed after retries: ' + (error.message || 'Network error')));
          }
        }
      });

      this.peer.on('connection', (conn) => {
        console.log('[PeerJS] Incoming connection from:', conn.peer);
        this.handleIncomingConnection(conn);
      });

      this.peer.on('disconnected', () => {
        console.log('[PeerJS] ⚠️ Disconnected from signaling server');
        this.isSignalingConnected = false;
        this.signalingDisconnectedHandlers.forEach(h => h());
        
        // Try to reconnect after a delay
        if (this.peer && this.peerId) {
          console.log('[PeerJS] 🔄 Attempting to reconnect...');
          setTimeout(() => {
            if (this.peer && !this.peer.destroyed) {
              this.peer.reconnect();
            }
          }, 3000);
        }
      });
      
      // Increased timeout to 30 seconds per attempt for better reliability
      timeoutHandle = setTimeout(() => {
        if (!resolved) {
          cleanup();
          resolved = true;
          
          // Retry on timeout
          if (retryCount < maxRetries) {
            console.log(`[PeerJS] ⏱️ Connection timeout, retrying (${retryCount + 1}/${maxRetries})...`);
            this.peer?.destroy();
            this.peer = null;
            
            const delay = (retryCount + 1) * 1000;
            setTimeout(() => {
              this.initialize(retryCount + 1, maxRetries)
                .then(resolve)
                .catch(reject);
            }, delay);
          } else {
            console.error('[PeerJS] ❌ Connection timeout after all retries');
            this.peer?.destroy();
            this.peer = null;
            reject(new Error('PeerJS connection timeout - signaling server may be temporarily unavailable. Please try again in a moment.'));
          }
        }
      }, 30000); // Increased from 15s to 30s
    });
  }

  /**
   * Connect to a remote peer by their peer ID
   */
  connectToPeer(remotePeerId: string): void {
    if (!this.peer) {
      console.error('[PeerJS] Cannot connect: not initialized');
      return;
    }

    if (this.connections.has(remotePeerId)) {
      console.log('[PeerJS] Already connected to', remotePeerId);
      return;
    }

    console.log('[PeerJS] Initiating connection to:', remotePeerId);
    const conn = this.peer.connect(remotePeerId, {
      reliable: true,
      metadata: { userId: this.localUserId }
    });

    this.handleIncomingConnection(conn);
  }

  /**
   * Handle incoming connection setup
   */
  private handleIncomingConnection(conn: DataConnection): void {
    conn.on('open', () => {
      console.log('[PeerJS] ✅ Connection established with:', conn.peer);
      this.connections.set(conn.peer, conn);
      this.connectionHandlers.forEach(h => h(conn.peer));
    });

    conn.on('data', (data) => {
      try {
        const message = data as PeerJSMessage;
        console.log(`[PeerJS] Received ${message.type} from ${conn.peer}`);
        
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
          handler(message);
        } else {
          console.warn('[PeerJS] No handler for message type:', message.type);
        }
      } catch (error) {
        console.error('[PeerJS] Error handling message:', error);
      }
    });

    conn.on('close', () => {
      console.log('[PeerJS] Connection closed:', conn.peer);
      this.connections.delete(conn.peer);
      this.disconnectionHandlers.forEach(h => h(conn.peer));
    });

    conn.on('error', (error) => {
      console.error('[PeerJS] Connection error with', conn.peer, ':', error);
      this.connections.delete(conn.peer);
      this.disconnectionHandlers.forEach(h => h(conn.peer));
    });
  }

  /**
   * Send message to specific peer
   */
  sendToPeer(peerId: string, type: string, payload: unknown): boolean {
    const conn = this.connections.get(peerId);
    if (!conn) {
      console.warn('[PeerJS] Cannot send to', peerId, '- not connected');
      return false;
    }

    const message: PeerJSMessage = {
      type,
      payload,
      from: this.peerId || 'unknown',
      timestamp: Date.now()
    };

    try {
      conn.send(message);
      console.log(`[PeerJS] Sent ${type} to ${peerId}`);
      return true;
    } catch (error) {
      console.error('[PeerJS] Error sending message:', error);
      return false;
    }
  }

  /**
   * Broadcast message to all connected peers
   */
  broadcast(type: string, payload: unknown): void {
    const message: PeerJSMessage = {
      type,
      payload,
      from: this.peerId || 'unknown',
      timestamp: Date.now()
    };

    let sent = 0;
    for (const [peerId, conn] of this.connections.entries()) {
      try {
        conn.send(message);
        sent++;
      } catch (error) {
        console.error(`[PeerJS] Error broadcasting to ${peerId}:`, error);
      }
    }
    
    console.log(`[PeerJS] Broadcast ${type} to ${sent} peer(s)`);
  }

  /**
   * Register message handler
   */
  onMessage(type: string, handler: (msg: PeerJSMessage) => void): void {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Register connection handler
   */
  onConnection(handler: (peerId: string) => void): void {
    this.connectionHandlers.push(handler);
  }

  /**
   * Register disconnection handler
   */
  onDisconnection(handler: (peerId: string) => void): void {
    this.disconnectionHandlers.push(handler);
  }

  /**
   * Register ready handler
   */
  onReady(handler: () => void): void {
    this.readyHandlers.push(handler);
    if (this.peerId) {
      handler(); // Already ready
    }
  }

  /**
   * Register signaling disconnected handler
   */
  onSignalingDisconnected(handler: () => void): void {
    this.signalingDisconnectedHandlers.push(handler);
  }

  /**
   * Check if signaling connection is active
   */
  isSignalingActive(): boolean {
    return this.isSignalingConnected && this.peer !== null && !this.peer.destroyed;
  }

  /**
   * Get current peer ID
   */
  getPeerId(): string | null {
    return this.peerId;
  }

  /**
   * Get connected peer IDs
   */
  getConnectedPeers(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * List all active peers on the PeerJS network
   * This enables automatic peer discovery without manual ID sharing
   */
  async listAllPeers(): Promise<string[]> {
    if (!this.peer) {
      console.error('[PeerJS] Cannot list peers: not initialized');
      return [];
    }

    return new Promise((resolve) => {
      try {
        // @ts-ignore - listAllPeers is available but not in types
        this.peer.listAllPeers((peers: string[]) => {
          console.log(`[PeerJS] 🔍 Discovered ${peers.length} active peers on network`);
          resolve(peers);
        });
      } catch (error) {
        console.error('[PeerJS] Error listing peers:', error);
        resolve([]);
      }
    });
  }

  /**
   * Check if connected to peer
   */
  isConnectedTo(peerId: string): boolean {
    return this.connections.has(peerId);
  }

  /**
   * Disconnect from specific peer
   */
  disconnectFrom(peerId: string): void {
    const conn = this.connections.get(peerId);
    if (conn) {
      console.log('[PeerJS] Disconnecting from:', peerId);
      conn.close();
      this.connections.delete(peerId);
    }
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    console.log('[PeerJS] Shutting down...');
    
    // Close all connections
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();

    // Destroy peer
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    this.peerId = null;
    console.log('[PeerJS] Shutdown complete');
  }
}
