/**
 * Browser Stress Monitor
 * Tracks memory pressure, long tasks, and event loop latency
 * to produce a normalized stress score (0-1) used for adaptive throttling.
 */

export type StressLevel = 'low' | 'moderate' | 'high' | 'critical';

export interface StressSnapshot {
  score: number; // 0-1
  level: StressLevel;
  memoryPressure: number; // 0-1
  longTaskRatio: number; // 0-1
  eventLoopLatency: number; // ms
  timestamp: number;
}

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

const LONG_TASK_THRESHOLD_MS = 50;
const SAMPLE_WINDOW_MS = 3000;
const POLL_INTERVAL_MS = 500;
const EVENT_LOOP_CRITICAL_MS = 200;
const EVENT_LOOP_HIGH_MS = 100;

export class StressMonitor {
  private longTaskDurations: number[] = [];
  private observer: PerformanceObserver | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private latestSnapshot: StressSnapshot = this.emptySnapshot();
  private listeners: Set<(s: StressSnapshot) => void> = new Set();
  private eventLoopLatencies: number[] = [];
  private loopRafId: number | null = null;
  private lastLoopTimestamp = 0;

  start(): void {
    // 1. PerformanceObserver for long tasks
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        this.observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration >= LONG_TASK_THRESHOLD_MS) {
              this.longTaskDurations.push(entry.duration);
            }
          }
        });
        this.observer.observe({ type: 'longtask', buffered: false });
      } catch {
        // longtask observer not supported
      }
    }

    // 2. Event loop latency via rAF
    this.lastLoopTimestamp = performance.now();
    const measureLoop = () => {
      const now = performance.now();
      const delta = now - this.lastLoopTimestamp;
      // Normal rAF is ~16ms; anything above that is latency
      if (delta > 20) {
        this.eventLoopLatencies.push(delta);
      }
      this.lastLoopTimestamp = now;
      this.loopRafId = requestAnimationFrame(measureLoop);
    };
    this.loopRafId = requestAnimationFrame(measureLoop);

    // 3. Periodic snapshot polling
    this.pollTimer = setInterval(() => {
      this.computeSnapshot();
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.loopRafId !== null) cancelAnimationFrame(this.loopRafId);
    this.loopRafId = null;
    this.listeners.clear();
  }

  /** Get the latest stress snapshot */
  getSnapshot(): StressSnapshot {
    return this.latestSnapshot;
  }

  /** Subscribe to stress updates */
  subscribe(fn: (s: StressSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Returns recommended concurrency for chunk processing.
   * low → 8, moderate → 4, high → 2, critical → 1
   */
  getRecommendedConcurrency(): number {
    switch (this.latestSnapshot.level) {
      case 'low': return 8;
      case 'moderate': return 4;
      case 'high': return 2;
      case 'critical': return 1;
    }
  }

  /**
   * Returns recommended delay between batches in ms.
   */
  getRecommendedDelay(): number {
    switch (this.latestSnapshot.level) {
      case 'low': return 0;
      case 'moderate': return 10;
      case 'high': return 50;
      case 'critical': return 150;
    }
  }

  private computeSnapshot(): void {
    const now = Date.now();

    // Memory pressure
    let memoryPressure = 0;
    const perf = performance as unknown as { memory?: PerformanceMemory };
    if (perf.memory) {
      const { usedJSHeapSize, jsHeapSizeLimit } = perf.memory;
      memoryPressure = Math.min(usedJSHeapSize / jsHeapSizeLimit, 1);
    }

    // Long task ratio (how much of the sample window was blocked)
    const cutoff = performance.now() - SAMPLE_WINDOW_MS;
    this.longTaskDurations = this.longTaskDurations.filter(
      (_, i) => i > this.longTaskDurations.length - 20 // keep last 20
    );
    const totalBlockedMs = this.longTaskDurations.reduce((a, b) => a + b, 0);
    const longTaskRatio = Math.min(totalBlockedMs / SAMPLE_WINDOW_MS, 1);

    // Event loop latency (p95 of recent samples)
    const recentLatencies = this.eventLoopLatencies.slice(-30);
    this.eventLoopLatencies = recentLatencies;
    const sortedLatencies = [...recentLatencies].sort((a, b) => a - b);
    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const eventLoopLatency = sortedLatencies[p95Index] || 16;

    // Normalize event loop latency to 0-1
    const loopScore = Math.min(eventLoopLatency / EVENT_LOOP_CRITICAL_MS, 1);

    // Weighted composite score
    const score = Math.min(
      memoryPressure * 0.35 +
      longTaskRatio * 0.35 +
      loopScore * 0.30,
      1
    );

    const level: StressLevel =
      score >= 0.75 ? 'critical' :
      score >= 0.50 ? 'high' :
      score >= 0.25 ? 'moderate' : 'low';

    this.latestSnapshot = {
      score,
      level,
      memoryPressure,
      longTaskRatio,
      eventLoopLatency,
      timestamp: now,
    };

    for (const fn of this.listeners) {
      try { fn(this.latestSnapshot); } catch {}
    }
  }

  private emptySnapshot(): StressSnapshot {
    return {
      score: 0,
      level: 'low',
      memoryPressure: 0,
      longTaskRatio: 0,
      eventLoopLatency: 16,
      timestamp: Date.now(),
    };
  }
}

/** Singleton instance */
let _instance: StressMonitor | null = null;

export function getStressMonitor(): StressMonitor {
  if (!_instance) {
    _instance = new StressMonitor();
    _instance.start();
  }
  return _instance;
}
