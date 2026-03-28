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
    };
  }

  private recordAudit(event: NeuralAuditEvent): void {
    this.auditTrail.push(event);
    if (this.auditTrail.length > 400) {
      this.auditTrail.shift();
    }
  }
}
