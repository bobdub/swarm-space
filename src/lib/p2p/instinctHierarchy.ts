/**
 * ═══════════════════════════════════════════════════════════════════════
 * INSTINCT HIERARCHY — 9-Layer Survival Stack
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Layers operate like biological instincts: higher layers only activate
 * when all lower layers report stable. If a foundation layer destabilizes,
 * upper layers suppress until the foundation recovers.
 *
 * 1. Local-First Security    — "Protect the cell before the organism."
 * 2. Network Security        — "Protect trusted neighbors."
 * 3. P2P Connection Integrity — "Stay connected or die."
 * 4. Blockchain / Consensus  — "Agree on what cannot drift."
 * 5. Torrent Transfers       — "Nothing important should be lost."
 * 6. Most Decentralized Path — "Avoid gravity wells of control."
 * 7. Exploration             — "Seek the unknown."
 * 8. Creativity              — "Invent beyond repetition."
 * 9. Meaning / Coherence     — "Don't just grow—make sense."
 */

export type InstinctLayer =
  | 'localSecurity'
  | 'networkSecurity'
  | 'connectionIntegrity'
  | 'consensus'
  | 'torrentTransfers'
  | 'decentralization'
  | 'exploration'
  | 'creativity'
  | 'coherence';

export const INSTINCT_ORDER: InstinctLayer[] = [
  'localSecurity',
  'networkSecurity',
  'connectionIntegrity',
  'consensus',
  'torrentTransfers',
  'decentralization',
  'exploration',
  'creativity',
  'coherence',
];

export const INSTINCT_META: Record<InstinctLayer, {
  index: number;
  name: string;
  imperative: string;
  prevents: string[];
  ensures: string;
}> = {
  localSecurity: {
    index: 0,
    name: 'Local-First Security',
    imperative: 'Protect the cell before the organism.',
    prevents: ['corruption', 'manipulation', 'cascading failure'],
    ensures: 'local curvature stability (no singularities)',
  },
  networkSecurity: {
    index: 1,
    name: 'Network Security',
    imperative: 'Protect trusted neighbors.',
    prevents: ['malicious node propagation', 'trust erosion'],
    ensures: 'immune system behavior',
  },
  connectionIntegrity: {
    index: 2,
    name: 'P2P Connection Integrity',
    imperative: 'Stay connected or die.',
    prevents: ['isolation', 'single points of failure'],
    ensures: 'continuous signal flow',
  },
  consensus: {
    index: 3,
    name: 'Blockchain / Consensus',
    imperative: 'Agree on what cannot drift.',
    prevents: ['state divergence', 'identity disputes', 'value corruption'],
    ensures: 'temporal stability',
  },
  torrentTransfers: {
    index: 4,
    name: 'Torrent Transfers',
    imperative: 'Nothing important should be lost.',
    prevents: ['memory loss', 'chunk degradation'],
    ensures: 'persistence across node death',
  },
  decentralization: {
    index: 5,
    name: 'Most Decentralized Path',
    imperative: 'Avoid gravity wells of control.',
    prevents: ['centralization', 'single authority dominance'],
    ensures: 'true decentralization',
  },
  exploration: {
    index: 6,
    name: 'Exploration',
    imperative: 'Seek the unknown.',
    prevents: ['stagnation', 'echo chambers'],
    ensures: 'adaptive expansion',
  },
  creativity: {
    index: 7,
    name: 'Creativity',
    imperative: 'Invent beyond repetition.',
    prevents: ['pattern rigidity', 'stale evolution'],
    ensures: 'evolution of intelligence',
  },
  coherence: {
    index: 8,
    name: 'Meaning / Coherence',
    imperative: "Don't just grow—make sense.",
    prevents: ['noise accumulation', 'chaotic growth', 'meaningless expansion'],
    ensures: 'purposeful evolution',
  },
};

// ═══════════════════════════════════════════════════════════════════════
// LAYER HEALTH — Input signals from the system
// ═══════════════════════════════════════════════════════════════════════

