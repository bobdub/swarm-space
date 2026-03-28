/**
 * ═══════════════════════════════════════════════════════════════════════
 * PATTERN LEARNER — Layer 1 of Dual Learning System
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Learns behavioral sequences and their outcomes from mesh events.
 * Each node builds intuition: which interaction patterns lead to reward,
 * trust, and propagation success.
 *
 * pattern_score += f(reward, trust, repetition) — with diversity pressure
 *
 * UQRC: shaping 𝒪_UQRC(u) — the operator that transforms network state
 */

// ── Event Types ─────────────────────────────────────────────────────

export type PatternEventType =
  | 'post_created'
  | 'post_replied'
  | 'post_reacted'
  | 'post_shared'
  | 'post_ignored'
  | 'propagation_success'
  | 'propagation_failure'
  | 'trust_increase'
  | 'trust_decrease'
  | 'chunk_transferred'
  | 'gossip_sent';

export interface PatternEvent {
  type: PatternEventType;
  peerId?: string;
  reward: number;        // 0-1 engagement signal
  trustScore: number;    // 0-100 author trust
  timestamp: number;
}

// ── Sequence & Model ────────────────────────────────────────────────

export interface PatternSequence {
  /** Ordered list of event types forming this pattern */
  steps: PatternEventType[];
  /** Unique key derived from steps */
  key: string;
}

export interface PatternEntry {
  sequence: PatternSequence;
  score: number;
  reward: number;          // cumulative reward
  trustEffect: number;     // cumulative Δtrust
  occurrences: number;
  lastSeen: number;
}

export interface PatternSnapshot {
  totalPatterns: number;
  topPatterns: Array<{ key: string; score: number; occurrences: number }>;
  diversityScore: number;  // 0-1: Shannon entropy normalized
  averageReward: number;
}

// ── Constants ───────────────────────────────────────────────────────

const EVENT_WINDOW_SIZE = 200;
const MIN_SEQUENCE_LENGTH = 2;
const MAX_SEQUENCE_LENGTH = 5;
const MAX_PATTERNS = 500;
const DIVERSITY_PENALTY_WEIGHT = 0.15;
const REPETITION_DECAY = 0.95;  // diminishing returns per occurrence

// ── Pattern Learner ─────────────────────────────────────────────────

export class PatternLearner {
  private readonly eventWindow: PatternEvent[] = [];
  private readonly patterns = new Map<string, PatternEntry>();

  /**
   * Ingest a mesh event into the sliding window and extract patterns.
   */
  ingestEvent(event: PatternEvent): void {
    this.eventWindow.push(event);
    if (this.eventWindow.length > EVENT_WINDOW_SIZE) {
      this.eventWindow.shift();
    }

    // Extract sequences ending at this event
    this.extractAndScore(event);
  }

  /**
   * Extract all subsequences of length 2-5 ending at the current position
   * and update their scores.
   */
  private extractAndScore(latestEvent: PatternEvent): void {
    const window = this.eventWindow;
    const end = window.length;

    for (let len = MIN_SEQUENCE_LENGTH; len <= MAX_SEQUENCE_LENGTH; len++) {
      if (end < len) break;
      const steps = window.slice(end - len, end).map(e => e.type);
      const key = steps.join('→');
      const sequence: PatternSequence = { steps: steps as PatternEventType[], key };

      this.updatePattern(sequence, latestEvent);
    }
  }

  /**
   * Update rule: pattern_score += f(reward, trust, repetition)
   * with diversity pressure: effective_reward = base_reward - similarity_penalty
   */
  private updatePattern(sequence: PatternSequence, event: PatternEvent): void {
    let entry = this.patterns.get(sequence.key);
    if (!entry) {
      entry = {
        sequence,
        score: 0,
        reward: 0,
        trustEffect: 0,
        occurrences: 0,
        lastSeen: event.timestamp,
      };
      this.patterns.set(sequence.key, entry);
    }

    entry.occurrences += 1;
    entry.lastSeen = event.timestamp;

    // Diminishing returns on repetition
    const repetitionFactor = Math.pow(REPETITION_DECAY, entry.occurrences - 1);

    // Trust weight: high-trust events contribute more
    const trustWeight = Math.max(0.1, event.trustScore / 100);

    // Diversity penalty: penalize patterns that dominate
    const diversityPenalty = this.computeDiversityPenalty(sequence.key);

    // Effective reward with diversity pressure
    const effectiveReward = Math.max(0,
      event.reward * trustWeight * repetitionFactor - diversityPenalty * DIVERSITY_PENALTY_WEIGHT
    );

    // Update score
    entry.score += effectiveReward;
    entry.reward += event.reward;

    // Trust effect tracking
    const trustDelta = event.trustScore > 50 ? 0.1 : -0.1;
    entry.trustEffect += trustDelta;

    // Evict low-scoring patterns if we exceed limit
    if (this.patterns.size > MAX_PATTERNS) {
      this.evictWeakest();
    }
  }

