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
import { isBlockedToken } from './tokenBlocklist';

// ── Types ───────────────────────────────────────────────────────────

export type GenerationIntent = 'engage' | 'explore' | 'create' | 'reflect';

export interface GenerationContext {
  recentPosts: string[];
  currentEnergy: number;
  creativityActive: boolean;
  explorationForced?: boolean;
  /** Φ-derived temperature modifier (default 1.0) */
  temperatureModifier?: number;
}

export interface GeneratedOutput {
  intent: GenerationIntent;
  pattern: PatternEventType[];
  text: string;
  confidence: number;
  explorationPath: boolean;
}

export interface FusionSnapshot {
  pattern: PatternSnapshot;
  language: LanguageSnapshot;
  generationReady: boolean;
  fusionStrength: number;
  totalContentEvents: number;
}

export interface ContentEvent {
  text: string;
  reactions: number;
  comments: number;
  shares: number;
  trustScore: number;
  peerId?: string;
  timestamp: number;
}

// ── Constants ───────────────────────────────────────────────────────

const EXPLORATION_RATE = 0.05;
const MIN_PATTERNS_FOR_GENERATION = 10;
const MIN_VOCAB_FOR_GENERATION = 50;
const SIMILARITY_PENALTY_WEIGHT = 0.2;
const PATTERN_TO_LANGUAGE_TRANSFER_RATE = 0.3;
const MAX_GENERATION_TOKENS = 30;
const MIN_OUTPUT_TOKENS_BASE = 5;

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

  ingestContentEvent(event: ContentEvent): void {
    this.contentEventCount++;
    const reward = this.computeReward(event);
    const patternEvents = this.contentToPatternEvents(event, reward);
    for (const pe of patternEvents) {
      this.patternLearner.ingestEvent(pe);
    }
    if (event.text.trim().length > 0) {
      this.languageLearner.ingestText(
        event.text, reward, event.trustScore, event.peerId
      );
    }
    this.transferPatternToLanguage();
    this.transferLanguageToPattern(event);
  }

  private computeReward(event: ContentEvent): number {
    const engagementScore = Math.min(1,
      (event.reactions * 0.3 + event.comments * 0.5 + event.shares * 0.2) / 10
    );
    const topPatterns = this.patternLearner.getTopPatterns(3);
    const similarityPenalty = topPatterns.length > 0
      ? SIMILARITY_PENALTY_WEIGHT * (1 - this.patternLearner.getDiversityScore())
      : 0;
    return Math.max(0, engagementScore - similarityPenalty);
  }

  private contentToPatternEvents(event: ContentEvent, reward: number): PatternEvent[] {
    const events: PatternEvent[] = [];
    const base = {
      peerId: event.peerId,
      reward,
      trustScore: event.trustScore,
      timestamp: event.timestamp,
    };

    events.push({ ...base, type: 'post_created' as PatternEventType });
    if (event.reactions > 0) events.push({ ...base, type: 'post_reacted' as PatternEventType });
    if (event.comments > 0) events.push({ ...base, type: 'post_replied' as PatternEventType });
    if (event.shares > 0) events.push({ ...base, type: 'post_shared' as PatternEventType });

    const spread = event.reactions + event.comments + event.shares;
    events.push({
      ...base,
      type: spread > 3
        ? 'propagation_success' as PatternEventType
        : spread === 0
        ? 'post_ignored' as PatternEventType
        : 'propagation_success' as PatternEventType,
    });

    if (event.trustScore > 60) events.push({ ...base, type: 'trust_increase' as PatternEventType });
    else if (event.trustScore < 30) events.push({ ...base, type: 'trust_decrease' as PatternEventType });

    return events;
  }

  // ── Bidirectional Transfer ────────────────────────────────────────

  private transferPatternToLanguage(): void {
    const topPatterns = this.patternLearner.getTopPatterns(3);
    if (topPatterns.length === 0) return;

    for (const pattern of topPatterns) {
      if (pattern.score <= 0) continue;
      const patternText = pattern.sequence.steps.join(' ');
      const transferWeight = pattern.score * PATTERN_TO_LANGUAGE_TRANSFER_RATE;
      this.languageLearner.ingestText(
        patternText,
        Math.min(1, transferWeight),
        70,
      );
    }
  }

  private transferLanguageToPattern(event: ContentEvent): void {
    if (event.reactions + event.comments + event.shares < 5) return;
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

  selectIntent(context: GenerationContext): GenerationIntent {
    if (!context.creativityActive) return 'reflect';
    if (context.explorationForced || Math.random() < EXPLORATION_RATE) return 'explore';
    if (context.currentEnergy > 0.7) return 'create';
    if (context.currentEnergy > 0.4) return 'engage';
    return 'reflect';
  }

  selectPattern(intent: GenerationIntent): PatternEventType[] {
    const intentPatterns = INTENT_PATTERNS[intent];
    const topPatterns = this.patternLearner.getTopPatterns(20);

    for (const pattern of topPatterns) {
      for (const intentTemplate of intentPatterns) {
        const overlap = pattern.sequence.steps.filter(s => intentTemplate.includes(s));
        if (overlap.length >= Math.ceil(intentTemplate.length * 0.5)) {
          return pattern.sequence.steps;
        }
      }
    }

    return intentPatterns[0];
  }

  /**
   * Convert pattern → text using language model token sampling.
   * Now with random-walk fallback and Φ-derived temperature.
   */
  generateText(pattern: PatternEventType[], context: GenerationContext): string {
    const isExploration = context.explorationForced || Math.random() < EXPLORATION_RATE;
    const phiMod = context.temperatureModifier ?? 1.0;
    const temperature = (isExploration ? 1.8 : 1.0) * phiMod;

    // Minimum tokens scales with context
    const minTokens = context.currentEnergy > 0.5
      ? MIN_OUTPUT_TOKENS_BASE + 3
      : MIN_OUTPUT_TOKENS_BASE;

    // Seed from recent posts — filter blocked tokens from seed
    let seed: string[];
    if (context.recentPosts.length > 0) {
      const words = context.recentPosts[0].toLowerCase().split(/\s+/)
        .filter(w => w.length > 2 && !isBlockedToken(w));
      seed = words.slice(0, 2);
    } else {
      seed = pattern.slice(0, 2).map(s => s.replace('_', ' ').split(' ')[0]);
    }

    // If seed is empty or blocked, use top vocabulary tokens
    if (seed.length === 0 || seed.every(s => isBlockedToken(s))) {
      const topTokens = this.languageLearner.getTopTokens(20)
        .map(t => t.token)
        .filter(t => !isBlockedToken(t));
      seed = topTokens.slice(0, 2);
    }

    if (seed.length === 0) return '';

    const tokens = [...seed];
    let chainBreaks = 0;

    for (let i = 0; i < MAX_GENERATION_TOKENS; i++) {
      const ctx = tokens.slice(Math.max(0, tokens.length - 2));
      let next = this.languageLearner.sampleNextToken(ctx, temperature);

      // Random walk fallback: if chain breaks, find any context with a current token
      if (!next) {
        chainBreaks++;
        next = this.randomWalkSample(tokens, temperature);
        if (!next && tokens.length < minTokens) {
          // Last resort: pick a random clean top token to continue
          const topClean = this.languageLearner.getTopTokens(30)
            .map(t => t.token)
            .filter(t => !isBlockedToken(t) && !tokens.includes(t));
          if (topClean.length > 0) {
            next = topClean[Math.floor(Math.random() * Math.min(10, topClean.length))];
          }
        }
      }

      if (!next) break;
      if (isBlockedToken(next)) continue;
      tokens.push(next);
    }

    // Filter blocked tokens from final output
    const clean = tokens.filter(t => !isBlockedToken(t));
    return clean.join(' ');
  }

  /**
   * Random walk: pick any transition context containing one of the current
   * tokens and sample from it.
   */
  private randomWalkSample(currentTokens: string[], temperature: number): string | null {
    const shuffled = [...currentTokens].sort(() => Math.random() - 0.5);
    for (const token of shuffled.slice(0, 4)) {
      const probs = this.languageLearner.getNextTokenProbabilities([token]);
      const candidates = probs.filter(([t]) => !isBlockedToken(t));
      if (candidates.length === 0) continue;

      const scaled = candidates.map(([t, p]) => [t, Math.pow(p, 1 / temperature)] as [string, number]);
      const total = scaled.reduce((s, [, p]) => s + p, 0);
      let r = Math.random() * total;
      for (const [t, p] of scaled) {
        r -= p;
        if (r <= 0) return t;
      }
      return scaled[scaled.length - 1][0];
    }
    return null;
  }

  /**
   * Full generation pipeline: Intent → Pattern → Text
   */
  generate(context: GenerationContext): GeneratedOutput | null {
    if (!this.isGenerationReady()) return null;

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

  isGenerationReady(): boolean {
    return (
      this.patternLearner.size >= MIN_PATTERNS_FOR_GENERATION &&
      this.languageLearner.vocabSize >= MIN_VOCAB_FOR_GENERATION
    );
  }

  getFusionStrength(): number {
    const patternHealth = Math.min(1, this.patternLearner.size / MIN_PATTERNS_FOR_GENERATION);
    const languageHealth = Math.min(1, this.languageLearner.vocabSize / MIN_VOCAB_FOR_GENERATION);
    const diversity = this.patternLearner.getDiversityScore();
    const entropy = this.languageLearner.getEntropy();
    return (patternHealth + languageHealth + diversity + entropy) / 4;
  }

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
