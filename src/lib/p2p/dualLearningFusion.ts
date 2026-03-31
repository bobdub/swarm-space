/**
 * ═══════════════════════════════════════════════════════════════════════
 * DUAL LEARNING FUSION — Pattern ↔ Language Bidirectional Bridge
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Behavior shapes language. Language shapes behavior.
 *
 * Generation Pipeline:
 *   1. Intent selection — energy, goals, context
 *   2. Pattern selection — pick high-scoring behavioral pattern
 *   3. Language realization — convert pattern → text via token sampling
 *   4. Feedback loop — measure reward → update both models
 *
 * Guardrails:
 *   - reward = base_reward - similarity_penalty (diversity pressure)
 *   - Trust weighting on style influence
 *   - 5% exploration injection (low-probability paths)
 *   - Gates on Instinct Layer 8 (Creativity) being active
 *
 * UQRC: reward = curvature reinforcement
 */

import { PatternLearner, PatternEventType, PatternEvent, PatternSnapshot } from './patternLearner';
import { LanguageLearner, LanguageSnapshot } from './languageLearner';

// ── Types ───────────────────────────────────────────────────────────

export type GenerationIntent = 'engage' | 'explore' | 'create' | 'reflect';

export interface GenerationContext {
  recentPosts: string[];          // last few post texts for context
  currentEnergy: number;          // 0-1: from instinct/neuron state
  creativityActive: boolean;      // is instinct layer 8 active
  explorationForced?: boolean;    // 5% random exploration
  knowledgeHints?: Array<{ token: string; weight: number }>;
}

export interface GeneratedOutput {
  intent: GenerationIntent;
  pattern: PatternEventType[];
  text: string;
  confidence: number;             // 0-1: how confident the model is
  explorationPath: boolean;       // was this an exploration injection
}

export interface FusionSnapshot {
  pattern: PatternSnapshot;
  language: LanguageSnapshot;
  generationReady: boolean;      // both layers have enough data
  fusionStrength: number;        // 0-1: bidirectional transfer health
  totalContentEvents: number;
}

export interface ContentEvent {
  text: string;
  reactions: number;
  comments: number;
  shares: number;
  trustScore: number;           // 0-100
  peerId?: string;
  timestamp: number;
}

// ── Constants ───────────────────────────────────────────────────────

const EXPLORATION_RATE = 0.05;         // 5% exploration injection
const MIN_PATTERNS_FOR_GENERATION = 10;
const MIN_VOCAB_FOR_GENERATION = 50;
const SIMILARITY_PENALTY_WEIGHT = 0.2;
const PATTERN_TO_LANGUAGE_TRANSFER_RATE = 0.3;
const LANGUAGE_TO_PATTERN_TRANSFER_RATE = 0.2;
const MAX_GENERATION_TOKENS = 30;
const MIN_GENERATION_TOKENS = 8;

// Pattern → intent mapping
const INTENT_PATTERNS: Record<GenerationIntent, PatternEventType[][]> = {
  engage: [
    ['post_replied', 'post_reacted'],
    ['post_created', 'post_replied'],
  ],
  explore: [
    ['gossip_sent', 'chunk_transferred'],
    ['propagation_success', 'trust_increase'],
  ],
  create: [
    ['post_created', 'propagation_success', 'post_reacted'],
    ['post_created', 'post_shared'],
  ],
  reflect: [
    ['trust_increase', 'trust_increase'],
    ['propagation_success', 'propagation_success'],
  ],
};

// ── Dual Learning Fusion ────────────────────────────────────────────

export class DualLearningFusion {
  readonly patternLearner: PatternLearner;
  readonly languageLearner: LanguageLearner;
  private contentEventCount = 0;

  constructor(
    patternLearner?: PatternLearner,
    languageLearner?: LanguageLearner,
  ) {
    this.patternLearner = patternLearner ?? new PatternLearner();
    this.languageLearner = languageLearner ?? new LanguageLearner();
  }

  // ── Content Ingestion ─────────────────────────────────────────────

  /**
   * Ingest a content event into both learners.
   * This is the primary entry point for mesh content.
   */
  ingestContentEvent(event: ContentEvent): void {
    this.contentEventCount++;

    // Compute reward signal from engagement
    const reward = this.computeReward(event);

    // Feed pattern learner
    const patternEvents = this.contentToPatternEvents(event, reward);
    for (const pe of patternEvents) {
      this.patternLearner.ingestEvent(pe);
    }

    // Feed language learner
    if (event.text.trim().length > 0) {
      this.languageLearner.ingestText(
        event.text, reward, event.trustScore, event.peerId
      );
    }

    // Bidirectional transfer
    this.transferPatternToLanguage();
    this.transferLanguageToPattern(event);
  }

