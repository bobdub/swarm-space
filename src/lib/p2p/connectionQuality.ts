/**
 * Connection Quality Scorer
 * 
 * Tracks connection success rates and latency to prioritize
 * high-quality peers for auto-connect.
 */

interface ConnectionQualityMetrics {
  successfulConnections: number;
  failedConnections: number;
  totalAttempts: number;
  avgLatencyMs: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

interface ConnectionQualityScore {
  peerId: string;
  successRate: number;
  reliability: number;
  avgLatencyMs: number | null;
  score: number; // 0-1, higher is better
}

const METRICS_STORAGE_KEY = 'p2p-connection-quality';
const MAX_STORED_PEERS = 100;

/**
 * Connection quality tracker
 */
class ConnectionQualityTracker {
  private metrics = new Map<string, ConnectionQualityMetrics>();
  private latencySamples = new Map<string, number[]>();
  private maxSamples = 10;

  constructor() {
    this.loadMetrics();
  }

  /**
   * Record a successful connection
   */
  recordSuccess(peerId: string, latencyMs?: number): void {
    const existing = this.metrics.get(peerId) ?? this.createEmptyMetrics();
    
    existing.successfulConnections++;
    existing.totalAttempts++;
    existing.lastSuccessAt = Date.now();

    if (latencyMs !== undefined) {
      this.addLatencySample(peerId, latencyMs);
      existing.avgLatencyMs = this.calculateAvgLatency(peerId);
    }

    this.metrics.set(peerId, existing);
    this.persistMetrics();
  }

  /**
   * Record a failed connection
   */
  recordFailure(peerId: string): void {
    const existing = this.metrics.get(peerId) ?? this.createEmptyMetrics();
    
    existing.failedConnections++;
    existing.totalAttempts++;
    existing.lastFailureAt = Date.now();

    this.metrics.set(peerId, existing);
    this.persistMetrics();
  }

  /**
   * Get quality score for a peer
   */
  getScore(peerId: string): ConnectionQualityScore {
    const metrics = this.metrics.get(peerId);
    
    if (!metrics || metrics.totalAttempts === 0) {
      return {
        peerId,
        successRate: 0,
        reliability: 0,
        avgLatencyMs: null,
        score: 0,
      };
    }

    const successRate = metrics.successfulConnections / metrics.totalAttempts;
    const reliability = this.calculateReliability(metrics);
    const latencyScore = this.calculateLatencyScore(metrics.avgLatencyMs);
    
    // Weighted score: 60% success rate, 25% reliability, 15% latency
    const score = (successRate * 0.6) + (reliability * 0.25) + (latencyScore * 0.15);

    return {
      peerId,
      successRate,
      reliability,
      avgLatencyMs: metrics.avgLatencyMs,
      score: Math.max(0, Math.min(1, score)),
    };
  }

  /**
   * Get all quality scores sorted by score
   */
  getAllScores(): ConnectionQualityScore[] {
    const scores = Array.from(this.metrics.keys()).map(peerId => this.getScore(peerId));
    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * Get top N peers by quality score
   */
  getTopPeers(n: number): string[] {
    return this.getAllScores()
      .slice(0, n)
      .map(s => s.peerId);
  }

  /**
   * Reset metrics for a peer
   */
  reset(peerId: string): void {
    this.metrics.delete(peerId);
    this.latencySamples.delete(peerId);
    this.persistMetrics();
  }

  /**
   * Clear all metrics
   */
  resetAll(): void {
    this.metrics.clear();
    this.latencySamples.clear();
    this.persistMetrics();
  }

  /**
   * Get raw metrics for a peer
   */
  getMetrics(peerId: string): ConnectionQualityMetrics | null {
    return this.metrics.get(peerId) ?? null;
  }

  private createEmptyMetrics(): ConnectionQualityMetrics {
    return {
      successfulConnections: 0,
      failedConnections: 0,
      totalAttempts: 0,
      avgLatencyMs: null,
      lastSuccessAt: null,
      lastFailureAt: null,
    };
  }

  private addLatencySample(peerId: string, latencyMs: number): void {
    const samples = this.latencySamples.get(peerId) ?? [];
    samples.push(latencyMs);
    
    if (samples.length > this.maxSamples) {
      samples.shift();
    }
    
    this.latencySamples.set(peerId, samples);
  }

  private calculateAvgLatency(peerId: string): number | null {
    const samples = this.latencySamples.get(peerId);
    if (!samples || samples.length === 0) return null;
    
    return samples.reduce((sum, v) => sum + v, 0) / samples.length;
  }

  private calculateReliability(metrics: ConnectionQualityMetrics): number {
    // Factor in recency - recent successes are weighted higher
    const now = Date.now();
    const recencyWeight = metrics.lastSuccessAt 
      ? Math.exp(-(now - metrics.lastSuccessAt) / (7 * 24 * 60 * 60 * 1000)) // 7-day decay
      : 0;

    const successRate = metrics.successfulConnections / metrics.totalAttempts;
    return (successRate * 0.7) + (recencyWeight * 0.3);
  }

  private calculateLatencyScore(avgLatencyMs: number | null): number {
    if (avgLatencyMs === null) return 0.5; // Neutral score if unknown
    
    // Ideal latency is 0-100ms (score 1.0)
    // Acceptable is 100-500ms (score 0.5-1.0)
    // Poor is 500ms+ (score 0-0.5)
    if (avgLatencyMs <= 100) return 1.0;
    if (avgLatencyMs <= 500) return 1.0 - ((avgLatencyMs - 100) / 400) * 0.5;
    return Math.max(0, 0.5 - ((avgLatencyMs - 500) / 2000) * 0.5);
  }

  private loadMetrics(): void {
    try {
      const stored = localStorage.getItem(METRICS_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        this.metrics = new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn('[ConnectionQuality] Failed to load metrics:', error);
    }
  }

  private persistMetrics(): void {
    try {
      // Limit stored peers to prevent unbounded growth
      if (this.metrics.size > MAX_STORED_PEERS) {
        const scores = this.getAllScores();
        const toKeep = new Set(scores.slice(0, MAX_STORED_PEERS).map(s => s.peerId));
        
        for (const peerId of this.metrics.keys()) {
          if (!toKeep.has(peerId)) {
            this.metrics.delete(peerId);
            this.latencySamples.delete(peerId);
          }
        }
      }

      const data = Object.fromEntries(this.metrics.entries());
      localStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.warn('[ConnectionQuality] Failed to persist metrics:', error);
    }
  }
}

// Singleton instance
const tracker = new ConnectionQualityTracker();

export function getConnectionQualityTracker(): ConnectionQualityTracker {
  return tracker;
}

export function recordConnectionQualitySuccess(peerId: string, latencyMs?: number): void {
  tracker.recordSuccess(peerId, latencyMs);
}

export function recordConnectionQualityFailure(peerId: string): void {
  tracker.recordFailure(peerId);
}

export function getConnectionQualityScore(peerId: string): ConnectionQualityScore {
  return tracker.getScore(peerId);
}

export function getTopQualityPeers(n: number): string[] {
  return tracker.getTopPeers(n);
}
