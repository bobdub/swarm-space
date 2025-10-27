import { incrementNodeMetricAggregate, listNodeMetricAggregatesByMetric } from "../achievementsStore";
import type { NodeMetricAggregate, NodeMetricKind } from "@/types";

export interface NodeMetricSnapshot {
  uptimeMs: number;
  bytesUploaded: number;
  bytesDownloaded: number;
  relayCount: number;
  pingCount: number;
}

interface NodeMetricsTrackerOptions {
  flushIntervalMs?: number;
  onSnapshot?: (snapshot: NodeMetricSnapshot) => void;
}

const METRIC_KEYS: NodeMetricKind[] = [
  "uptimeMs",
  "bytesUploaded",
  "bytesDownloaded",
  "relayCount",
  "pingCount",
];

export class NodeMetricsTracker {
  private totals: NodeMetricSnapshot = {
    uptimeMs: 0,
    bytesUploaded: 0,
    bytesDownloaded: 0,
    relayCount: 0,
    pingCount: 0,
  };
  private pending: Partial<Record<NodeMetricKind, number>> = {};
  private initialized = false;
  private sessionStartedAt: number | null = null;
  private lastUptimeSample: number | null = null;
  private flushIntervalMs: number;
  private flushTimer?: number;
  private lastFlushAt = 0;
  private onSnapshot?: (snapshot: NodeMetricSnapshot) => void;

  constructor(private userId: string, options: NodeMetricsTrackerOptions = {}) {
    this.flushIntervalMs = options.flushIntervalMs ?? 60000;
    this.onSnapshot = options.onSnapshot;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const snapshots = await Promise.all(
      METRIC_KEYS.map(async (metric) => {
        const aggregates = await listNodeMetricAggregatesByMetric(this.userId, metric);
        return aggregates.reduce((sum: number, record: NodeMetricAggregate) => sum + (record.total || 0), 0);
      })
    );

    snapshots.forEach((total, index) => {
      const metric = METRIC_KEYS[index];
      this.totals[metric] = total;
    });

    this.emitSnapshot();
  }

  startSession(): void {
    const now = Date.now();
    this.sessionStartedAt = now;
    this.lastUptimeSample = now;
    this.startFlushTimer();
  }

  async stopSession(): Promise<void> {
    this.sampleUptime();
    this.sessionStartedAt = null;
    this.lastUptimeSample = null;
    this.stopFlushTimer();
    await this.flush();
  }

  sampleUptime(): void {
    if (!this.sessionStartedAt) return;
    const now = Date.now();
    const lastSample = this.lastUptimeSample ?? this.sessionStartedAt;
    const delta = now - lastSample;
    if (delta <= 0) {
      this.lastUptimeSample = now;
      return;
    }
    this.lastUptimeSample = now;
    this.addDelta("uptimeMs", delta);
  }

  recordBytesUploaded(bytes: number): void {
    this.addDelta("bytesUploaded", bytes);
  }

  recordBytesDownloaded(bytes: number): void {
    this.addDelta("bytesDownloaded", bytes);
  }

  recordRelay(count = 1): void {
    this.addDelta("relayCount", count);
  }

  recordPing(count = 1): void {
    this.addDelta("pingCount", count);
  }

  getSnapshot(): NodeMetricSnapshot {
    this.sampleUptime();
    return { ...this.totals };
  }

  private addDelta(metric: NodeMetricKind, delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) {
      return;
    }
    this.totals[metric] += delta;
    this.pending[metric] = (this.pending[metric] ?? 0) + delta;
    this.emitSnapshot();
    const now = Date.now();
    if (now - this.lastFlushAt > this.flushIntervalMs) {
      void this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (!Object.keys(this.pending).length) {
      this.lastFlushAt = Date.now();
      return;
    }

    const entries = Object.entries(this.pending) as [NodeMetricKind, number][];
    this.pending = {};
    this.lastFlushAt = Date.now();
    const bucket = this.createBucket(new Date());

    await Promise.all(
      entries.map(([metric, delta]) =>
        incrementNodeMetricAggregate({
          userId: this.userId,
          metric,
          bucket,
          delta,
        })
      )
    ).catch((error) => {
      console.warn("[NodeMetricsTracker] Failed to persist metrics", error);
    });
  }

  private createBucket(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private startFlushTimer(): void {
    if (typeof window === "undefined") return;
    if (this.flushTimer) return;
    this.flushTimer = window.setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  private emitSnapshot(): void {
    if (this.onSnapshot) {
      this.onSnapshot({ ...this.totals });
    }
  }
}