  /**
   * Compute reward from engagement metrics.
   * reward = base_reward - similarity_penalty
   */
  private computeReward(event: ContentEvent): number {
    const engagementScore = Math.min(1,
      (event.reactions * 0.3 + event.comments * 0.5 + event.shares * 0.2) / 10
    );

    // Diversity pressure: penalize if similar to top patterns
    const topPatterns = this.patternLearner.getTopPatterns(3);
    const similarityPenalty = topPatterns.length > 0
      ? SIMILARITY_PENALTY_WEIGHT * (1 - this.patternLearner.getDiversityScore())
      : 0;

    return Math.max(0, engagementScore - similarityPenalty);
  }

  /** Convert content event to pattern events */
  private contentToPatternEvents(event: ContentEvent, reward: number): PatternEvent[] {
    const events: PatternEvent[] = [];
    const base = {
      peerId: event.peerId,
      reward,
      trustScore: event.trustScore,
      timestamp: event.timestamp,
    };

    events.push({ ...base, type: 'post_created' as PatternEventType });

    if (event.reactions > 0) {
      events.push({ ...base, type: 'post_reacted' as PatternEventType });
    }
    if (event.comments > 0) {
      events.push({ ...base, type: 'post_replied' as PatternEventType });
    }
    if (event.shares > 0) {
      events.push({ ...base, type: 'post_shared' as PatternEventType });
    }

    // Propagation signal
    const spread = event.reactions + event.comments + event.shares;
    events.push({
      ...base,
      type: spread > 3
        ? 'propagation_success' as PatternEventType
        : spread === 0
        ? 'post_ignored' as PatternEventType
        : 'propagation_success' as PatternEventType,
    });

    // Trust signal
    if (event.trustScore > 60) {
      events.push({ ...base, type: 'trust_increase' as PatternEventType });
    } else if (event.trustScore < 30) {
      events.push({ ...base, type: 'trust_decrease' as PatternEventType });
    }

    return events;
  }

  // ── Bidirectional Transfer ────────────────────────────────────────

  /**
   * Pattern → Language: High-scoring patterns influence sentence structure.
   * If short+emotional+direct patterns score high, boost those token transitions.
   */
  private transferPatternToLanguage(): void {
    const topPatterns = this.patternLearner.getTopPatterns(3);
    if (topPatterns.length === 0) return;

    // For high-scoring patterns, synthesize representative text
    // and feed it back to the language model at reduced weight
    for (const pattern of topPatterns) {
      if (pattern.score <= 0) continue;

      // Generate a context string from the pattern steps
      const patternText = pattern.sequence.steps.join(' ');
      const transferWeight = pattern.score * PATTERN_TO_LANGUAGE_TRANSFER_RATE;
      this.languageLearner.ingestText(
        patternText,
        Math.min(1, transferWeight),
        70, // moderate trust for synthetic content
      );
    }
  }

  /**
   * Language → Pattern: High-propagation phrases become behavioral triggers.
   */
  private transferLanguageToPattern(event: ContentEvent): void {
    if (event.reactions + event.comments + event.shares < 5) return;

    // This phrase spread well — register as behavioral trigger
    const triggerEvent: PatternEvent = {
      type: 'propagation_success',
      peerId: event.peerId,
      reward: Math.min(1, (event.reactions + event.comments + event.shares) / 15),
      trustScore: event.trustScore,
      timestamp: event.timestamp,
    };
    this.patternLearner.ingestEvent(triggerEvent);
  }

  // ── Generation Pipeline ───────────────────────────────────────────

  /**
   * Step 1: Select intent based on energy, goals, and context.
   */
  selectIntent(context: GenerationContext): GenerationIntent {
    if (!context.creativityActive) return 'reflect'; // conservative when creativity suppressed

    if (context.explorationForced || Math.random() < EXPLORATION_RATE) {
      return 'explore';
    }

    if (context.currentEnergy > 0.7) return 'create';
    if (context.currentEnergy > 0.4) return 'engage';
    return 'reflect';
  }

  /**
   * Step 2: Select a high-scoring pattern matching the intent.
   */
  selectPattern(intent: GenerationIntent): PatternEventType[] {
    const intentPatterns = INTENT_PATTERNS[intent];
    const topPatterns = this.patternLearner.getTopPatterns(20);

    // Find a learned pattern that matches the intent
    for (const pattern of topPatterns) {
      for (const intentTemplate of intentPatterns) {
        const overlap = pattern.sequence.steps.filter(s => intentTemplate.includes(s));
        if (overlap.length >= Math.ceil(intentTemplate.length * 0.5)) {
          return pattern.sequence.steps;
        }
      }
    }

    // Fallback: use default intent pattern
    return intentPatterns[0];
  }