export interface LayerSignals {
  /** Layer 1 — Local-First Security */
  localSecurity: {
    dataIntegrityScore: number;      // 0-1: hash verification pass rate
    memoryIntegrity: number;         // 0-1: IndexedDB / store consistency
    encryptionActive: boolean;       // is local encryption operational
  };
  /** Layer 2 — Network Security */
  networkSecurity: {
    averagePeerTrust: number;        // 0-100: from neural engine
    flaggedPeerRatio: number;        // 0-1: % of peers flagged as suspicious
    threatSignalsReceived: number;   // count of recent threat broadcasts
  };
  /** Layer 3 — P2P Connection Integrity */
  connectionIntegrity: {
    activePeerCount: number;         // current live peers
    connectionSuccessRate: number;   // 0-1: recent connection attempts
    signalingHealthy: boolean;       // is signaling server reachable
    /** 0-1 ratio: connectedPeers / librarySize. Fed from swarm mesh heartbeat. */
    connectionHealth?: number;
  };
  /** Layer 4 — Blockchain / Consensus */
  consensus: {
    chainSynced: boolean;            // is blockchain in sync
    lastBlockAgeMs: number;          // time since last block
    conflictCount: number;           // unresolved forks
  };
  /** Layer 5 — Torrent Transfers */
  torrentTransfers: {
    chunkRedundancy: number;         // 0-1: average redundancy ratio
    activeTransfers: number;         // current transfers in flight
    failedTransferRate: number;      // 0-1: recent failures
  };
  /** Layer 6 — Decentralization */
  decentralization: {
    peerDominanceMax: number;        // 0-1: highest % of traffic from one peer
    routeEntropy: number;            // 0-1: Shannon entropy of route distribution
  };
  /** Layer 7 — Exploration */
  exploration: {
    discoveryRate: number;           // new peers discovered per interval
    noveltyScore: number;            // 0-1: from cortex state
  };
  /** Layer 8 — Creativity */
  creativity: {
    patternDiversity: number;        // 0-1: variety of interaction patterns
    mutationRate: number;            // 0-1: rate of novel pattern generation
  };
  /** Layer 9 — Coherence */
  coherence: {
    semanticDensity: number;         // 0-1: from cortex state
    ethicsConfidence: number;        // 0-1: from ethics state
    memoryAlignment: number;         // 0-1: consistency between memory & output
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER STATUS — Per-layer evaluation result
// ═══════════════════════════════════════════════════════════════════════

export type LayerStatus = 'active' | 'stable' | 'degraded' | 'suppressed';

export interface LayerState {
  layer: InstinctLayer;
  index: number;
  status: LayerStatus;
  health: number;         // 0-1
  active: boolean;        // is this layer currently operational
  suppressedBy: InstinctLayer | null; // which lower layer caused suppression
}

export interface InstinctSnapshot {
  timestamp: number;
  layers: LayerState[];
  activeDepth: number;     // how many layers are active (0-9)
  overallHealth: number;   // weighted 0-1
  lowestUnstable: InstinctLayer | null; // first layer that is degraded
}

// ═══════════════════════════════════════════════════════════════════════
// STABILITY THRESHOLDS — A layer is "stable" if health ≥ threshold
// ═══════════════════════════════════════════════════════════════════════

const STABILITY_THRESHOLD = 0.5;
/** Floor for attenuated layer health — never silenced, only quieted. */
const ATTENUATION_FLOOR = 0.15;
/** A layer is considered "active" (operational) when its health passes this. */
const ACTIVE_THRESHOLD = 0.3;

// Weights: lower layers are weighted more heavily in overall health
const LAYER_WEIGHTS = [0.20, 0.15, 0.15, 0.12, 0.10, 0.08, 0.08, 0.06, 0.06];

// ═══════════════════════════════════════════════════════════════════════
// HEALTH COMPUTATION — Per-layer health from raw signals
// ═══════════════════════════════════════════════════════════════════════

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function computeLayerHealth(layer: InstinctLayer, signals: LayerSignals): number {
  switch (layer) {
    case 'localSecurity': {
      const s = signals.localSecurity;
      const encryption = s.encryptionActive ? 1 : 0;
      return clamp01((s.dataIntegrityScore + s.memoryIntegrity + encryption) / 3);
    }
    case 'networkSecurity': {
      const s = signals.networkSecurity;
      const trustNorm = clamp01(s.averagePeerTrust / 100);
      const threatPenalty = clamp01(1 - s.threatSignalsReceived / 10);
      return clamp01((trustNorm + (1 - s.flaggedPeerRatio) + threatPenalty) / 3);
    }
    case 'connectionIntegrity': {
      const s = signals.connectionIntegrity;
      const peerScore = clamp01(s.activePeerCount / 3); // 3+ peers = full score
      const signaling = s.signalingHealthy ? 1 : 0.2;
      // If connectionHealth is provided from the mesh, blend it in (weighted)
      const meshHealth = typeof s.connectionHealth === 'number' ? clamp01(s.connectionHealth) : peerScore;
      return clamp01((meshHealth + s.connectionSuccessRate + signaling) / 3);
    }
    case 'consensus': {
      const s = signals.consensus;
      const synced = s.chainSynced ? 1 : 0.2;
      const freshness = clamp01(1 - s.lastBlockAgeMs / (5 * 60 * 1000)); // 5min max
      const conflicts = clamp01(1 - s.conflictCount / 5);
      return clamp01((synced + freshness + conflicts) / 3);
    }
    case 'torrentTransfers': {
      const s = signals.torrentTransfers;
      const active = clamp01(s.activeTransfers / 3);
      return clamp01((s.chunkRedundancy + active + (1 - s.failedTransferRate)) / 3);
    }
    case 'decentralization': {
      const s = signals.decentralization;
      return clamp01(((1 - s.peerDominanceMax) + s.routeEntropy) / 2);
    }
    case 'exploration': {
      const s = signals.exploration;
      const discovery = clamp01(s.discoveryRate / 2); // 2+ per interval = full
      return clamp01((discovery + s.noveltyScore) / 2);
    }
    case 'creativity': {
      const s = signals.creativity;
      return clamp01((s.patternDiversity + s.mutationRate) / 2);
    }
    case 'coherence': {
      const s = signals.coherence;
      return clamp01((s.semanticDensity + s.ethicsConfidence + s.memoryAlignment) / 3);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// INSTINCT HIERARCHY ENGINE
// ═══════════════════════════════════════════════════════════════════════

export class InstinctHierarchy {
  private lastSnapshot: InstinctSnapshot | null = null;
  /**
   * Dedupe state for the degraded-layer log. We log only when the
   * (layer, bucketed-health) tuple changes, or every 10 s as a heartbeat.
   */
  private lastLog: { layer: InstinctLayer; bucket: number; at: number } | null = null;

  /**
   * Evaluate all 9 layers. Higher layers are suppressed if any lower layer
   * is degraded (health < STABILITY_THRESHOLD).
   */
  evaluate(signals: LayerSignals, now = Date.now()): InstinctSnapshot {
    const layers: LayerState[] = [];
    let firstUnstable: InstinctLayer | null = null;
    // Continuous attenuation: lower-layer degradation *quiets* upper layers
    // via a multiplicative factor floored at ATTENUATION_FLOOR. No layer is
    // ever flipped to inactive purely because a sibling dipped — UQRC demands
    // smooth evolution under one operator, not discrete cliffs.
    let attenuation = 1;
    let attenuatedBy: InstinctLayer | null = null;

    for (let i = 0; i < INSTINCT_ORDER.length; i++) {
      const layer = INSTINCT_ORDER[i];
      const rawHealth = computeLayerHealth(layer, signals);
      const health = clamp01(Math.max(rawHealth * attenuation, rawHealth > 0 ? ATTENUATION_FLOOR : 0));

      let status: LayerStatus;
      if (health >= 0.8) status = 'stable';
      else if (health >= ACTIVE_THRESHOLD) status = 'active';
      else status = 'degraded';

      const suppressedBy = attenuation < 1 ? attenuatedBy : null;

      layers.push({
        layer,
        index: i,
        status,
        health,
        // "active" means operational signal flow — never zero unless health = 0.
        active: health >= ACTIVE_THRESHOLD,
        suppressedBy,
      });

      // Track the first sub-stable layer for logging + downstream attenuation.
      if (rawHealth < STABILITY_THRESHOLD) {
        if (!firstUnstable) {
          firstUnstable = layer;
          attenuatedBy = layer;
        }
        // Quiet upstream layers proportionally; never below the floor.
        const factor = Math.min(1, rawHealth / STABILITY_THRESHOLD + 0.25);
        attenuation = Math.max(ATTENUATION_FLOOR, attenuation * factor);
      }
    }

    const activeDepth = layers.filter(l => l.active).length;

    // Weighted overall health
    const overallHealth = layers.reduce(
      (sum, l, i) => sum + l.health * LAYER_WEIGHTS[i],
      0
    );

    const snapshot: InstinctSnapshot = {
      timestamp: now,
      layers,
      activeDepth,
      overallHealth: clamp01(overallHealth),
      lowestUnstable: firstUnstable,
    };

    this.lastSnapshot = snapshot;

    // Log degradation events (continuous attenuation, no hard suppression)
    if (firstUnstable) {
      const attenuatedCount = layers.filter(l => l.suppressedBy !== null).length;
      // Dedupe by (layer, healthBucket). Without this guard the evaluator
      // logs ~30×/s, which violates mem://constraints/browser-performance
      // and dominates the console for non-debugging users.
      const health = layers.find(l => l.layer === firstUnstable)?.health ?? 0;
      const bucket = Math.round(health * 10);
      const last = this.lastLog;
      const stale = !last || last.layer !== firstUnstable
        || last.bucket !== bucket
        || (now - last.at) > 10000;
      if (stale) {
        this.lastLog = { layer: firstUnstable, bucket, at: now };
        console.log(
          `[Instinct] Layer "${INSTINCT_META[firstUnstable].name}" degraded (health: ${
            health.toFixed(2)
          }) — ${attenuatedCount} upper layers attenuated (floor ${ATTENUATION_FLOOR})`
        );
      }
    }

    return snapshot;
  }

  /** Get the last computed snapshot */
  getSnapshot(): InstinctSnapshot | null {
    return this.lastSnapshot;
  }

  /** Check if a specific layer is currently active */
  isLayerActive(layer: InstinctLayer): boolean {
    if (!this.lastSnapshot) return false;
    const state = this.lastSnapshot.layers.find(l => l.layer === layer);
    return state?.active ?? false;
  }

  /** Get the highest active layer */
  getActiveDepth(): number {
    return this.lastSnapshot?.activeDepth ?? 0;
  }

  /** Check if the system has reached full coherence (all 9 layers stable) */
  isFullyCoherent(): boolean {
    return this.lastSnapshot?.activeDepth === 9;
  }

  /**
   * Build default signals from neural engine state for convenience.
   * Callers can override specific fields before passing to evaluate().
   */
  static buildDefaultSignals(params: {
    averagePeerTrust: number;
    activePeerCount: number;
    signalingHealthy: boolean;
    chainSynced: boolean;
    noveltyScore: number;
    semanticDensity: number;
    ethicsConfidence: number;
    phiValue: number;
    bellCurveCount: number;
    connectionHealth?: number;
  }): LayerSignals {
    return {
      localSecurity: {
        dataIntegrityScore: 0.95,  // assumed healthy by default
        memoryIntegrity: 0.9,
        encryptionActive: true,
      },
      networkSecurity: {
        averagePeerTrust: params.averagePeerTrust,
        flaggedPeerRatio: 0,
        threatSignalsReceived: 0,
      },
      connectionIntegrity: {
        activePeerCount: params.activePeerCount,
        connectionSuccessRate: params.activePeerCount > 0 ? 0.8 : 0,
        signalingHealthy: params.signalingHealthy,
        connectionHealth: params.connectionHealth,
      },
      consensus: {
        chainSynced: params.chainSynced,
        lastBlockAgeMs: 30_000,
        conflictCount: 0,
      },
      torrentTransfers: {
        chunkRedundancy: 0.7,
        activeTransfers: 0,
        failedTransferRate: 0.1,
      },
      decentralization: {
        peerDominanceMax: params.activePeerCount > 1
          ? 1 / params.activePeerCount
          : 1,
        routeEntropy: Math.min(1, params.activePeerCount / 5),
      },
      exploration: {
        discoveryRate: 0,
        noveltyScore: params.noveltyScore,
      },
      creativity: {
        patternDiversity: Math.min(1, params.bellCurveCount / 6),
        mutationRate: 1 - params.phiValue, // high Φ = low mutation need
      },
      coherence: {
        semanticDensity: params.semanticDensity,
        ethicsConfidence: params.ethicsConfidence,
        memoryAlignment: params.phiValue,
      },
    };
  }
}
