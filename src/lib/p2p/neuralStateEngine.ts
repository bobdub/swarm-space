import { InstinctHierarchy, LayerSignals } from './instinctHierarchy';
import { DualLearningFusion, FusionSnapshot, ContentEvent } from './dualLearningFusion';

export type InteractionKind =
  | 'gossip'
  | 'chunk'
  | 'manifest'
  | 'ping'
  | 'connection'
  | 'sync';

export interface SynapseState {
  weight: number;
  latencyMs: number | null;
  throughputKbps: number | null;
  lastActive: number;
}

export interface NeuronState {
  peerId: string;
  energy: number;
  memory: number;
  trust: number;
  activity: number;
  coins: number;
  lastSeen: number;
  /** Synapses keyed by interaction kind — tracks per-kind weight/quality */
  synapses: Map<InteractionKind, SynapseState>;
}

export interface NeuralAuditEvent {
  peerId: string;
  kind: InteractionKind;
  success: boolean;
  trustDelta: number;
  weightDelta: number;
  energyDelta: number;
  memoryDelta: number;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════
// BELL CURVE — Statistical Behavior Baseline
// ═══════════════════════════════════════════════════════════════════════

/** Running mean & variance using Welford's online algorithm */
export interface BellCurveStats {
  kind: InteractionKind;
  count: number;
  mean: number;
  m2: number;     // sum of squared diffs (for variance)
  min: number;
  max: number;
}

/** Where a sample sits relative to the bell curve baseline */
export interface BellCurvePosition {
  kind: InteractionKind;
  value: number;
  zScore: number;         // standard deviations from mean
  isOutlier: boolean;     // |z| > 2
  isRare: boolean;        // |z| > 3
  percentile: number;     // approximate CDF percentile 0-100
}

// ═══════════════════════════════════════════════════════════════════════
// Φ — Transition Quality Node
// ═══════════════════════════════════════════════════════════════════════

export type NetworkPhase =
  | 'bootstrapping'
  | 'connecting'
  | 'stable'
  | 'degraded'
  | 'recovering';

export interface PhiTransition {
  from: NetworkPhase;
  to: NetworkPhase;
  timestamp: number;
  /** Smoothness 0-1: 1 = perfectly smooth, 0 = chaotic jump */
  smoothness: number;
  /** Did the transition happen because context changed, or because we handled it poorly? */
  cause: 'contextual' | 'internal';
  /** Trust delta across all neurons during this transition */
  trustDelta: number;
  /** Energy delta across all neurons during this transition */
  energyDelta: number;
}

export interface PhiSnapshot {
  currentPhase: NetworkPhase;
  phi: number;                    // overall transition quality 0-1
  transitionCount: number;
  averageSmoothness: number;
  lastTransition: PhiTransition | null;
  /** Adaptive recommendations based on Φ stability */
  recommendation: 'tighten' | 'relax' | 'hold';
}

// ═══════════════════════════════════════════════════════════════════════
// PREDICTIVE ERROR CORRECTION — û(t+1) = Predict(u(t)); error = u(t+1) - û(t+1)
// ═══════════════════════════════════════════════════════════════════════

/** A single prediction-error sample for one metric */
export interface PredictionSample {
  predicted: number;
  actual: number;
  error: number;       // actual - predicted
  absError: number;
  timestamp: number;
}

/** Tracks predicted vs actual for a named metric over time */
export interface PredictionTrack {
  metric: string;
  /** Exponential smoothing coefficient α (higher = more reactive) */
  alpha: number;
  /** Current predicted value û(t+1) */
  predicted: number;
  /** Running mean absolute error */
  mae: number;
  /** Number of observations */
  count: number;
  /** Last N samples for diagnostics */
  history: PredictionSample[];
  /** When MAE exceeds this threshold, flag correction needed */
  correctionThreshold: number;
}

/** Aggregate prediction state exposed in snapshots */
export interface PredictionSnapshot {
  tracks: Array<{
    metric: string;
    predicted: number;
    lastActual: number;
    lastError: number;
    mae: number;
    correctionNeeded: boolean;
  }>;
  /** Overall prediction health: 1 = accurate, 0 = wildly wrong */
  accuracy: number;
}

/** Aggregate snapshot of the neural network state for UQRC integration */
export interface NeuralNetworkSnapshot {
  totalNeurons: number;
  totalSynapses: number;
  averageTrust: number;
  averageEnergy: number;
  averageMemory: number;
  totalCoins: number;
  healthScore: number;
  topPeers: Array<{ peerId: string; score: number }>;
  auditLength: number;
  /** Bell curve baselines per interaction kind */
  bellCurves: BellCurveStats[];
  /** Φ transition quality */
  phi: PhiSnapshot;
  /** Predictive error correction state */
  prediction: PredictionSnapshot;
  /** Instinct hierarchy — 9-layer survival stack */
  instinct: import('./instinctHierarchy').InstinctSnapshot | null;
  /** Dual Learning System — pattern + language fusion */
  dualLearning: FusionSnapshot | null;
}

interface InteractionOptions {
  kind: InteractionKind;
  success: boolean;
  latencyMs?: number;
  bytes?: number;
  now?: number;
}

const INITIAL_TRUST = 50;
const INITIAL_WEIGHT = 1;
const DEFAULT_DOPAMINE = 2;
const DEFAULT_PENALTY = 3;
const DECAY_INTERVAL_MS = 1000 * 60 * 5; // 5 minutes
const DECAY_FACTOR = 0.95;
const STALE_THRESHOLD_MS = 1000 * 60 * 30; // 30 minutes

// Bell curve thresholds
const OUTLIER_Z = 2;
const RARE_Z = 3;

// Phi constants
const PHI_WINDOW = 50;           // keep last N transitions
const PHI_UNSTABLE_THRESHOLD = 0.4;
const PHI_RIGID_THRESHOLD = 0.85;

// Prediction constants
const PREDICTION_HISTORY_SIZE = 30;
const PREDICTION_DEFAULT_ALPHA = 0.3;
const PREDICTION_CORRECTION_THRESHOLD = 0.25;

// ── Bell Curve Helpers ────────────────────────────────────────────────

function getVariance(stats: BellCurveStats): number {
  return stats.count > 1 ? stats.m2 / (stats.count - 1) : 0;
}

function getStdDev(stats: BellCurveStats): number {
  return Math.sqrt(getVariance(stats));
}

/** Approximate CDF using logistic approximation of the normal distribution */
function approxNormalCDF(z: number): number {
  return 1 / (1 + Math.exp(-1.7159 * z));
}

export class NeuralStateEngine {
  private readonly neurons = new Map<string, NeuronState>();
  private readonly auditTrail: NeuralAuditEvent[] = [];
  private lastDecayAt = Date.now();

