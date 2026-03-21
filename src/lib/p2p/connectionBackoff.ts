/**
 * Connection Backoff Manager
 * 
 * Implements exponential backoff and circuit breaker patterns to prevent
 * wasting resources on repeatedly failing peer connections.
 */

export interface BackoffState {
  failureCount: number;
  lastFailureAt: number;
  nextAttemptAt: number;
  circuitOpen: boolean;
}

interface BackoffConfig {
  baseDelayMs: number;
  maxDelayMs: number;
  failureThreshold: number;
  circuitResetMs: number;
}

const DEFAULT_CONFIG: BackoffConfig = {
  baseDelayMs: 2000,        // Start with 2s delay
  maxDelayMs: 300000,       // Cap at 5 minutes
  failureThreshold: 5,      // Open circuit after 5 consecutive failures
  circuitResetMs: 600000,   // Reset circuit after 10 minutes
};

/**
 * Connection backoff tracker
 */
class ConnectionBackoffTracker {
  private backoffs = new Map<string, BackoffState>();
  private config: BackoffConfig;

  constructor(config: Partial<BackoffConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a connection failure for a peer
   */
  recordFailure(peerId: string): void {
    const existing = this.backoffs.get(peerId);
    const now = Date.now();

    if (existing) {
      const failureCount = existing.failureCount + 1;
      const delay = this.calculateDelay(failureCount);
      const circuitOpen = failureCount >= this.config.failureThreshold;

      this.backoffs.set(peerId, {
        failureCount,
        lastFailureAt: now,
        nextAttemptAt: now + delay,
        circuitOpen,
      });

      if (circuitOpen) {
        console.warn(
          `[ConnectionBackoff] Circuit opened for ${peerId} after ${failureCount} failures. ` +
          `Will reset in ${this.config.circuitResetMs / 1000}s`
        );
      }
    } else {
      const delay = this.config.baseDelayMs;
      this.backoffs.set(peerId, {
        failureCount: 1,
        lastFailureAt: now,
        nextAttemptAt: now + delay,
        circuitOpen: false,
      });
    }
  }

  /**
   * Record a successful connection for a peer (resets backoff)
   */
  recordSuccess(peerId: string): void {
    const existing = this.backoffs.get(peerId);
    if (existing?.circuitOpen) {
      console.log(`[ConnectionBackoff] Circuit closed for ${peerId} after successful connection`);
    }
    this.backoffs.delete(peerId);
  }

  /**
   * Check if a peer can be attempted right now
   */
  canAttempt(peerId: string): boolean {
    const state = this.backoffs.get(peerId);
    if (!state) return true;

    const now = Date.now();

    // Reset circuit if enough time has passed
    if (state.circuitOpen && now - state.lastFailureAt > this.config.circuitResetMs) {
      console.log(`[ConnectionBackoff] Circuit reset timeout reached for ${peerId}`);
      this.backoffs.delete(peerId);
      return true;
    }

    // Check if backoff period has elapsed
    if (now >= state.nextAttemptAt) {
      // If circuit is open, don't allow attempt yet
      if (state.circuitOpen) {
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Get time remaining until next attempt is allowed (in ms)
   */
  getTimeUntilNextAttempt(peerId: string): number {
    const state = this.backoffs.get(peerId);
    if (!state) return 0;

    const now = Date.now();
    if (state.circuitOpen) {
      return Math.max(0, this.config.circuitResetMs - (now - state.lastFailureAt));
    }

    return Math.max(0, state.nextAttemptAt - now);
  }

  /**
   * Get backoff state for a peer
   */
  getState(peerId: string): BackoffState | null {
    return this.backoffs.get(peerId) ?? null;
  }

  /**
   * Get all peers currently in backoff
   */
  getAllBackoffs(): Map<string, BackoffState> {
    return new Map(this.backoffs);
  }

  /**
   * Manually reset backoff for a peer
   */
  reset(peerId: string): void {
    this.backoffs.delete(peerId);
  }

  /**
   * Clear all backoffs (use sparingly)
   */
  resetAll(): void {
    this.backoffs.clear();
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateDelay(failureCount: number): number {
    const exponentialDelay = this.config.baseDelayMs * Math.pow(2, failureCount - 1);
    const jitter = Math.random() * 1000; // Add up to 1s jitter
    return Math.min(exponentialDelay + jitter, this.config.maxDelayMs);
  }

  /**
   * Get stats for monitoring
   */
  getStats(): {
    totalPeersInBackoff: number;
    peersWithCircuitOpen: number;
    avgFailureCount: number;
  } {
    const backoffs = Array.from(this.backoffs.values());
    return {
      totalPeersInBackoff: backoffs.length,
      peersWithCircuitOpen: backoffs.filter(b => b.circuitOpen).length,
      avgFailureCount: backoffs.length > 0
        ? backoffs.reduce((sum, b) => sum + b.failureCount, 0) / backoffs.length
        : 0,
    };
  }
}

// Singleton instance
const tracker = new ConnectionBackoffTracker();

export function getConnectionBackoffTracker(): ConnectionBackoffTracker {
  return tracker;
}

export function recordConnectionFailure(peerId: string): void {
  tracker.recordFailure(peerId);
}

export function recordConnectionSuccess(peerId: string): void {
  tracker.recordSuccess(peerId);
}

export function canAttemptConnection(peerId: string): boolean {
  return tracker.canAttempt(peerId);
}

export function getBackoffState(peerId: string): BackoffState | null {
  return tracker.getState(peerId);
}

export function getBackoffStats() {
  return tracker.getStats();
}