  /**
   * Diversity penalty: ratio of this pattern's occurrences to total.
   * High dominance → high penalty.
   */
  private computeDiversityPenalty(key: string): number {
    const entry = this.patterns.get(key);
    if (!entry) return 0;
    const totalOccurrences = Array.from(this.patterns.values())
      .reduce((s, e) => s + e.occurrences, 0);
    if (totalOccurrences === 0) return 0;
    return entry.occurrences / totalOccurrences;
  }

  /** Remove lowest-scoring pattern */
  private evictWeakest(): void {
    let weakestKey: string | null = null;
    let weakestScore = Infinity;
    for (const [key, entry] of this.patterns) {
      if (entry.score < weakestScore) {
        weakestScore = entry.score;
        weakestKey = key;
      }
    }
    if (weakestKey) this.patterns.delete(weakestKey);
  }

  // ── Public API ────────────────────────────────────────────────────

  /** Get top N highest-scoring patterns */
  getTopPatterns(n = 10): PatternEntry[] {
    return Array.from(this.patterns.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
  }

  /** Score a candidate sequence against learned patterns */
  scorePattern(steps: PatternEventType[]): number {
    const key = steps.join('→');
    return this.patterns.get(key)?.score ?? 0;
  }

  /** Get a specific pattern entry */
  getPattern(key: string): PatternEntry | null {
    return this.patterns.get(key) ?? null;
  }

  /** Shannon entropy of pattern distribution, normalized to 0-1 */
  getDiversityScore(): number {
    const entries = Array.from(this.patterns.values());
    if (entries.length <= 1) return 0;

    const total = entries.reduce((s, e) => s + e.occurrences, 0);
    if (total === 0) return 0;

    let entropy = 0;
    for (const e of entries) {
      const p = e.occurrences / total;
      if (p > 0) entropy -= p * Math.log2(p);
    }

    const maxEntropy = Math.log2(entries.length);
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
  }

  /** Snapshot for integration into NeuralNetworkSnapshot */
  getSnapshot(): PatternSnapshot {
    const entries = Array.from(this.patterns.values());
    const totalReward = entries.reduce((s, e) => s + e.reward, 0);

    return {
      totalPatterns: entries.length,
      topPatterns: this.getTopPatterns(5).map(e => ({
        key: e.sequence.key,
        score: e.score,
        occurrences: e.occurrences,
      })),
      diversityScore: this.getDiversityScore(),
      averageReward: entries.length > 0 ? totalReward / entries.length : 0,
    };
  }

  /** Total pattern count */
  get size(): number {
    return this.patterns.size;
  }

  /** Export patterns as a serializable object */
  exportPatterns(): Record<string, { score: number; reward: number; occurrences: number }> {
    const out: Record<string, { score: number; reward: number; occurrences: number }> = {};
    for (const [key, entry] of this.patterns) {
      out[key] = { score: entry.score, reward: entry.reward, occurrences: entry.occurrences };
    }
    return out;
  }

  /** Merge external patterns — keep the higher score per pattern */
  mergePatterns(external: Record<string, { score: number; reward: number; occurrences: number }>): void {
    if (!external) return;
    for (const [key, incoming] of Object.entries(external)) {
      const existing = this.patterns.get(key);
      if (!existing) {
        const steps = key.split('→') as import('./patternLearner').PatternEventType[];
        this.patterns.set(key, {
          sequence: { steps, key },
          score: incoming.score,
          reward: incoming.reward,
          trustEffect: 0,
          occurrences: incoming.occurrences,
          lastSeen: Date.now(),
        });
      } else if (incoming.score > existing.score) {
        existing.score = incoming.score;
        existing.reward = Math.max(existing.reward, incoming.reward);
        existing.occurrences = Math.max(existing.occurrences, incoming.occurrences);
      }
    }
  }
}
