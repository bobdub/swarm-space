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
  synapses: Map<string, SynapseState>;
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

export class NeuralStateEngine {
  private readonly neurons = new Map<string, NeuronState>();
  private readonly auditTrail: NeuralAuditEvent[] = [];

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
    const neuron = this.neurons.get(peerId);
    if (!neuron) {
      return;
    }

    neuron.lastSeen = now;
    neuron.activity += 1;

    const synapse = neuron.synapses.get(peerId) ?? {
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
    neuron.synapses.set(peerId, synapse);

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

    const synapse = neuron.synapses.get(peerId);
    const synapseWeight = synapse?.weight ?? INITIAL_WEIGHT;
    return synapseWeight + neuron.coins + neuron.trust * 0.2 + neuron.activity * 0.1;
  }

  getNeuronState(peerId: string): NeuronState | null {
    return this.neurons.get(peerId) ?? null;
  }

  getAuditTrail(peerId?: string): NeuralAuditEvent[] {
    if (!peerId) {
      return [...this.auditTrail];
    }
    return this.auditTrail.filter((entry) => entry.peerId === peerId);
  }

  private recordAudit(event: NeuralAuditEvent): void {
    this.auditTrail.push(event);
    if (this.auditTrail.length > 400) {
      this.auditTrail.shift();
    }
  }
}
