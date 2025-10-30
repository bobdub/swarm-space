/**
 * Connection Health Monitor
 * 
 * Monitors peer connections and handles automatic reconnection
 */

export interface ConnectionHealth {
  peerId: string;
  connectedAt: number;
  lastActivity: number;
  pingsSent: number;
  pongsReceived: number;
  avgRtt: number; // Average round-trip time in ms
  status: 'healthy' | 'degraded' | 'stale';
}

export class ConnectionHealthMonitor {
  private connections: Map<string, ConnectionHealth> = new Map();
  private monitorInterval?: number;
  private onReconnectNeeded?: (peerId: string) => void;

  constructor(onReconnectNeeded?: (peerId: string) => void) {
    this.onReconnectNeeded = onReconnectNeeded;
  }

  /**
   * Start monitoring connections
   */
  start(): void {
    if (this.monitorInterval) return;
    
    console.log('[Health] Starting connection health monitor');
    
    this.monitorInterval = window.setInterval(() => {
      this.checkHealth();
    }, 45000); // Check every 45 seconds to reduce overhead
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }
    this.connections.clear();
  }

  /**
   * Register a new connection
   */
  registerConnection(peerId: string): void {
    console.log(`[Health] Registering connection: ${peerId}`);
    
    this.connections.set(peerId, {
      peerId,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      pingsSent: 0,
      pongsReceived: 0,
      avgRtt: 0,
      status: 'healthy'
    });
  }

  /**
   * Update connection activity
   */
  updateActivity(peerId: string): void {
    const conn = this.connections.get(peerId);
    if (conn) {
      conn.lastActivity = Date.now();
      conn.status = 'healthy';
    }
  }

  /**
   * Record a ping sent
   */
  recordPing(peerId: string): void {
    const conn = this.connections.get(peerId);
    if (conn) {
      conn.pingsSent++;
      conn.lastActivity = Date.now();
    }
  }

  /**
   * Record a pong received and calculate RTT
   */
  recordPong(peerId: string, rtt: number): void {
    const conn = this.connections.get(peerId);
    if (conn) {
      conn.pongsReceived++;
      conn.avgRtt = (conn.avgRtt * (conn.pongsReceived - 1) + rtt) / conn.pongsReceived;
      conn.lastActivity = Date.now();
      conn.status = 'healthy';
    }
  }

  /**
   * Remove a connection
   */
  removeConnection(peerId: string): void {
    console.log(`[Health] Removing connection: ${peerId}`);
    this.connections.delete(peerId);
  }

  /**
   * Get health stats for all connections
   */
  getStats() {
    const conns = Array.from(this.connections.values());
    
    return {
      total: conns.length,
      healthy: conns.filter(c => c.status === 'healthy').length,
      degraded: conns.filter(c => c.status === 'degraded').length,
      stale: conns.filter(c => c.status === 'stale').length,
      avgRtt: conns.length > 0
        ? (conns.reduce((sum, c) => sum + c.avgRtt, 0) / conns.length).toFixed(2)
        : '0'
    };
  }

  /**
   * Get health for specific connection
   */
  getConnectionHealth(peerId: string): ConnectionHealth | null {
    return this.connections.get(peerId) || null;
  }

  // Private methods

  private checkHealth(): void {
    const now = Date.now();
    const staleThreshold = 180000; // 3 minutes - increased for slower networks
    const degradedThreshold = 90000; // 1.5 minutes - increased for slower networks

    for (const [peerId, conn] of this.connections.entries()) {
      const timeSinceActivity = now - conn.lastActivity;

      if (timeSinceActivity > staleThreshold) {
        console.warn(`[Health] Connection stale: ${peerId} (${Math.floor(timeSinceActivity / 1000)}s)`);
        conn.status = 'stale';
        
        // Trigger reconnection
        if (this.onReconnectNeeded) {
          this.onReconnectNeeded(peerId);
        }
      } else if (timeSinceActivity > degradedThreshold) {
        console.warn(`[Health] Connection degraded: ${peerId} (${Math.floor(timeSinceActivity / 1000)}s)`);
        conn.status = 'degraded';
      } else {
        conn.status = 'healthy';
      }
    }

    // Log stats periodically
    const stats = this.getStats();
    if (this.connections.size > 0) {
      console.log('[Health] Stats:', stats);
    }
  }
}