  // ── Bell Curve State ──────────────────────────────────────────────
  private readonly bellCurves = new Map<InteractionKind, BellCurveStats>();

  // ── Φ Transition State ────────────────────────────────────────────
  private currentPhase: NetworkPhase = 'bootstrapping';
  private readonly phiHistory: PhiTransition[] = [];
  private phiValue = 0.5; // starts neutral

  // ── Prediction State ──────────────────────────────────────────────
  private readonly predictionTracks = new Map<string, PredictionTrack>();

  // ── Instinct Hierarchy ────────────────────────────────────────────
  private readonly instinctHierarchy = new InstinctHierarchy();

  // ── Dual Learning System ──────────────────────────────────────────
  private readonly dualLearning = new DualLearningFusion();

  registerPeer(peerId: string, now = Date.now()): void {
    const existing = this.neurons.get(peerId);
    if (existing) {
      existing.lastSeen = now;
      return;
    }

    this.neurons.set(peerId, {
      peerId,
      energy: 0,
      memory: 0,
      trust: INITIAL_TRUST,
      activity: 0,
      coins: 0,
      lastSeen: now,
      synapses: new Map(),
    });
  }

  onInteraction(peerId: string, options: InteractionOptions): void {
    const now = options.now ?? Date.now();
    this.registerPeer(peerId, now);
    this.maybeDecay(now);

    const neuron = this.neurons.get(peerId);
    if (!neuron) {
      return;
    }

    neuron.lastSeen = now;
    neuron.activity += 1;

    // Synapses keyed by interaction kind (not self-referencing peerId)
    const synapse = neuron.synapses.get(options.kind) ?? {
      weight: INITIAL_WEIGHT,
      latencyMs: null,
      throughputKbps: null,
      lastActive: now,
    };

    const trustBefore = neuron.trust;
    const weightBefore = synapse.weight;
    const energyBefore = neuron.energy;
    const memoryBefore = neuron.memory;

    // ── Bell Curve: evaluate interaction against baseline ──────────
    const bellPosition = this.evaluateBellCurve(options.kind, synapse.weight);
    let dopamine = DEFAULT_DOPAMINE;
    let penalty = DEFAULT_PENALTY;

    if (bellPosition) {
      // Reinforce common reliable patterns more; weaken rare/outlier ones
      if (options.success) {
        if (bellPosition.isOutlier) {
          dopamine = DEFAULT_DOPAMINE * 0.5; // tentative reinforcement for rare patterns
        } else if (bellPosition.isRare) {
          dopamine = DEFAULT_DOPAMINE * 0.25; // very tentative
        }
        // Common + reliable → full reinforcement (default dopamine)
      } else {
        if (bellPosition.isRare) {
          penalty = DEFAULT_PENALTY * 0.5; // don't over-punish genuinely rare events
        }
      }
    }

    if (options.success) {
      synapse.weight += dopamine;
      neuron.trust = Math.min(100, neuron.trust + 1);
      neuron.coins += 1;
      if (options.kind === 'chunk' || options.kind === 'manifest' || options.kind === 'sync') {
        neuron.memory += 1;
      }
      if (options.kind === 'connection' || options.kind === 'ping') {
        neuron.energy += 1;
      }
    } else {
      synapse.weight = Math.max(0, synapse.weight - penalty);
      neuron.trust = Math.max(0, neuron.trust - 2);
    }

    if (typeof options.latencyMs === 'number') {
      synapse.latencyMs = options.latencyMs;
    }
    if (options.bytes && options.bytes > 0 && typeof options.latencyMs === 'number' && options.latencyMs > 0) {
      synapse.throughputKbps = Math.round((options.bytes * 8) / options.latencyMs);
    }
    synapse.lastActive = now;
    neuron.synapses.set(options.kind, synapse);

    // ── Update Bell Curve baseline with this observation ───────────
    this.updateBellCurve(options.kind, synapse.weight);

    // ── Update Φ phase assessment ─────────────────────────────────
    this.assessPhaseTransition(now);

    // ── Update predictive error correction ────────────────────────
    this.observeQScore(now);

    this.recordAudit({
      peerId,
      kind: options.kind,
      success: options.success,
      trustDelta: neuron.trust - trustBefore,
      weightDelta: synapse.weight - weightBefore,
      energyDelta: neuron.energy - energyBefore,
      memoryDelta: neuron.memory - memoryBefore,
      timestamp: now,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // BELL CURVE — Online statistics per interaction kind
  // ═══════════════════════════════════════════════════════════════════

  /** Welford's online update */
  private updateBellCurve(kind: InteractionKind, value: number): void {
    let stats = this.bellCurves.get(kind);
    if (!stats) {
      stats = { kind, count: 0, mean: 0, m2: 0, min: value, max: value };
      this.bellCurves.set(kind, stats);
    }

    stats.count += 1;
    const delta = value - stats.mean;
    stats.mean += delta / stats.count;
    const delta2 = value - stats.mean;
    stats.m2 += delta * delta2;
    stats.min = Math.min(stats.min, value);
    stats.max = Math.max(stats.max, value);
  }

  /** Evaluate where a value sits on the bell curve for a given kind */
  private evaluateBellCurve(kind: InteractionKind, value: number): BellCurvePosition | null {
    const stats = this.bellCurves.get(kind);
    if (!stats || stats.count < 5) return null; // need baseline

    const sd = getStdDev(stats);
    if (sd === 0) {
      return {
        kind, value, zScore: 0,
        isOutlier: false, isRare: false,
        percentile: 50,
      };
    }

    const z = (value - stats.mean) / sd;
    return {
      kind,
      value,
      zScore: z,
      isOutlier: Math.abs(z) > OUTLIER_Z,
      isRare: Math.abs(z) > RARE_Z,
      percentile: Math.round(approxNormalCDF(z) * 100),
    };
  }

  /** Public API: check where a value sits on the bell curve */
  getBellCurvePosition(kind: InteractionKind, value: number): BellCurvePosition | null {
    return this.evaluateBellCurve(kind, value);
  }

  getBellCurveStats(): BellCurveStats[] {
    return Array.from(this.bellCurves.values());
  }

  getBellCurveStatsForKind(kind: InteractionKind): BellCurveStats | null {
    return this.bellCurves.get(kind) ?? null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Φ — TRANSITION QUALITY
  // ═══════════════════════════════════════════════════════════════════

  /** Derive network phase from current neuron aggregate state */
  private derivePhase(): NetworkPhase {
    const neurons = Array.from(this.neurons.values());
    if (neurons.length === 0) return 'bootstrapping';

    const avgTrust = neurons.reduce((s, n) => s + n.trust, 0) / neurons.length;
    const avgEnergy = neurons.reduce((s, n) => s + n.energy, 0) / neurons.length;
    const activePeers = neurons.filter(
      (n) => Date.now() - n.lastSeen < STALE_THRESHOLD_MS
    ).length;

    if (activePeers === 0) return 'bootstrapping';
    if (activePeers <= 1 && avgTrust < 30) return 'connecting';
    if (avgTrust < 25) return 'degraded';
    if (avgTrust < 40 && avgEnergy < 3) return 'recovering';
    return 'stable';
  }

  /** Record a phase transition with smoothness scoring */
  private assessPhaseTransition(now: number): void {
    const newPhase = this.derivePhase();
    if (newPhase === this.currentPhase) return;

    const fromPhase = this.currentPhase;

    // Compute aggregate trust/energy deltas for cause attribution
    const neurons = Array.from(this.neurons.values());
    const avgTrust = neurons.length > 0
      ? neurons.reduce((s, n) => s + n.trust, 0) / neurons.length
      : 0;
    const avgEnergy = neurons.length > 0
      ? neurons.reduce((s, n) => s + n.energy, 0) / neurons.length
      : 0;

    const prevTransition = this.phiHistory[this.phiHistory.length - 1];
    const prevTrust = prevTransition?.trustDelta ?? 0;
    const prevEnergy = prevTransition?.energyDelta ?? 0;

    // Smoothness: how gradual was this transition?
    // Big trust swings → low smoothness; gentle drift → high smoothness
    const trustSwing = Math.abs(avgTrust - INITIAL_TRUST);
    const smoothness = Math.max(0, Math.min(1, 1 - trustSwing / 50));

    // Cause: contextual if peer count changed significantly, internal otherwise
    const prevPeerCount = prevTransition
      ? this.neurons.size
      : 0;
    const cause: PhiTransition['cause'] =
      Math.abs(this.neurons.size - prevPeerCount) > 1
        ? 'contextual'
        : 'internal';

    const transition: PhiTransition = {
      from: fromPhase,
      to: newPhase,
      timestamp: now,
      smoothness,
      cause,
      trustDelta: avgTrust - (prevTransition ? prevTransition.trustDelta + INITIAL_TRUST : INITIAL_TRUST),
      energyDelta: avgEnergy - (prevTransition ? prevTransition.energyDelta : 0),
    };

    this.phiHistory.push(transition);
    if (this.phiHistory.length > PHI_WINDOW) this.phiHistory.shift();

    // Update running Φ (exponential moving average of smoothness)
    const alpha = 0.3;
    this.phiValue = this.phiValue * (1 - alpha) + smoothness * alpha;

    this.currentPhase = newPhase;

    console.log(
      `[Neural:Φ] Phase ${fromPhase} → ${newPhase} (smoothness: ${smoothness.toFixed(2)}, Φ: ${this.phiValue.toFixed(3)}, cause: ${cause})`
    );
  }

  /** Get Φ transition quality snapshot */
  getPhiSnapshot(): PhiSnapshot {
    const avgSmoothness = this.phiHistory.length > 0
      ? this.phiHistory.reduce((s, t) => s + t.smoothness, 0) / this.phiHistory.length
      : 1;

    let recommendation: PhiSnapshot['recommendation'] = 'hold';
    if (this.phiValue < PHI_UNSTABLE_THRESHOLD) {
      recommendation = 'tighten'; // unstable — tighten control
    } else if (this.phiValue > PHI_RIGID_THRESHOLD) {
      recommendation = 'relax';  // too rigid — allow flexibility
    }

    return {
      currentPhase: this.currentPhase,
      phi: this.phiValue,
      transitionCount: this.phiHistory.length,
      averageSmoothness: avgSmoothness,
      lastTransition: this.phiHistory[this.phiHistory.length - 1] ?? null,
      recommendation,
    };
  }

  getPhiHistory(): PhiTransition[] {
    return [...this.phiHistory];
  }

  /** Apply time-based decay to stale neurons so scores don't inflate */
  private maybeDecay(now: number): void {
    if (now - this.lastDecayAt < DECAY_INTERVAL_MS) {
      return;
    }
    this.lastDecayAt = now;

    for (const [peerId, neuron] of this.neurons) {
      const staleness = now - neuron.lastSeen;
      if (staleness > STALE_THRESHOLD_MS) {
        // Decay trust and synapse weights for stale peers
        neuron.trust = Math.max(0, Math.round(neuron.trust * DECAY_FACTOR));
        neuron.energy = Math.max(0, Math.round(neuron.energy * DECAY_FACTOR));
        for (const [kind, synapse] of neuron.synapses) {
          synapse.weight = Math.max(0, synapse.weight * DECAY_FACTOR);
          if (synapse.weight < 0.01) {
            neuron.synapses.delete(kind);
          }
        }
        // Evict dead neurons
        if (neuron.trust === 0 && neuron.synapses.size === 0 && neuron.energy === 0) {
          this.neurons.delete(peerId);
        }
      }
    }
  }

  selectPeers(candidatePeerIds: string[], count = 3): string[] {
    return candidatePeerIds
      .map((peerId) => ({ peerId, score: this.getPeerScore(peerId) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, count))
      .map((entry) => entry.peerId);
  }

  getPeerScore(peerId: string): number {
    const neuron = this.neurons.get(peerId);
    if (!neuron) {
      return 0;
    }

    // Aggregate weight across all interaction-kind synapses
    let totalWeight = 0;
    for (const synapse of neuron.synapses.values()) {
      totalWeight += synapse.weight;
    }

    // Φ-modulated scoring: when unstable, favor high-trust peers more
    const phiMod = this.phiValue < PHI_UNSTABLE_THRESHOLD ? 0.4 : 0.2;

    return totalWeight + neuron.coins + neuron.trust * phiMod + neuron.activity * 0.1;
  }

  getNeuronState(peerId: string): NeuronState | null {
    return this.neurons.get(peerId) ?? null;
  }

  getAllNeurons(): NeuronState[] {
    return Array.from(this.neurons.values());
  }

  getAuditTrail(peerId?: string): NeuralAuditEvent[] {
    if (!peerId) {
      return [...this.auditTrail];
    }
    return this.auditTrail.filter((entry) => entry.peerId === peerId);
  }

  /** Produce a snapshot for UQRC state integration */
  getNetworkSnapshot(): NeuralNetworkSnapshot {
    const neurons = Array.from(this.neurons.values());
    const totalNeurons = neurons.length;

    if (totalNeurons === 0) {
      return {
        totalNeurons: 0,
        totalSynapses: 0,
        averageTrust: INITIAL_TRUST,
        averageEnergy: 0,
        averageMemory: 0,
        totalCoins: 0,
        healthScore: 0.5,
        topPeers: [],
        auditLength: this.auditTrail.length,
        bellCurves: this.getBellCurveStats(),
        phi: this.getPhiSnapshot(),
        prediction: this.getPredictionSnapshot(),
        instinct: this.instinctHierarchy.getSnapshot(),
        dualLearning: this.dualLearning.getSnapshot(),
      };
    }

    let totalSynapses = 0;
    let trustSum = 0;
    let energySum = 0;
    let memorySum = 0;
    let coinsSum = 0;

    for (const n of neurons) {
      totalSynapses += n.synapses.size;
      trustSum += n.trust;
      energySum += n.energy;
      memorySum += n.memory;
      coinsSum += n.coins;
    }

    const averageTrust = trustSum / totalNeurons;
    const averageEnergy = energySum / totalNeurons;
    const averageMemory = memorySum / totalNeurons;

    // Health = normalized trust (0-1) * synapse density factor * Φ quality
    const normalizedTrust = averageTrust / 100;
    const synapseDensity = Math.min(1, totalSynapses / (totalNeurons * 3));
    const phiFactor = 0.5 + this.phiValue * 0.5; // Φ contributes 0.5-1.0
    const healthScore = Math.min(1, (normalizedTrust * 0.5 + synapseDensity * 0.3 + phiFactor * 0.2));

    const topPeers = neurons
      .map((n) => ({ peerId: n.peerId, score: this.getPeerScore(n.peerId) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // ── Evaluate instinct hierarchy ──────────────────────────────────
    // Wire dual learning metrics into creativity layer signals
    const fusionSnap = this.dualLearning.getSnapshot();
    const instinctSignals = InstinctHierarchy.buildDefaultSignals({
      averagePeerTrust: averageTrust,
      activePeerCount: totalNeurons,
      signalingHealthy: true,
      chainSynced: true,
      noveltyScore: 0.5,
      semanticDensity: 0.5,
      ethicsConfidence: 0.7,
      phiValue: this.phiValue,
      bellCurveCount: this.bellCurves.size,
    });

    // Override creativity signals with dual learning metrics
    instinctSignals.creativity = {
      patternDiversity: fusionSnap.pattern.diversityScore,
      mutationRate: fusionSnap.language.entropy > 0
        ? fusionSnap.language.entropy
        : (1 - this.phiValue), // fallback to Φ-based mutation
    };

    const instinct = this.instinctHierarchy.evaluate(instinctSignals);

    return {
      totalNeurons,
      totalSynapses,
      averageTrust,
      averageEnergy,
      averageMemory,
      totalCoins: coinsSum,
      healthScore,
      topPeers,
      auditLength: this.auditTrail.length,
      bellCurves: this.getBellCurveStats(),
      phi: this.getPhiSnapshot(),
      prediction: this.getPredictionSnapshot(),
      instinct,
      dualLearning: fusionSnap,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PREDICTIVE ERROR CORRECTION — û(t+1) = Predict(u(t))
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Observe an actual value for a named metric.
   * Compares against the previous prediction, records error,
   * then generates the next prediction via exponential smoothing.
   */
  observe(metric: string, actual: number, now = Date.now()): PredictionSample {
    let track = this.predictionTracks.get(metric);
    if (!track) {
      track = {
        metric,
        alpha: PREDICTION_DEFAULT_ALPHA,
        predicted: actual, // first observation = no error
        mae: 0,
        count: 0,
        history: [],
        correctionThreshold: PREDICTION_CORRECTION_THRESHOLD,
      };
      this.predictionTracks.set(metric, track);
    }

    const error = actual - track.predicted;
    const absError = Math.abs(error);

    const sample: PredictionSample = {
      predicted: track.predicted,
      actual,
      error,
      absError,
      timestamp: now,
    };

    // Update running MAE with Welford-like online update
    track.count += 1;
    track.mae += (absError - track.mae) / track.count;

    // û(t+1) = α·actual + (1-α)·û(t)  — exponential smoothing
    track.predicted = track.alpha * actual + (1 - track.alpha) * track.predicted;

    // Store sample history
    track.history.push(sample);
    if (track.history.length > PREDICTION_HISTORY_SIZE) {
      track.history.shift();
    }

    // Log correction signals
    if (track.mae > track.correctionThreshold && track.count > 5) {
      console.log(
        `[Neural:Predict] ${metric} correction needed — MAE: ${track.mae.toFixed(3)}, predicted: ${track.predicted.toFixed(3)}, actual: ${actual.toFixed(3)}`
      );
    }

    return sample;
  }

  /**
   * Feed current Q_Score and content flow metrics into the prediction engine.
   * Call this after each interaction cycle or on a timer.
   */
  observeQScore(now = Date.now()): PredictionSample | null {
    const snapshot = this.getNetworkSnapshotLite();
    if (snapshot.totalNeurons === 0) return null;

    // Q_Score = ||F_μν|| + ||∇_μ∇_ν S(u)|| + λ(ε₀)
    // We approximate F_μν via bell-curve variance spread and Φ instability
    const bellStats = this.getBellCurveStats();
    const varianceSpread = bellStats.length > 0
      ? bellStats.reduce((sum, s) => sum + (s.count > 1 ? s.m2 / (s.count - 1) : 0), 0) / bellStats.length
      : 0;
    const phiSnap = this.getPhiSnapshot();
    const curvature = Math.min(1, varianceSpread / 100); // ||F_μν|| normalized
    const entropyGradient = 1 - phiSnap.phi;              // ||∇∇S|| — instability
    const lambda = 1e-100;                                  // λ(ε₀)
    const qScore = curvature + entropyGradient + lambda;

    // Observe Q_Score prediction
    const qSample = this.observe('qScore', qScore, now);

    // Observe content flow per interaction kind
    for (const kind of ['chunk', 'manifest', 'gossip', 'sync'] as InteractionKind[]) {
      const stats = this.bellCurves.get(kind);
      if (stats && stats.count > 0) {
        this.observe(`flow:${kind}`, stats.mean, now);
      }
    }

    return qSample;
  }

  /** Lightweight snapshot that avoids recursion (no prediction field) */
  private getNetworkSnapshotLite(): { totalNeurons: number; healthScore: number } {
    const neurons = Array.from(this.neurons.values());
    if (neurons.length === 0) return { totalNeurons: 0, healthScore: 0.5 };
    const avgTrust = neurons.reduce((s, n) => s + n.trust, 0) / neurons.length;
    return {
      totalNeurons: neurons.length,
      healthScore: Math.min(1, avgTrust / 100),
    };
  }

  /** Get the current prediction for a metric */
  getPrediction(metric: string): number | null {
    return this.predictionTracks.get(metric)?.predicted ?? null;
  }

  /** Get full prediction track for a metric */
  getPredictionTrack(metric: string): PredictionTrack | null {
    return this.predictionTracks.get(metric) ?? null;
  }

  /** Aggregate prediction snapshot for the network snapshot */
  getPredictionSnapshot(): PredictionSnapshot {
    const tracks = Array.from(this.predictionTracks.values());
    const trackSummaries = tracks.map((t) => {
      const lastSample = t.history[t.history.length - 1];
      return {
        metric: t.metric,
        predicted: t.predicted,
        lastActual: lastSample?.actual ?? t.predicted,
        lastError: lastSample?.error ?? 0,
        mae: t.mae,
        correctionNeeded: t.mae > t.correctionThreshold && t.count > 5,
      };
    });

    // Overall accuracy: 1 - normalized average MAE across all tracks
    const avgMae = tracks.length > 0
      ? tracks.reduce((s, t) => s + Math.min(1, t.mae), 0) / tracks.length
      : 0;

    return {
      tracks: trackSummaries,
      accuracy: Math.max(0, 1 - avgMae),
    };
  }

  /**
   * Set the smoothing factor α for a specific prediction track.
   * Higher α = more reactive to recent values; lower = smoother predictions.
   */
  setPredictionAlpha(metric: string, alpha: number): void {
    const track = this.predictionTracks.get(metric);
    if (track) {
      track.alpha = Math.max(0.01, Math.min(0.99, alpha));
    }
  }

  // ── Instinct Hierarchy Public API ────────────────────────────────
  /** Direct access to the instinct hierarchy for layer-level queries */
  getInstinctHierarchy(): InstinctHierarchy {
    return this.instinctHierarchy;
  }

  /** Check if a specific instinct layer is currently active */
  isInstinctLayerActive(layer: import('./instinctHierarchy').InstinctLayer): boolean {
    return this.instinctHierarchy.isLayerActive(layer);
  }

  // ── Dual Learning Public API ──────────────────────────────────────

  /**
   * Ingest a content event (post/comment with engagement metrics)
   * into the dual learning system. Gates on Instinct Layer 8 (Creativity).
   */
  ingestContentEvent(event: ContentEvent): void {
    // Only learn when creativity layer is active (layers 1-7 stable)
    const creativityActive = this.instinctHierarchy.isLayerActive('creativity');
    if (!creativityActive) {
      console.log('[Neural:DualLearning] Creativity layer suppressed — skipping content ingestion');
      return;
    }
    this.dualLearning.ingestContentEvent(event);
  }

  /** Get the dual learning fusion instance */
  getDualLearning(): DualLearningFusion {
    return this.dualLearning;
  }

  /** Check if the dual learning system is ready to generate */
  isDualLearningReady(): boolean {
    return this.dualLearning.isGenerationReady();
  }

  // ── Future: Peer Behavior Prediction ────────────────────────────────
  // TODO: Predict per-peer connection stability using individual neuron
  // trust/energy trajectories. When a peer's predicted trust diverges
  // significantly from actual, flag for preemptive soft-reconnect or
  // deprioritization in selectPeers(). See docs/ROADMAP_PROJECTION.md.

  /** Total interaction count across all neurons (for entity voice stage computation) */
  getTotalInteractionCount(): number {
    let total = 0;
    for (const n of this.neurons.values()) {
      total += n.activity;
    }
    // SEC-001: Persist for brain-stage-gated signature enforcement
    try { localStorage.setItem('neural-total-interactions', String(total)); } catch { /* ignore */ }
    return total;
  }

   private recordAudit(event: NeuralAuditEvent): void {
    this.auditTrail.push(event);
    if (this.auditTrail.length > 400) {
      this.auditTrail.shift();
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PERSISTENCE — localStorage snapshot for rebirth across reloads
  // ═══════════════════════════════════════════════════════════════════

  private static readonly STORAGE_KEY = 'neural-engine-snapshot';
  private lastPersistAt = 0;
  private static readonly PERSIST_THROTTLE_MS = 10_000;

  /** Export a serializable digest of the brain state */
  exportDigest(): NeuralStateDigest {
    const neurons: NeuralStateDigest['neurons'] = [];
    for (const n of this.neurons.values()) {
      const synapses: Record<string, { weight: number; latencyMs: number | null; throughputKbps: number | null; lastActive: number }> = {};
      for (const [kind, s] of n.synapses) {
        synapses[kind] = { weight: s.weight, latencyMs: s.latencyMs, throughputKbps: s.throughputKbps, lastActive: s.lastActive };
      }
      neurons.push({
        peerId: n.peerId,
        energy: n.energy,
        memory: n.memory,
        trust: n.trust,
        activity: n.activity,
        coins: n.coins,
        lastSeen: n.lastSeen,
        synapses,
      });
    }

    const bellCurves: NeuralStateDigest['bellCurves'] = [];
    for (const bc of this.bellCurves.values()) {
      bellCurves.push({ ...bc });
    }

    return {
      neurons,
      bellCurves,
      phiValue: this.phiValue,
      currentPhase: this.currentPhase,
      totalInteractions: this.getTotalInteractionCount(),
      vocab: this.dualLearning.languageLearner.exportVocab(),
      patterns: this.dualLearning.patternLearner.exportPatterns(),
      transitions: this.dualLearning.languageLearner.exportTransitions(),
      mergedPhrases: this.dualLearning.languageLearner.exportMergedPhrases(),
      timestamp: Date.now(),
    };
  }

  /** Import a peer's digest — merge with local state, keeping the richer values */
  importDigest(digest: NeuralStateDigest): void {
    if (!digest || !digest.neurons) return;

    // Merge neurons — keep higher trust/energy/memory/coins per peer
    for (const incoming of digest.neurons) {
      const existing = this.neurons.get(incoming.peerId);
      if (!existing) {
        // New peer we've never seen — adopt fully
        const synapses = new Map<InteractionKind, SynapseState>();
        for (const [kind, s] of Object.entries(incoming.synapses)) {
          synapses.set(kind as InteractionKind, { ...s });
        }
        this.neurons.set(incoming.peerId, {
          peerId: incoming.peerId,
          energy: incoming.energy,
          memory: incoming.memory,
          trust: incoming.trust,
          activity: incoming.activity,
          coins: incoming.coins,
          lastSeen: incoming.lastSeen,
          synapses,
        });
      } else {
        // Merge — keep the max of each metric
        existing.trust = Math.max(existing.trust, incoming.trust);
        existing.energy = Math.max(existing.energy, incoming.energy);
        existing.memory = Math.max(existing.memory, incoming.memory);
        existing.coins = Math.max(existing.coins, incoming.coins);
        existing.activity = Math.max(existing.activity, incoming.activity);
        existing.lastSeen = Math.max(existing.lastSeen, incoming.lastSeen);

        // Merge synapses — keep higher weight per kind
        for (const [kind, s] of Object.entries(incoming.synapses)) {
          const k = kind as InteractionKind;
          const local = existing.synapses.get(k);
          if (!local || s.weight > local.weight) {
            existing.synapses.set(k, { ...s });
          }
        }
      }
    }

    // Merge bell curves — use combined Welford (approximate)
    for (const bc of digest.bellCurves) {
      const local = this.bellCurves.get(bc.kind);
      if (!local) {
        this.bellCurves.set(bc.kind, { ...bc });
      } else {
        // Combine running stats — weighted merge
        const totalCount = local.count + bc.count;
        if (totalCount > 0) {
          const delta = bc.mean - local.mean;
          local.mean = (local.mean * local.count + bc.mean * bc.count) / totalCount;
          local.m2 = local.m2 + bc.m2 + delta * delta * (local.count * bc.count) / totalCount;
          local.count = totalCount;
          local.min = Math.min(local.min, bc.min);
          local.max = Math.max(local.max, bc.max);
        }
      }
    }

    // Merge Φ — adopt if peer has higher quality
    if (digest.phiValue > this.phiValue) {
      this.phiValue = digest.phiValue;
    }

    // Merge vocabulary and patterns
    if (digest.vocab) {
      this.dualLearning.languageLearner.mergeVocab(digest.vocab);
    }
    if (digest.patterns) {
      this.dualLearning.patternLearner.mergePatterns(digest.patterns);
    }
    // Merge transitions — the covariant derivative 𝒟_transition u
    if (digest.transitions) {
      this.dualLearning.languageLearner.mergeTransitions(digest.transitions);
    }
    // Merge phrases
    if (digest.mergedPhrases) {
      this.dualLearning.languageLearner.mergePhrases(digest.mergedPhrases);
    }

    console.log(`[NeuralEngine] 🧠 Imported digest from peer — ${digest.neurons.length} neurons, ${digest.bellCurves.length} curves, vocab=${Object.keys(digest.vocab ?? {}).length}, transitions=${Object.keys(digest.transitions ?? {}).length}`);
  }

  /** Save brain state to localStorage (throttled) */
  persistToStorage(): void {
    const n = Date.now();
    if (n - this.lastPersistAt < NeuralStateEngine.PERSIST_THROTTLE_MS) return;
    this.lastPersistAt = n;

    try {
      const digest = this.exportDigest();
      localStorage.setItem(NeuralStateEngine.STORAGE_KEY, JSON.stringify(digest));
    } catch (err) {
      console.warn('[NeuralEngine] Failed to persist brain state:', err);
    }
  }

  /** Restore brain state from localStorage (call in constructor or on boot) */
  restoreFromStorage(): void {
    try {
      const raw = localStorage.getItem(NeuralStateEngine.STORAGE_KEY);
      if (!raw) return;
      const digest = JSON.parse(raw) as NeuralStateDigest;
      if (!digest || !digest.neurons) return;
      this.importDigest(digest);
      console.log('[NeuralEngine] 🧠 Restored brain state from localStorage');
    } catch (err) {
      console.warn('[NeuralEngine] Failed to restore brain state:', err);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// DIGEST TYPE — serializable snapshot for exchange & persistence
// ═══════════════════════════════════════════════════════════════════════

export interface NeuralStateDigest {
  neurons: Array<{
    peerId: string;
    energy: number;
    memory: number;
    trust: number;
    activity: number;
    coins: number;
    lastSeen: number;
    synapses: Record<string, { weight: number; latencyMs: number | null; throughputKbps: number | null; lastActive: number }>;
  }>;
  bellCurves: BellCurveStats[];
  phiValue: number;
  currentPhase: NetworkPhase;
  totalInteractions: number;
  vocab: Record<string, number>;
  patterns: Record<string, { score: number; reward: number; occurrences: number }>;
  /** Transition maps (bigram/trigram → next-token probabilities) — the covariant derivative 𝒟_transition u */
  transitions?: Record<string, { nextTokens: Record<string, number>; totalWeight: number }>;
  /** Merged phrases (frequently co-occurring bigrams fused into single tokens) */
  mergedPhrases?: string[];
  timestamp: number;
}
