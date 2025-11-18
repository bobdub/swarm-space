/**
 * Pending Connection Cleanup
 * 
 * Monitors and cleans up stuck pending connections that never complete.
 */

interface PendingConnectionEntry {
  peerId: string;
  startedAt: number;
  source: string;
}

const PENDING_TIMEOUT_MS = 30000; // 30s timeout for pending connections
const CLEANUP_INTERVAL_MS = 10000; // Check every 10s

/**
 * Pending connection monitor with automatic cleanup
 */
export class PendingConnectionMonitor {
  private pending = new Map<string, PendingConnectionEntry>();
  private cleanupInterval: number | null = null;
  private timeoutCallback: ((peerId: string, duration: number) => void) | null = null;

  /**
   * Start the cleanup monitor
   */
  start(onTimeout?: (peerId: string, duration: number) => void): void {
    if (this.cleanupInterval) return;

    this.timeoutCallback = onTimeout ?? null;
    this.cleanupInterval = window.setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);

    console.log('[PendingConnectionMonitor] Started');
  }

  /**
   * Stop the cleanup monitor
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.pending.clear();
  }

  /**
   * Add a pending connection
   */
  add(peerId: string, source: string = 'unknown'): void {
    if (this.pending.has(peerId)) {
      // Already pending, don't add duplicate
      return;
    }

    this.pending.set(peerId, {
      peerId,
      startedAt: Date.now(),
      source,
    });
  }

  /**
   * Remove a pending connection (completed or failed)
   */
  remove(peerId: string): void {
    this.pending.delete(peerId);
  }

  /**
   * Check if a peer connection is currently pending
   */
  isPending(peerId: string): boolean {
    return this.pending.has(peerId);
  }

  /**
   * Get all pending connections
   */
  getPending(): string[] {
    return Array.from(this.pending.keys());
  }

  /**
   * Get pending connection details
   */
  getEntry(peerId: string): PendingConnectionEntry | null {
    return this.pending.get(peerId) ?? null;
  }

  /**
   * Cleanup timed-out pending connections
   */
  private cleanup(): void {
    const now = Date.now();
    const timedOut: string[] = [];

    for (const [peerId, entry] of this.pending.entries()) {
      const duration = now - entry.startedAt;
      if (duration > PENDING_TIMEOUT_MS) {
        timedOut.push(peerId);
      }
    }

    if (timedOut.length > 0) {
      console.warn(
        `[PendingConnectionMonitor] Cleaning up ${timedOut.length} timed-out pending connections:`,
        timedOut
      );

      for (const peerId of timedOut) {
        const entry = this.pending.get(peerId);
        if (entry) {
          const duration = now - entry.startedAt;
          this.pending.delete(peerId);
          
          if (this.timeoutCallback) {
            try {
              this.timeoutCallback(peerId, duration);
            } catch (error) {
              console.error('[PendingConnectionMonitor] Timeout callback error:', error);
            }
          }
        }
      }
    }
  }

  /**
   * Get monitor stats
   */
  getStats(): {
    pendingCount: number;
    oldestPendingMs: number | null;
    avgPendingMs: number;
  } {
    const entries = Array.from(this.pending.values());
    const now = Date.now();

    if (entries.length === 0) {
      return {
        pendingCount: 0,
        oldestPendingMs: null,
        avgPendingMs: 0,
      };
    }

    const durations = entries.map(e => now - e.startedAt);
    return {
      pendingCount: entries.length,
      oldestPendingMs: Math.max(...durations),
      avgPendingMs: durations.reduce((sum, d) => sum + d, 0) / durations.length,
    };
  }
}

// Singleton instance
const monitor = new PendingConnectionMonitor();

export function getPendingConnectionMonitor(): PendingConnectionMonitor {
  return monitor;
}
