/**
 * Connection Resilience Layer
 * 
 * Handles circuit breaker recovery, exponential backoff, and adaptive retry logic
 * to improve mesh stability and prevent connection cascades.
 */

export interface CircuitBreakerState {
  peerId: string;
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
  successesInHalfOpen: number;
}

export interface ResilienceConfig {
  failureThreshold: number;
  openStateTimeout: number; // ms before trying half-open
  halfOpenSuccessThreshold: number;
  maxBackoffMs: number;
  baseBackoffMs: number;
}

const DEFAULT_CONFIG: ResilienceConfig = {
  failureThreshold: 5,
  openStateTimeout: 60000, // 1 minute
  halfOpenSuccessThreshold: 3,
  maxBackoffMs: 300000, // 5 minutes
  baseBackoffMs: 1000,
};

export class ConnectionResilience {
  private circuitBreakers = new Map<string, CircuitBreakerState>();
  private backoffTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private recoveryCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private config: ResilienceConfig = DEFAULT_CONFIG) {
    this.startRecoveryChecks();
  }

  /**
   * Check if connection attempt should be allowed
   */
  canAttemptConnection(peerId: string): boolean {
    const state = this.circuitBreakers.get(peerId);
    
    if (!state) {
      return true; // No breaker = allowed
    }

    if (state.state === 'closed') {
      return true;
    }

    if (state.state === 'open') {
      const timeSinceFailure = Date.now() - state.lastFailure;
      
      if (timeSinceFailure >= this.config.openStateTimeout) {
        // Transition to half-open
        state.state = 'half-open';
        state.successesInHalfOpen = 0;
        console.log(`[Resilience] Circuit breaker ${peerId} transitioning to half-open`);
        return true;
      }
      
      return false; // Still in open state
    }

    if (state.state === 'half-open') {
      // Allow limited attempts in half-open state
      return true;
    }

    return false;
  }

  /**
   * Record successful connection
   */
  recordSuccess(peerId: string): void {
    const state = this.circuitBreakers.get(peerId);
    
    if (!state) {
      return; // No breaker to update
    }

    if (state.state === 'half-open') {
      state.successesInHalfOpen++;
      
      if (state.successesInHalfOpen >= this.config.halfOpenSuccessThreshold) {
        // Fully recover - close the circuit
        console.log(`[Resilience] ✅ Circuit breaker ${peerId} fully recovered`);
        this.circuitBreakers.delete(peerId);
        this.clearBackoff(peerId);
      }
    } else if (state.state === 'open') {
      // Successful connection while open? Shouldn't happen, but recover
      console.log(`[Resilience] ✅ Circuit breaker ${peerId} unexpectedly recovered`);
      this.circuitBreakers.delete(peerId);
      this.clearBackoff(peerId);
    } else {
      // Success in closed state - reduce failure count
      state.failures = Math.max(0, state.failures - 1);
      
      if (state.failures === 0) {
        this.circuitBreakers.delete(peerId);
      }
    }
  }

  /**
   * Record connection failure
   */
  recordFailure(peerId: string, error?: string): void {
    let state = this.circuitBreakers.get(peerId);
    
    if (!state) {
      state = {
        peerId,
        failures: 0,
        lastFailure: Date.now(),
        state: 'closed',
        successesInHalfOpen: 0,
      };
      this.circuitBreakers.set(peerId, state);
    }

    state.failures++;
    state.lastFailure = Date.now();

    if (state.state === 'half-open') {
      // Failure in half-open immediately reopens
      state.state = 'open';
      state.successesInHalfOpen = 0;
      console.warn(`[Resilience] ⚠️ Circuit breaker ${peerId} reopened after half-open failure`);
    } else if (state.failures >= this.config.failureThreshold) {
      // Trip the breaker
      state.state = 'open';
      console.warn(`[Resilience] 🔴 Circuit breaker OPEN for ${peerId} (${state.failures} failures)`);
      
      // Schedule backoff recovery
      this.scheduleBackoffRecovery(peerId, state.failures);
    }
  }

  /**
   * Get current state for a peer
   */
  getState(peerId: string): CircuitBreakerState | null {
    return this.circuitBreakers.get(peerId) || null;
  }

  /**
   * Force reset a circuit breaker (admin/manual action)
   */
  forceReset(peerId: string): void {
    this.circuitBreakers.delete(peerId);
    this.clearBackoff(peerId);
    console.log(`[Resilience] 🔄 Circuit breaker ${peerId} manually reset`);
  }

  /**
   * Get all peers with open breakers
   */
  getOpenBreakers(): string[] {
    return Array.from(this.circuitBreakers.values())
      .filter(state => state.state === 'open')
      .map(state => state.peerId);
  }

  /**
   * Get stats for monitoring
   */
  getStats(): {
    totalBreakers: number;
    openBreakers: number;
    halfOpenBreakers: number;
    closedBreakers: number;
  } {
    let open = 0;
    let halfOpen = 0;
    let closed = 0;

    for (const state of this.circuitBreakers.values()) {
      if (state.state === 'open') open++;
      else if (state.state === 'half-open') halfOpen++;
      else if (state.state === 'closed') closed++;
    }

    return {
      totalBreakers: this.circuitBreakers.size,
      openBreakers: open,
      halfOpenBreakers: halfOpen,
      closedBreakers: closed,
    };
  }

  destroy(): void {
    if (this.recoveryCheckInterval) {
      clearInterval(this.recoveryCheckInterval);
      this.recoveryCheckInterval = null;
    }

    for (const timer of this.backoffTimers.values()) {
      clearTimeout(timer);
    }
    this.backoffTimers.clear();
    this.circuitBreakers.clear();
  }

  // Private Methods

  private scheduleBackoffRecovery(peerId: string, failureCount: number): void {
    // Clear existing timer
    this.clearBackoff(peerId);

    // Calculate exponential backoff
    const backoffMs = Math.min(
      this.config.baseBackoffMs * Math.pow(2, failureCount - this.config.failureThreshold),
      this.config.maxBackoffMs
    );

    console.log(`[Resilience] ⏰ Scheduling recovery check for ${peerId} in ${(backoffMs / 1000).toFixed(0)}s`);

    const timer = setTimeout(() => {
      const state = this.circuitBreakers.get(peerId);
      if (state && state.state === 'open') {
        console.log(`[Resilience] 🔄 Attempting recovery for ${peerId}`);
        // The actual recovery attempt will happen when canAttemptConnection is called
        // after the timeout period
      }
      this.backoffTimers.delete(peerId);
    }, backoffMs);

    this.backoffTimers.set(peerId, timer);
  }

  private clearBackoff(peerId: string): void {
    const timer = this.backoffTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.backoffTimers.delete(peerId);
    }
  }

  private startRecoveryChecks(): void {
    // Periodically check for breakers that can transition to half-open
    this.recoveryCheckInterval = setInterval(() => {
      const now = Date.now();
      
      for (const [peerId, state] of this.circuitBreakers) {
        if (state.state === 'open') {
          const timeSinceFailure = now - state.lastFailure;
          
          if (timeSinceFailure >= this.config.openStateTimeout) {
            state.state = 'half-open';
            state.successesInHalfOpen = 0;
            console.log(`[Resilience] 🟡 Circuit breaker ${peerId} -> half-open (auto recovery)`);
          }
        }
      }
    }, 30000); // Check every 30 seconds
  }
}

// Singleton instance for global use
let globalResilience: ConnectionResilience | null = null;

export function getConnectionResilience(): ConnectionResilience {
  if (!globalResilience) {
    globalResilience = new ConnectionResilience();
  }
  return globalResilience;
}

export function resetConnectionResilience(): void {
  if (globalResilience) {
    globalResilience.destroy();
    globalResilience = null;
  }
}
