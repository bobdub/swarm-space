/**
 * Connection Health Monitor — Light / Speed / Trust model
 */

export interface ConnectionHealth {
  peerId: string;
  connectedAt: number;
  lastActivity: number;
  pingsSent: number;
  pongsReceived: number;
  avgRtt: number;
  light: boolean;   // connected or handshake in progress
  speed: number;    // 1-100 (inverse of RTT, capped)
  trust: number;    // 0-1 (pong ratio)
  /** @deprecated kept for backward compat — always maps from light */
  status: 'healthy' | 'degraded' | 'stale';
}

export interface ConnectionHealthSummary {
  total: number;
  online: number;   // lights on
  offline: number;  // lights off (in map but no activity)
  avgSpeed: number; // 1-100
  avgTrust: number; // 0-1
  avgRttMs: number;
  avgPacketLoss: number;
  handshakeConfidence: number;
  /** @deprecated use online */
  healthy: number;
  /** @deprecated always 0 */
  degraded: number;
  /** @deprecated always 0 */
  stale: number;
}

import { recordP2PDiagnostic } from './diagnostics';

function computeSpeed(avgRtt: number): number {
  return Math.max(1, Math.min(100, Math.round(100 - Math.min(avgRtt, 990) / 10)));
}

function computeTrust(pingsSent: number, pongsReceived: number): number {
  return pingsSent > 0 ? Math.min(1, pongsReceived / pingsSent) : 1;
}

export class ConnectionHealthMonitor {
  private connections: Map<string, ConnectionHealth> = new Map();
  private monitorInterval?: number;
  private onReconnectNeeded?: (peerId: string) => void;

  constructor(onReconnectNeeded?: (peerId: string) => void) {
    this.onReconnectNeeded = onReconnectNeeded;
  }

  start(): void {
    if (this.monitorInterval) return;
    console.log('[Health] Starting connection health monitor');
    recordP2PDiagnostic({ level: 'info', source: 'health-monitor', code: 'monitor-start', message: 'Connection health monitor started' });
    this.monitorInterval = window.setInterval(() => { this.checkHealth(); }, 45000);
  }

  stop(): void {
    if (this.monitorInterval) { clearInterval(this.monitorInterval); this.monitorInterval = undefined; }
    this.connections.clear();
    recordP2PDiagnostic({ level: 'info', source: 'health-monitor', code: 'monitor-stop', message: 'Connection health monitor stopped' });
  }

  registerConnection(peerId: string): void {
    console.log(`[Health] Registering connection: ${peerId}`);
    recordP2PDiagnostic({ level: 'info', source: 'health-monitor', code: 'connection-register', message: 'Registered connection with health monitor', context: { peerId } });
    this.connections.set(peerId, {
      peerId,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      pingsSent: 0,
      pongsReceived: 0,
      avgRtt: 0,
      light: true,
      speed: 100,
      trust: 1,
      status: 'healthy',
    });
  }

  updateActivity(peerId: string): void {
    const conn = this.connections.get(peerId);
    if (conn) {
      conn.lastActivity = Date.now();
      conn.light = true;
      conn.status = 'healthy';
    }
  }

  recordPing(peerId: string): void {
    const conn = this.connections.get(peerId);
    if (conn) {
      conn.pingsSent++;
      conn.lastActivity = Date.now();
    }
  }

  recordPong(peerId: string, rtt: number): void {
    const conn = this.connections.get(peerId);
    if (conn) {
      conn.pongsReceived++;
      conn.avgRtt = (conn.avgRtt * (conn.pongsReceived - 1) + rtt) / conn.pongsReceived;
      conn.lastActivity = Date.now();
      conn.light = true;
      conn.speed = computeSpeed(conn.avgRtt);
      conn.trust = computeTrust(conn.pingsSent, conn.pongsReceived);
      conn.status = 'healthy';
    }
  }

  removeConnection(peerId: string): void {
    console.log(`[Health] Removing connection: ${peerId}`);
    this.connections.delete(peerId);
    recordP2PDiagnostic({ level: 'info', source: 'health-monitor', code: 'connection-remove', message: 'Removed connection from health monitor', context: { peerId } });
  }

  getStats(): ConnectionHealthSummary {
    const conns = Array.from(this.connections.values());
    const avgRtt = conns.length > 0 ? conns.reduce((s, c) => s + c.avgRtt, 0) / conns.length : 0;
    const totalPings = conns.reduce((s, c) => s + c.pingsSent, 0);
    const totalPongs = conns.reduce((s, c) => s + c.pongsReceived, 0);
    const avgPacketLoss = totalPings > 0 ? Math.max(0, 1 - totalPongs / totalPings) : 0;
    const responsivePeers = conns.filter(c => c.pongsReceived > 0).length;
    const handshakeConfidence = conns.length > 0 ? responsivePeers / conns.length : 0;

    const onlineCount = conns.filter(c => c.light).length;
    const avgSpeed = conns.length > 0 ? Math.round(conns.reduce((s, c) => s + c.speed, 0) / conns.length) : 0;
    const avgTrust = conns.length > 0 ? conns.reduce((s, c) => s + c.trust, 0) / conns.length : 0;

    return {
      total: conns.length,
      online: onlineCount,
      offline: conns.length - onlineCount,
      avgSpeed,
      avgTrust,
      avgRttMs: avgRtt,
      avgPacketLoss,
      handshakeConfidence,
      // deprecated compat
      healthy: onlineCount,
      degraded: 0,
      stale: 0,
    };
  }

  getConnectionHealth(peerId: string): ConnectionHealth | null {
    return this.connections.get(peerId) || null;
  }

  private checkHealth(): void {
    const n = Date.now();
    const staleThreshold = 180_000;

    for (const [peerId, conn] of this.connections.entries()) {
      const timeSinceActivity = n - conn.lastActivity;

      // Recompute speed/trust
      conn.speed = computeSpeed(conn.avgRtt);
      conn.trust = computeTrust(conn.pingsSent, conn.pongsReceived);

      if (timeSinceActivity > staleThreshold) {
        conn.light = false;
        conn.status = 'stale'; // compat
        recordP2PDiagnostic({ level: 'warn', source: 'health-monitor', code: 'connection-stale', message: 'Connection light off — stale', context: { peerId, timeSinceActivity } });
        if (this.onReconnectNeeded) this.onReconnectNeeded(peerId);
      } else {
        conn.light = true;
        conn.status = 'healthy';
      }
    }

    const stats = this.getStats();
    if (this.connections.size > 0) console.log('[Health] Stats:', stats);
  }
}
