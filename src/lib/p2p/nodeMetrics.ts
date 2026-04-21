import { incrementNodeMetricAggregate, listNodeMetricAggregatesByMetric } from "../achievementsStore";
import type { NodeMetricAggregate, NodeMetricKind } from "@/types";
import { buildUqrcStateSnapshot, type UqrcStateSnapshot } from "@/lib/uqrc/state";
import { deriveUqrcConsciousState, type UqrcConsciousState } from "@/lib/uqrc/conscious";
import { deriveUqrcPersonalityState, type UqrcPersonalityState } from "@/lib/uqrc/personality";
import { recordP2PDiagnostic } from "./diagnostics";
import { getSharedFieldEngine } from "@/lib/uqrc/fieldEngine";

export interface NodeMetricSnapshot {
  uptimeMs: number;
  bytesUploaded: number;
  bytesDownloaded: number;
  relayCount: number;
  pingCount: number;
  connectionAttempts: number;
  successfulConnections: number;
  failedConnectionAttempts: number;
  rendezvousAttempts: number;
  rendezvousSuccesses: number;
  rendezvousFailures: number;
}

interface NodeMetricsTrackerOptions {
  flushIntervalMs?: number;
  onSnapshot?: (snapshot: NodeMetricSnapshot) => void;
  onUqrcSnapshot?: (snapshot: UqrcStateSnapshot) => void;
}

const METRIC_KEYS: NodeMetricKind[] = [
  "uptimeMs",
  "bytesUploaded",
  "bytesDownloaded",
  "relayCount",
  "pingCount",
  "connectionAttempts",
  "successfulConnections",
  "failedConnectionAttempts",
  "rendezvousAttempts",
  "rendezvousSuccesses",
  "rendezvousFailures",
];

export class NodeMetricsTracker {
  private totals: NodeMetricSnapshot = {
    uptimeMs: 0,
    bytesUploaded: 0,
    bytesDownloaded: 0,
    relayCount: 0,
    pingCount: 0,
    connectionAttempts: 0,
    successfulConnections: 0,
    failedConnectionAttempts: 0,
    rendezvousAttempts: 0,
    rendezvousSuccesses: 0,
    rendezvousFailures: 0,
  };
  private pending: Partial<Record<NodeMetricKind, number>> = {};
  private initialized = false;
  private sessionStartedAt: number | null = null;
  private lastUptimeSample: number | null = null;
  private flushIntervalMs: number;
  private flushTimer?: number;
  private lastFlushAt = 0;
  private onSnapshot?: (snapshot: NodeMetricSnapshot) => void;
  private onUqrcSnapshot?: (snapshot: UqrcStateSnapshot) => void;
  private readonly rollingConnectionSamples: number[] = [];
  private personalityState: UqrcPersonalityState | undefined;
  private consciousState: UqrcConsciousState | undefined;

