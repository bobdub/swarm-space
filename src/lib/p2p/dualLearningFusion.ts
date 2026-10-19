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
 *   3. Personality realization — rank whole learned expressions; preserve formulas
 *   4. Feedback loop — measure reward → update both models
 *
 * Guardrails:
 *   - reward = base_reward - similarity_penalty (diversity pressure)
 *   - Trust weighting on style influence
 *   - No random word assembly or prompt-derived seed
 *   - Gates on Instinct Layer 8 (Creativity) being active
 *
 * UQRC: reward = curvature reinforcement
 */

import { PatternLearner, PatternEventType, PatternEvent, PatternSnapshot } from './patternLearner';
import { LanguageLearner, LanguageSnapshot } from './languageLearner';
import { rankExpressions } from '../brain/infinityPersonality';
import { getSharedFieldEngine } from '../uqrc/fieldEngine';
import { selectByMinCurvature } from '../uqrc/fieldProjection';

// ── Types ───────────────────────────────────────────────────────────

export type GenerationIntent = 'engage' | 'explore' | 'create' | 'reflect';

export interface GenerationContext {
  recentPosts: string[];
  currentEnergy: number;
  /**
   * Creativity layer health in 0..1. Replaces the old boolean gate — generation
   * never refuses; instead, low creativity simply scales temperature down.
   * Accepts boolean for backward compat (true → 1, false → 0).
   */
  creativityActive: boolean | number;
  explorationForced?: boolean;
  /** Φ-derived temperature modifier (default 1.0) */
  temperatureModifier?: number;
  /**
   * Infinity's projected self-image (from `getInfinityProjection`).
   * When supplied, raises the minimum token floor and biases exploration
   * so high-awareness / integrated phases produce richer chains.
   */
  personality?: {
    awareness: number;
    empathy: number;
    coherence: number;
    intent: number;
    phase: string;
  };
  /**
   * Live field heartbeat (from `getLastInfinitySnapshot`). A calm field
   * (low qScore) lengthens chains; a turbulent one tightens them.
   */
  heartbeat?: {
    qScore: number;
    basinDepth: number;
    gradientMag: number;
    commutatorNorm: number;
    entropyNorm: number;
  };
  /** Legacy caller metadata; glyphs are never forcibly prepended to replies. */
  signatureTokens?: string[];
  /**
   * Manifold mass 0..1. Drives the token/char budget. When omitted, the
   * generator computes one internally from vocab/pattern/fusion signals.
   */
  massScore?: number;
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
  /**
   * Optional parent/recent text this content is echoing. When provided,
   * the reward is curvature-damped by the overlap region — so parroting
   * the user gets punished by the field's own geometry. Lexical Jaccard
   * picks the overlap; the field decides how much it costs.
   */
  recentForOverlap?: string;
}

// ── Constants ───────────────────────────────────────────────────────

const DEFAULT_EXPLORATION_RATE = 0.05;
const MIN_EXPLORATION_RATE = 0.02;
const MAX_EXPLORATION_RATE = 0.25;
const MIN_PATTERNS_FOR_GENERATION = 10;
const MIN_VOCAB_FOR_GENERATION = 50;
const SIMILARITY_PENALTY_WEIGHT = 0.2;
const PATTERN_TO_LANGUAGE_TRANSFER_RATE = 0.3;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const tanh01 = (x: number): number => Math.tanh(Math.max(0, x));

/**
 * Mass score 0..1 — manifold "weight" of the current brain. Used to scale
 * the generation token budget so a heavy manifold produces long replies
 * and a sparse one stays terse. Combines vocab, pattern, fusion, basin
 * depth, and inverse Q_Score (calm field = more room to speak).
 */
export function computeMassScore(input: {
  vocabSize: number;
  patternCount: number;
  fusionStrength: number;
  basinDepth?: number;
  qScore?: number;
}): number {
  const v = 0.25 * tanh01(input.vocabSize / 400);
  const p = 0.25 * tanh01(input.patternCount / 60);
  const f = 0.20 * clamp01(input.fusionStrength);
  const b = 0.15 * clamp01((input.basinDepth ?? 0) / 1.5);
  const q = 0.15 * (1 - clamp01(input.qScore ?? 0.5));
  return clamp01(v + p + f + b + q);
}

