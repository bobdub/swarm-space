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

export class NeuralStateEngine {
  private readonly neurons = new Map<string, NeuronState>();
  private readonly auditTrail: NeuralAuditEvent[] = [];
  private lastDecayAt = Date.now();

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

    if (options.success) {
      synapse.weight += DEFAULT_DOPAMINE;
      neuron.trust = Math.min(100, neuron.trust + 1);
      neuron.coins += 1;
      if (options.kind === 'chunk' || options.kind === 'manifest' || options.kind === 'sync') {
        neuron.memory += 1;
      }
      if (options.kind === 'connection' || options.kind === 'ping') {
        neuron.energy += 1;
      }
    } else {
      synapse.weight = Math.max(0, synapse.weight - DEFAULT_PENALTY);
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

    return totalWeight + neuron.coins + neuron.trust * 0.2 + neuron.activity * 0.1;
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

    // Health = normalized trust (0-1) * synapse density factor
    const normalizedTrust = averageTrust / 100;
    const synapseDensity = Math.min(1, totalSynapses / (totalNeurons * 3));
    const healthScore = Math.min(1, (normalizedTrust * 0.6) + (synapseDensity * 0.4));

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
    };
  }

  private recordAudit(event: NeuralAuditEvent): void {
    this.auditTrail.push(event);
    if (this.auditTrail.length > 400) {
      this.auditTrail.shift();
    }
  }
}