  constructor(private userId: string, options: NodeMetricsTrackerOptions = {}) {
    this.flushIntervalMs = options.flushIntervalMs ?? 60000;
    this.onSnapshot = options.onSnapshot;
    this.onUqrcSnapshot = options.onUqrcSnapshot;
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

  recordConnectionAttempt(count = 1): void {
    this.addDelta("connectionAttempts", count);
  }

  recordSuccessfulConnection(count = 1): void {
    this.addDelta("successfulConnections", count);
  }

  recordFailedConnection(count = 1): void {
    this.addDelta("failedConnectionAttempts", count);
  }

  recordRendezvousAttempt(count = 1): void {
    this.addDelta("rendezvousAttempts", count);
  }

  recordRendezvousSuccess(count = 1): void {
    this.addDelta("rendezvousSuccesses", count);
  }

  recordRendezvousFailure(count = 1): void {
    this.addDelta("rendezvousFailures", count);
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

    const snapshot = this.createUqrcSnapshot();
    if (this.onUqrcSnapshot) {
      this.onUqrcSnapshot(snapshot);
    }

    recordP2PDiagnostic({
      level: 'info',
      source: 'manager',
      code: 'uqrc.snapshot',
      message: 'UQRC diagnostics snapshot updated',
      context: {
        healthScore: snapshot.healthScore,
        rollingEntropy: snapshot.cortex.rollingEntropy,
        survivalConfidence: snapshot.brainstem.survivalConfidence,
        personality: snapshot.personality,
        conscious: snapshot.conscious,
      },
    });
  }

  private createUqrcSnapshot(): UqrcStateSnapshot {
    const attemptDelta = this.totals.connectionAttempts - this.totals.successfulConnections;
    this.rollingConnectionSamples.push(Math.max(0, attemptDelta));
    if (this.rollingConnectionSamples.length > 25) {
      this.rollingConnectionSamples.shift();
    }

    const maxVariance = Math.max(1, ...this.rollingConnectionSamples);
    const meanVariance = this.rollingConnectionSamples.reduce((sum, item) => sum + item, 0) / this.rollingConnectionSamples.length;
    const rollingEntropy = Math.min(1, meanVariance / maxVariance);
    const successRate = this.totals.connectionAttempts > 0
      ? this.totals.successfulConnections / this.totals.connectionAttempts
      : 0;

    const nextPersonality = deriveUqrcPersonalityState({
      sessionActive: this.sessionStartedAt !== null,
      uptimeMs: this.totals.uptimeMs,
      connectionAttempts: this.totals.connectionAttempts,
      successfulConnections: this.totals.successfulConnections,
      failedConnectionAttempts: this.totals.failedConnectionAttempts,
      rendezvousAttempts: this.totals.rendezvousAttempts,
      rendezvousSuccesses: this.totals.rendezvousSuccesses,
      relayCount: this.totals.relayCount,
      pingCount: this.totals.pingCount,
      accountId: this.userId,
    }, this.personalityState);
    this.personalityState = nextPersonality;

    const nextConscious = deriveUqrcConsciousState({
      sessionActive: this.sessionStartedAt !== null,
      uptimeMs: this.totals.uptimeMs,
      connectionAttempts: this.totals.connectionAttempts,
      successfulConnections: this.totals.successfulConnections,
      failedConnectionAttempts: this.totals.failedConnectionAttempts,
      rendezvousAttempts: this.totals.rendezvousAttempts,
      rendezvousSuccesses: this.totals.rendezvousSuccesses,
      relayCount: this.totals.relayCount,
      pingCount: this.totals.pingCount,
      bytesUploaded: this.totals.bytesUploaded,
      bytesDownloaded: this.totals.bytesDownloaded,
      accountId: this.userId,
    }, this.consciousState);
    this.consciousState = nextConscious;

    return buildUqrcStateSnapshot({
      timestamp: Date.now(),
      trace: 'node-metrics-tracker',
      cortex: {
        noveltyScore: Math.min(1, this.totals.relayCount / 200),
        semanticDensity: Math.min(1, this.totals.bytesUploaded / Math.max(1, this.totals.bytesDownloaded + 1)),
        interactionVelocity: Math.min(1, (this.totals.pingCount + this.totals.relayCount) / 500),
        reflectionDepth: Math.min(1, this.totals.uptimeMs / (1000 * 60 * 60 * 4)),
        rollingEntropy,
      },
      limbic: {
        rewardFlux: Math.min(1, this.totals.successfulConnections / 100),
        influenceWeight: Math.min(1, this.totals.relayCount / 100),
        energyBudget: Math.min(1, this.totals.uptimeMs / (1000 * 60 * 60 * 8)),
        burnPressure: Math.min(1, this.totals.failedConnectionAttempts / Math.max(1, this.totals.connectionAttempts)),
      },
      brainstem: {
        peerLiveness: successRate,
        heartbeatIntervalMs: Math.min(1, this.totals.pingCount > 0 ? 1 / this.totals.pingCount : 1),
        messageRedundancy: Math.min(1, this.totals.relayCount / Math.max(1, this.totals.successfulConnections + 1)),
        survivalConfidence: Math.max(0, 1 - (this.totals.rendezvousFailures / Math.max(1, this.totals.rendezvousAttempts))),
      },
      memory: {
        chunkRedundancy: Math.min(1, this.totals.bytesUploaded / Math.max(1, this.totals.bytesDownloaded + 1)),
        manifestIntegrity: Math.max(0, 1 - (this.totals.failedConnectionAttempts / Math.max(1, this.totals.connectionAttempts))),
        recallLatencyMs: Math.min(1, this.totals.failedConnectionAttempts / Math.max(1, this.totals.successfulConnections + 1)),
        reconstructionSuccess: successRate,
      },
      heartbeat: {
        hashRateEffective: Math.min(1, this.totals.successfulConnections / 250),
        qScoreTotal: rollingEntropy,
        propagationCurvature: Math.min(1, this.totals.rendezvousFailures / Math.max(1, this.totals.rendezvousAttempts)),
        timestampCurvature: Math.min(1, this.totals.failedConnectionAttempts / Math.max(1, this.totals.connectionAttempts)),
      },
      ethics: {
        harmRisk: Math.min(1, this.totals.failedConnectionAttempts / Math.max(1, this.totals.connectionAttempts)),
        confidence: successRate,
        interventionLevel: Math.min(1, this.totals.rendezvousFailures / Math.max(1, this.totals.rendezvousAttempts)),
      },
      personality: nextPersonality,
      conscious: nextConscious,
      field: this.captureFieldState(),
    });
  }

  private captureFieldState() {
    try {
      const status = getSharedFieldEngine().getStatus();
      return {
        qScore: status.qScore,
        basinCount: status.basinCount,
        dominantWavelength: status.dominantWavelength,
        definitionConstraints: status.pinCount,
      };
    } catch {
      return undefined;
    }
  }
}