  private pickWeighted<T extends { weight: number }>(items: T[]): T | null {
    const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const item of items) {
      r -= Math.max(0, item.weight);
      if (r <= 0) return item;
    }
    return items[items.length - 1] ?? null;
  }

  private tokenizeTheme(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s,.!?;:'"()[\]{}<>]+/)
      .filter((t) => t.length > 1);
  }

  /**
   * Step 3: Convert pattern → text using language model token sampling.
   */
  generateText(pattern: PatternEventType[], context: GenerationContext): string {
    const isExploration = context.explorationForced || Math.random() < EXPLORATION_RATE;
    const temperature = isExploration ? 1.8 : 1.0;
    const topTokens = this.languageLearner.getTopTokens(120);
    const theme = new Set(this.tokenizeTheme(context.recentPosts[0] ?? ''));
    const hintWeights = new Map<string, number>();
    for (const hint of context.knowledgeHints ?? []) {
      hintWeights.set(hint.token.toLowerCase(), (hintWeights.get(hint.token.toLowerCase()) ?? 0) + Math.max(0, hint.weight));
    }

    // Primary seed: overlap(top_tokens, post_theme) weighted by frequency + hints
    const primaryPool = topTokens
      .filter(({ token }) => theme.has(token))
      .map(({ token, frequency }) => ({
        token,
        weight: frequency + (hintWeights.get(token) ?? 0),
      }))
      .filter(({ weight }) => weight > 0);

    // Secondary seed: highest learned tokens if no post overlap
    const secondaryPool = topTokens
      .slice(0, 40)
      .map(({ token, frequency }) => ({
        token,
        weight: frequency + (hintWeights.get(token) ?? 0),
      }))
      .filter(({ weight }) => weight > 0);

    const hintPool = Array.from(hintWeights.entries()).map(([token, weight]) => ({ token, weight }));
    const seedPool = primaryPool.length > 0 ? primaryPool : secondaryPool.length > 0 ? secondaryPool : hintPool;

    const first = this.pickWeighted(seedPool)?.token;
    const second = this.pickWeighted(seedPool)?.token;
    const fallbackSeed = context.recentPosts.length > 0
      ? context.recentPosts[0].toLowerCase().split(/\s+/).slice(0, 2)
      : pattern.slice(0, 2).map(s => s.replace('_', ' ').split(' ')[0]);
    const seed = (first && second ? [first, second] : fallbackSeed).filter(Boolean);

    const tokens = [...seed];
    for (let i = 0; i < MAX_GENERATION_TOKENS; i++) {
      const ctx = tokens.slice(Math.max(0, tokens.length - 2));
      const next = this.languageLearner.sampleNextToken(ctx, temperature);
      if (!next && tokens.length >= MIN_GENERATION_TOKENS) break;
      if (!next) {
        const recovery = this.pickWeighted(seedPool)?.token;
        if (!recovery) break;
        tokens.push(recovery);
        continue;
      }
      tokens.push(next);
    }

    return tokens.join(' ');
  }

  /**
   * Full generation pipeline: Intent → Pattern → Text
   */
  generate(context: GenerationContext): GeneratedOutput | null {
    if (!this.isGenerationReady()) return null;
    // creativityActive is advisory — the caller decides whether to use the output

    const isExploration = context.explorationForced || Math.random() < EXPLORATION_RATE;
    const intent = this.selectIntent({
      ...context,
      explorationForced: isExploration,
    });
    const pattern = this.selectPattern(intent);
    const text = this.generateText(pattern, {
      ...context,
      explorationForced: isExploration,
    });

    // Confidence based on pattern score and language entropy
    const patternScore = this.patternLearner.scorePattern(pattern);
    const entropy = this.languageLearner.getEntropy();
    const confidence = Math.min(1, (patternScore * 0.5 + entropy * 0.5));

    return {
      intent,
      pattern,
      text,
      confidence,
      explorationPath: isExploration,
    };
  }

  // ── Step 4: Feedback Loop ─────────────────────────────────────────

  /**
   * After posting generated content, feed reward back into both models.
   */
  recordFeedback(
    generatedText: string,
    reactions: number,
    comments: number,
    shares: number,
    trustScore: number,
  ): void {
    this.ingestContentEvent({
      text: generatedText,
      reactions,
      comments,
      shares,
      trustScore,
      timestamp: Date.now(),
    });
  }

  // ── Status ────────────────────────────────────────────────────────

  /** Is the system ready to generate? */
  isGenerationReady(): boolean {
    return (
      this.patternLearner.size >= MIN_PATTERNS_FOR_GENERATION &&
      this.languageLearner.vocabSize >= MIN_VOCAB_FOR_GENERATION
    );
  }

  /** Fusion strength: how well are both layers feeding each other */
  getFusionStrength(): number {
    const patternHealth = Math.min(1, this.patternLearner.size / MIN_PATTERNS_FOR_GENERATION);
    const languageHealth = Math.min(1, this.languageLearner.vocabSize / MIN_VOCAB_FOR_GENERATION);
    const diversity = this.patternLearner.getDiversityScore();
    const entropy = this.languageLearner.getEntropy();

    return (patternHealth + languageHealth + diversity + entropy) / 4;
  }

  /** Snapshot for NeuralNetworkSnapshot integration */
  getSnapshot(): FusionSnapshot {
    return {
      pattern: this.patternLearner.getSnapshot(),
      language: this.languageLearner.getSnapshot(),
      generationReady: this.isGenerationReady(),
      fusionStrength: this.getFusionStrength(),
      totalContentEvents: this.contentEventCount,
    };
  }
}