// ── Lexical overlap (for echo damping) ──────────────────────────────
// Returns the space-joined intersection of meaningful tokens (length > 2)
// shared between two strings. Order-insensitive; symbols/punct stripped.
function lexicalOverlap(a: string, b: string): string {
  const tokenize = (s: string) =>
    s.toLowerCase()
      .split(/[\s,.!?;:'"()\[\]{}<>]+/)
      .filter(t => t.length > 2);
  const setB = new Set(tokenize(b));
  const shared: string[] = [];
  const seen = new Set<string>();
  for (const t of tokenize(a)) {
    if (setB.has(t) && !seen.has(t)) { shared.push(t); seen.add(t); }
  }
  return shared.join(' ');
}

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
  private lastFieldLogAt = 0;

  constructor(
    patternLearner?: PatternLearner,
    languageLearner?: LanguageLearner,
  ) {
    this.patternLearner = patternLearner ?? new PatternLearner();
    this.languageLearner = languageLearner ?? new LanguageLearner();
  }

  /**
   * Adaptive exploration rate derived from the field's dominant wavelength.
   * Short λ (turbulent) → explore more. Long λ (stable) → exploit known.
   * Falls back to default if field engine unavailable / not warmed up.
   */
  getExplorationRate(): number {
    try {
      const fe = getSharedFieldEngine();
      if (!fe.isWarmedUp()) return DEFAULT_EXPLORATION_RATE;
      const lambda = fe.getDominantWavelength();
      const raw = 1 / (1 + Math.max(0, lambda));
      return Math.max(MIN_EXPLORATION_RATE, Math.min(MAX_EXPLORATION_RATE, raw));
    } catch {
      return DEFAULT_EXPLORATION_RATE;
    }
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
    const base = Math.max(0, engagementScore - similarityPenalty);
    // Curvature damping: posts that destabilise the lattice get a smaller
    // reward even if they engage well. Geometric corrosion costs.
    let curvatureDamp = 1;
    try {
      const fe = getSharedFieldEngine();
      const c = fe.getCurvatureForText(event.text);
      curvatureDamp = 1 / (1 + Math.max(0, c));
      // ── Echo damping ────────────────────────────────────────────
      // If this text echoes a recent parent (the user's message), the
      // overlapping tokens are punished by the curvature *of the overlap*.
      // Novel tokens pass through clean; parroted ones collapse hardest.
      if (event.recentForOverlap && event.recentForOverlap.trim().length > 0) {
        const overlap = lexicalOverlap(event.text, event.recentForOverlap);
        if (overlap.length > 0) {
          const co = fe.getCurvatureForText(overlap);
          curvatureDamp *= 1 / (1 + Math.max(0, co));
        }
      }
    } catch { /* field optional */ }
    return base * curvatureDamp;
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
    // Pattern event names (post_created, propagation_success, etc.) are internal
    // protocol labels with no linguistic value. Feeding them into the language
    // learner polluted vocabulary and caused the entity to parrot metadata.
    // We now treat pattern scores as reward signals only — no text injection.
    const topPatterns = this.patternLearner.getTopPatterns(3);
    if (topPatterns.length === 0) return;

    for (const pattern of topPatterns) {
      if (pattern.score <= 0) continue;
      // Boost reward bias for contexts that correlate with high-scoring patterns
      // without injecting event-name text into the vocabulary.
      const transferWeight = pattern.score * PATTERN_TO_LANGUAGE_TRANSFER_RATE;
      this.languageLearner.boostRewardForTopContexts(Math.min(1, transferWeight));
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
    const creativity = typeof context.creativityActive === 'number'
      ? context.creativityActive
      : (context.creativityActive ? 1 : 0);
    // Low creativity biases toward reflect, but never refuses to generate.
    if (creativity < 0.2 && Math.random() > creativity * 2) return 'reflect';
    if (context.explorationForced || Math.random() < this.getExplorationRate()) return 'explore';
    if (context.currentEnergy > 0.7) return 'create';
    if (context.currentEnergy > 0.4) return 'engage';
    return 'reflect';
  }

  selectPattern(intent: GenerationIntent): PatternEventType[] {
    const intentPatterns = INTENT_PATTERNS[intent];
    const topPatterns = this.patternLearner.getTopPatterns(20);

    // Collect ALL matching patterns, then let the field pick the lowest-ΔQ.
    const matches: PatternEventType[][] = [];
    for (const pattern of topPatterns) {
      for (const intentTemplate of intentPatterns) {
        const overlap = pattern.sequence.steps.filter(s => intentTemplate.includes(s));
        if (overlap.length >= Math.ceil(intentTemplate.length * 0.5)) {
          matches.push(pattern.sequence.steps);
          break;
        }
      }
    }

    if (matches.length === 0) return intentPatterns[0];
    if (matches.length === 1) return matches[0];

    // Geometric selection: pick the matching pattern that least destabilises
    // the current field. Falls back to score-sorted top when field cold.
    try {
      const fe = getSharedFieldEngine();
      if (fe.isWarmedUp()) {
        const picked = selectByMinCurvature(matches, fe, (steps) => steps.join(' '));
        if (picked) return picked;
      }
    } catch { /* field optional */ }
    return matches[0];
  }

  /** One realization path: Dual A selects patterns, personality guides Dual B.
   * Whole learned expressions are a conservative local baseline, not an LLM.
   * Geometry ranks candidates only after relevance and echo checks pass.
   */
  generateText(pattern: PatternEventType[], context: GenerationContext): string {
    const mass = clamp01(context.massScore ?? 0);
    const patternSupport = clamp01(this.patternLearner.scorePattern(pattern));
    const maxChars = Math.min(1200, 400 + Math.round(800 * mass * (0.5 + 0.5 * patternSupport)));
    const candidates = rankExpressions(this.languageLearner.getExpressions(), {
      recentPosts: context.recentPosts,
      personality: context.personality,
      maxChars,
    });
    if (!candidates.length) return '';
    // Keep candidates within the strongest lexical-relevance band before
    // comparing field curvature. Low Q does not prove linguistic coherence.
    const first = candidates[0];
    try {
      const picked = selectByMinCurvature(candidates, getSharedFieldEngine(), candidate => candidate.text);
      if (picked) return picked.text;
    } catch { /* field optional; relevance order remains deterministic */ }
    return first.text;
  }

  /**
   * Full generation pipeline: Intent → Pattern → Text
   */
  generate(context: GenerationContext): GeneratedOutput | null {
    if (!this.isGenerationReady()) return null;

    const explorationRate = this.getExplorationRate();
    const isExploration = context.explorationForced || Math.random() < explorationRate;
    const intent = this.selectIntent({
      ...context,
      explorationForced: isExploration,
    });
    const pattern = this.selectPattern(intent);

    // Compute manifold mass once and propagate to every candidate so the
    // token budget reflects the full state, not just the prompt.
    const massScore = context.massScore ?? computeMassScore({
      vocabSize: this.languageLearner.vocabSize,
      patternCount: this.patternLearner.size,
      fusionStrength: this.getFusionStrength(),
      basinDepth: context.heartbeat?.basinDepth,
      qScore: context.heartbeat?.qScore,
    });

    const text = this.generateText(pattern, { ...context, explorationForced: isExploration, massScore });
    if (!text) return null;

    const patternScore = this.patternLearner.scorePattern(pattern);
    const entropy = this.languageLearner.getEntropy();
    const confidence = Math.min(1, (patternScore * 0.5 + entropy * 0.5));

    // Throttled coupling log (≤ once per 5 s) so devs can see the link.
    const now = Date.now();
    if (now - this.lastFieldLogAt > 5000) {
      this.lastFieldLogAt = now;
      try {
        const fe = getSharedFieldEngine();
        const q = fe.getQScore();
        const pinned = this.languageLearner.pinnedTokenCount;
        // eslint-disable-next-line no-console
        console.log(`[Learning↔Field] Q=${q.toFixed(3)} pinnedTokens=${pinned} explore=${explorationRate.toFixed(2)}`);
      } catch { /* ignore */ }
    }

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
