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

export interface KnowledgeHint {
  token: string;
  weight: number;  // 0-1: how much to boost this token in seed selection
}

export interface GenerationContext {
  recentPosts: string[];          // last few post texts for context
  currentEnergy: number;          // 0-1: from instinct/neuron state
  creativityActive: boolean;      // is instinct layer 8 active
  explorationForced?: boolean;    // 5% random exploration
  knowledgeHints?: KnowledgeHint[]; // neuron coin knowledge bias fields (L_S u)
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
const HEX_GIBBERISH_RE = /^[0-9a-f]{6,}$/i;
const PATTERN_EVENT_TOKEN_RE = /^[a-z]+(?:_[a-z]+)+$/;
const NON_EXPRESSIVE_TOKENS = new Set([
  'post', 'posted', 'reply', 'replied', 'reaction', 'reacted',
  'propagation', 'success', 'metric', 'metrics', 'event',
]);

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

      // Generate a human-facing context string from pattern steps.
      // Avoid injecting raw event IDs like "post_created" into language memory.
      const readableSteps = pattern.sequence.steps
        .map((step) => this.mapPatternStepToReadableToken(step))
        .filter(Boolean);
      if (readableSteps.length === 0) continue;
      const patternText = readableSteps.join(' ');
      const transferWeight = pattern.score * PATTERN_TO_LANGUAGE_TRANSFER_RATE;
      this.languageLearner.ingestText(
        patternText,
        Math.min(1, transferWeight),
        70, // moderate trust for synthetic content
      );
    }
  }

  private mapPatternStepToReadableToken(step: PatternEventType): string | null {
    switch (step) {
      case 'post_created':
        return 'idea';
      case 'post_replied':
        return 'dialogue';
      case 'post_reacted':
        return 'emotion';
      case 'post_shared':
        return 'connection';
      case 'propagation_success':
        return 'resonance';
      case 'post_ignored':
        return 'quiet';
      case 'trust_increase':
        return 'trust';
      case 'trust_decrease':
        return 'friction';
      default:
        return PATTERN_EVENT_TOKEN_RE.test(step) ? null : step;
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

  /**
   * Step 3: Convert pattern → text using language model token sampling.
   *
   * Seed strategy (UQRC: |u₀⟩ must cover latent subspace):
   *   1. Primary: top tokens overlapping post theme, weighted by vocab frequency + neuron hints
   *   2. Secondary: top frequent tokens if no overlap
   *   3. Tertiary: post first-2-words only if vocab empty
   */
  generateText(pattern: PatternEventType[], context: GenerationContext): string {
    const isExploration = context.explorationForced || Math.random() < EXPLORATION_RATE;
    const temperature = isExploration ? 1.8 : 1.0;
    const MIN_OUTPUT_TOKENS = 5;

    // Extract theme words from recent posts
    const themeWords = context.recentPosts.length > 0
      ? context.recentPosts[0].toLowerCase().split(/[\s,.!?;:'"()\[\]{}<>]+/).filter(w => w.length > 2)
      : [];

    // Build seed using learned vocabulary, not just post text
    let seed: string[] = [];

    // Primary: top tokens overlapping post theme
    if (themeWords.length > 0) {
      const overlapping = this.languageLearner.getTopTokensOverlapping(themeWords, 5);
      // Mix in knowledge hints if available
      if (context.knowledgeHints && context.knowledgeHints.length > 0) {
        const hintTokens = context.knowledgeHints
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 3)
          .map(h => h.token)
          .filter(token => !HEX_GIBBERISH_RE.test(token));
        const combined = [...overlapping.map(t => t.token), ...hintTokens]
          .filter(token => !HEX_GIBBERISH_RE.test(token));
        // Probabilistic pick from combined pool
        seed = combined.length > 0
          ? [combined[Math.floor(Math.random() * combined.length)], combined[Math.floor(Math.random() * combined.length)]]
          : [];
      } else {
        seed = overlapping
          .map(t => t.token)
          .filter(token => !HEX_GIBBERISH_RE.test(token))
          .slice(0, 2);
      }
    }

    // Secondary: top frequent tokens if no overlap found
    if (seed.length === 0) {
      const topTokens = this.languageLearner.getTopTokens(10);
      if (topTokens.length >= 2) {
        // Stochastic selection from top tokens for entropy
        const idx1 = Math.floor(Math.random() * Math.min(5, topTokens.length));
        const idx2 = Math.floor(Math.random() * Math.min(10, topTokens.length));
        seed = [topTokens[idx1].token, topTokens[idx2 === idx1 ? (idx2 + 1) % topTokens.length : idx2].token]
          .filter(token => !HEX_GIBBERISH_RE.test(token));
      }
    }

    // Tertiary: post first-2-words only if vocab empty
    if (seed.length === 0) {
      seed = context.recentPosts.length > 0
        ? context.recentPosts[0].toLowerCase().split(/\s+/).slice(0, 2)
        : pattern.slice(0, 2).map(s => s.replace('_', ' ').split(' ')[0]);
      seed = seed.filter(token => !HEX_GIBBERISH_RE.test(token));
    }

    const tokens = [...seed];
    for (let i = 0; i < MAX_GENERATION_TOKENS; i++) {
      const ctx = tokens.slice(Math.max(0, tokens.length - 2));
      const next = this.languageLearner.sampleNextToken(ctx, temperature);
      if (!next) {
        // If we haven't reached minimum length, try with just the last token
        if (tokens.length < MIN_OUTPUT_TOKENS && tokens.length > 0) {
          const fallback = this.languageLearner.sampleNextToken([tokens[tokens.length - 1]], temperature * 1.2);
          if (fallback) { tokens.push(fallback); continue; }
        }
        break;
      }
      if (NON_EXPRESSIVE_TOKENS.has(next)) continue;
      tokens.push(next);
    }

    return tokens
      .filter((token) => !NON_EXPRESSIVE_TOKENS.has(token))
      .join(' ');
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
