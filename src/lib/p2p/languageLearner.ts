/**
 * ═══════════════════════════════════════════════════════════════════════
 * LANGUAGE LEARNER — Layer 2 of Dual Learning System
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Learns token transition probabilities from post/comment text,
 * weighted by engagement (reward) and trust.
 *
 * P(next_token | context) — but amplified by reward and trust
 *
 * UQRC: projection of u(t) into symbolic space
 */

// ── Types ───────────────────────────────────────────────────────────

export interface TokenStats {
  token: string;
  frequency: number;
}

export interface TransitionEntry {
  /** Map from next-token → weighted probability accumulator */
  nextTokens: Map<string, number>;
  totalWeight: number;
}

export interface StyleBias {
  peerId: string;
  influence: number;  // 0-1: how much this peer shapes our language
}

export interface LanguageSnapshot {
  vocabularySize: number;
  transitionCount: number;
  entropy: number;        // Shannon entropy of token distribution, 0-1
  topTokens: Array<{ token: string; frequency: number }>;
  averageRewardBias: number;
}

// ── Constants ───────────────────────────────────────────────────────

const MAX_VOCABULARY = 5000;
const CONTEXT_SIZE = 2;         // bigram context (2 tokens)
const TRIGRAM_CONTEXT = 3;
const PHRASE_MERGE_THRESHOLD = 5; // bigrams seen > N become single tokens
const MAX_TRANSITIONS = 10000;
const TRUST_FLOOR = 0.1;        // minimum trust weight for any contribution
const MAX_CONTEXTS = 2000;
const MAX_TOKENS_PER_CONTEXT = 32;
const TRANSITION_MERGE_DECAY = 0.85;
const MAX_MERGED_PHRASES = 500;

// Tokenization patterns
const TOKEN_SPLIT_RE = /[\s,.!?;:'"()\[\]{}<>]+/;
const SYMBOL_RE = /^[Ξξ∞Φφ‽⊗∇λε]+$/;

// ── Language Learner ────────────────────────────────────────────────

export class LanguageLearner {
  /** Token frequency map */
  private readonly vocabulary = new Map<string, number>();
  /** Context → next-token transition probabilities */
  private readonly transitions = new Map<string, TransitionEntry>();
  /** Peer style influence tracking */
  private readonly styleBias = new Map<string, number>();
  /** Reward amplification per context pattern */
  private readonly rewardBias = new Map<string, number>();
  /** Phrase merging: bigrams that appear frequently become single tokens */
  private readonly phraseCounts = new Map<string, number>();
  private readonly mergedPhrases = new Set<string>();

  /**
   * Ingest text from a post/comment, weighted by engagement reward and trust.
   */
  ingestText(text: string, reward: number, trustScore: number, peerId?: string): void {
    if (!text || text.trim().length === 0) return;

    const trustWeight = Math.max(TRUST_FLOOR, trustScore / 100);
    const weight = (0.5 + reward * 0.5) * trustWeight; // base 0.5 + reward boost

    // Tokenize
    const tokens = this.tokenize(text);
    if (tokens.length === 0) return;

    // Update vocabulary
    for (const token of tokens) {
      const current = this.vocabulary.get(token) ?? 0;
      this.vocabulary.set(token, current + weight);
    }

    // Update bigram transitions
    for (let i = 0; i < tokens.length - 1; i++) {
      // Bigram context
      if (i >= CONTEXT_SIZE - 1) {
        const context = tokens.slice(i - (CONTEXT_SIZE - 1), i + 1).join(' ');
        const nextToken = tokens[i + 1];
        this.recordTransition(context, nextToken, weight);
      }

      // Trigram context
      if (i >= TRIGRAM_CONTEXT - 1) {
        const context = tokens.slice(i - (TRIGRAM_CONTEXT - 1), i + 1).join(' ');
        const nextToken = tokens[i + 1];
        this.recordTransition(context, nextToken, weight * 0.7); // slightly less weight for trigrams
      }

      // Track phrase candidates (bigrams)
      const bigram = `${tokens[i]}_${tokens[i + 1]}`;
      const count = (this.phraseCounts.get(bigram) ?? 0) + 1;
      this.phraseCounts.set(bigram, count);
      if (count >= PHRASE_MERGE_THRESHOLD && !this.mergedPhrases.has(bigram)) {
        this.mergedPhrases.add(bigram);
      }
    }

    // Update style bias for peer
    if (peerId) {
      const current = this.styleBias.get(peerId) ?? 0;
      this.styleBias.set(peerId, current + weight * 0.1);
    }

    // Update reward bias for high-reward contexts
    if (reward > 0.5 && tokens.length >= 2) {
      const contextKey = tokens.slice(0, Math.min(3, tokens.length)).join(' ');
      const currentBias = this.rewardBias.get(contextKey) ?? 0;
      this.rewardBias.set(contextKey, currentBias + reward);
    }

    // Enforce vocabulary cap
    this.enforceVocabularyCap();
  }

  /**
   * Tokenize text: whitespace + punctuation split, with symbol preservation
   * and merged phrase recognition.
   */
  private tokenize(text: string): string[] {
    const raw = text.toLowerCase()
      .split(TOKEN_SPLIT_RE)
      .filter(t => t.length > 0);

    // Apply phrase merging: check consecutive pairs
    const tokens: string[] = [];
    for (let i = 0; i < raw.length; i++) {
      if (i < raw.length - 1) {
        const bigram = `${raw[i]}_${raw[i + 1]}`;
        if (this.mergedPhrases.has(bigram)) {
          tokens.push(bigram);
          i++; // skip next token
          continue;
        }
      }
      tokens.push(raw[i]);
    }

    return tokens;
  }

  /** Record a context → next-token transition */
  private recordTransition(context: string, nextToken: string, weight: number): void {
    let entry = this.transitions.get(context);
    if (!entry) {
      entry = { nextTokens: new Map(), totalWeight: 0 };
      this.transitions.set(context, entry);
    }

    const current = entry.nextTokens.get(nextToken) ?? 0;
    entry.nextTokens.set(nextToken, current + weight);
    entry.totalWeight += weight;

    // Enforce transition cap
    if (this.transitions.size > MAX_TRANSITIONS) {
      this.evictWeakestTransition();
    }
  }

  /** Remove weakest transition entry */
  private evictWeakestTransition(): void {
    let weakestKey: string | null = null;
    let weakestWeight = Infinity;
    for (const [key, entry] of this.transitions) {
      if (entry.totalWeight < weakestWeight) {
        weakestWeight = entry.totalWeight;
        weakestKey = key;
      }
    }
    if (weakestKey) this.transitions.delete(weakestKey);
  }

  /** Keep vocabulary within cap by removing least frequent tokens */
  private enforceVocabularyCap(): void {
    if (this.vocabulary.size <= MAX_VOCABULARY) return;

    const sorted = Array.from(this.vocabulary.entries())
      .sort((a, b) => a[1] - b[1]);

    const toRemove = sorted.slice(0, sorted.length - MAX_VOCABULARY);
    for (const [token] of toRemove) {
      this.vocabulary.delete(token);
    }
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Get probability distribution for next token given a context.
   * Returns sorted array of [token, probability] pairs.
   */
  getNextTokenProbabilities(context: string[]): Array<[string, number]> {
    const contextKey = context.join(' ');
    const entry = this.transitions.get(contextKey);
    if (!entry || entry.totalWeight === 0) return [];

    return Array.from(entry.nextTokens.entries())
      .map(([token, weight]) => [token, weight / entry.totalWeight] as [string, number])
      .sort((a, b) => b[1] - a[1]);
  }

  /**
   * Sample a next token given context, with optional temperature.
   * Temperature > 1 = more random, < 1 = more deterministic.
   */
  sampleNextToken(context: string[], temperature = 1.0): string | null {
    const probs = this.getNextTokenProbabilities(context);
    if (probs.length === 0) return null;

    if (temperature <= 0.01) return probs[0][0]; // greedy

    // Apply temperature scaling
    const scaled = probs.map(([token, prob]) => {
      const adjustedProb = Math.pow(prob, 1 / temperature);
      return [token, adjustedProb] as [string, number];
    });
    const totalScaled = scaled.reduce((s, [, p]) => s + p, 0);

    // Weighted random selection
    let r = Math.random() * totalScaled;
    for (const [token, prob] of scaled) {
      r -= prob;
      if (r <= 0) return token;
    }

    return scaled[scaled.length - 1][0];
  }

  /**
   * Shannon entropy of vocabulary distribution, normalized to 0-1.
   * Low entropy = echo chamber. High entropy = diverse language.
   */
  getEntropy(): number {
    const entries = Array.from(this.vocabulary.values());
    if (entries.length <= 1) return 0;

    const total = entries.reduce((s, v) => s + v, 0);
    if (total === 0) return 0;

    let entropy = 0;
    for (const freq of entries) {
      const p = freq / total;
      if (p > 0) entropy -= p * Math.log2(p);
    }

    const maxEntropy = Math.log2(entries.length);
    return maxEntropy > 0 ? Math.min(1, entropy / maxEntropy) : 0;
  }

  /** Get style bias for a peer */
  getStyleBias(peerId: string): number {
    return this.styleBias.get(peerId) ?? 0;
  }

  /** Get top N most frequent tokens */
  getTopTokens(n = 10): TokenStats[] {
    return Array.from(this.vocabulary.entries())
      .map(([token, frequency]) => ({ token, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, n);
  }

  /** Snapshot for integration into NeuralNetworkSnapshot */
  getSnapshot(): LanguageSnapshot {
    const entries = Array.from(this.rewardBias.values());
    const avgRewardBias = entries.length > 0
      ? entries.reduce((s, v) => s + v, 0) / entries.length
      : 0;

    return {
      vocabularySize: this.vocabulary.size,
      transitionCount: this.transitions.size,
      entropy: this.getEntropy(),
      topTokens: this.getTopTokens(5),
      averageRewardBias: avgRewardBias,
    };
  }

  /** Total vocabulary size */
  get vocabSize(): number {
    return this.vocabulary.size;
  }

  /** Total transition count */
  get transitionSize(): number {
    return this.transitions.size;
  }

  /** Export vocabulary frequencies as a serializable object */
  exportVocab(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [token, freq] of this.vocabulary) {
      out[token] = freq;
    }
    return out;
  }

  /** Merge external vocabulary — keep the max frequency per token */
  mergeVocab(external: Record<string, number>): void {
    if (!external) return;
    for (const [token, freq] of Object.entries(external)) {
      const current = this.vocabulary.get(token) ?? 0;
      if (freq > current) {
        this.vocabulary.set(token, freq);
      }
    }
  }

  /** Export learned transition maps (context -> next-token weighted counts). */
  exportTransitions(): Record<string, { nextTokens: Record<string, number>; totalWeight: number }> {
    const out: Record<string, { nextTokens: Record<string, number>; totalWeight: number }> = {};
    for (const [context, entry] of this.transitions.entries()) {
      const nextTokens: Record<string, number> = {};
      for (const [token, weight] of entry.nextTokens.entries()) {
        nextTokens[token] = weight;
      }
      out[context] = {
        nextTokens,
        totalWeight: entry.totalWeight,
      };
    }
    return out;
  }

  /**
   * Merge external transitions with decay-weighted blending.
   * Keeps bounded context/token cardinality to prevent unbounded growth.
   */
  mergeTransitions(external: Record<string, { nextTokens: Record<string, number>; totalWeight: number }>): void {
    if (!external) return;

    const contexts = Object.entries(external)
      .sort((a, b) => (b[1]?.totalWeight ?? 0) - (a[1]?.totalWeight ?? 0))
      .slice(0, MAX_CONTEXTS);

    for (const [context, incoming] of contexts) {
      if (!incoming?.nextTokens) continue;

      const entry = this.transitions.get(context) ?? { nextTokens: new Map<string, number>(), totalWeight: 0 };
      if (!this.transitions.has(context)) {
        this.transitions.set(context, entry);
      }

      const sortedTokens = Object.entries(incoming.nextTokens)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_TOKENS_PER_CONTEXT);

      for (const [token, incomingWeight] of sortedTokens) {
        if (!Number.isFinite(incomingWeight) || incomingWeight <= 0) continue;
        const current = entry.nextTokens.get(token) ?? 0;
        entry.nextTokens.set(token, current * TRANSITION_MERGE_DECAY + incomingWeight);
      }

      entry.totalWeight = Array.from(entry.nextTokens.values()).reduce((sum, weight) => sum + weight, 0);
      if (entry.totalWeight <= 0) {
        this.transitions.delete(context);
      }
    }

    // Hard cap on number of contexts
    if (this.transitions.size > MAX_CONTEXTS) {
      const ranked = Array.from(this.transitions.entries()).sort((a, b) => b[1].totalWeight - a[1].totalWeight);
      this.transitions.clear();
      for (const [context, entry] of ranked.slice(0, MAX_CONTEXTS)) {
        this.transitions.set(context, entry);
      }
    }
  }

  /** Export merged phrases used for phrase-token compaction. */
  exportMergedPhrases(): string[] {
    return Array.from(this.mergedPhrases.values()).slice(0, MAX_MERGED_PHRASES);
  }

  /**
   * Merge phrase tokens and optionally compile them back into transition space
   * to preserve higher-order phrasing across reloads.
   */
  mergeMergedPhrases(external: string[]): void {
    if (!Array.isArray(external)) return;
    for (const phrase of external.slice(0, MAX_MERGED_PHRASES)) {
      if (typeof phrase !== 'string') continue;
      this.mergedPhrases.add(phrase);
      const [a, b] = phrase.split('_');
      if (a && b) {
        const context = `${a} ${b}`;
        this.recordTransition(context, phrase, 0.25);
      }
    }
  }
}
