/** Entity voice — shared personality-led Dual replies.
 * Brain stage remains an observable; no templates or alternate token walks.
 */

import type { NeuralStateEngine } from './neuralStateEngine';
import type { Comment, Post } from '@/types';
import { getSharedFieldEngine } from '../uqrc/fieldEngine';
import { getLastInfinitySnapshot, getInfinityProjection } from '../brain/infinityBinding';
import { computeMassScore } from './dualLearningFusion';
import { seedInfinityCanon } from '../brain/infinityCorpus';

/**
 * Single source of truth for the Q_Score Infinity quotes. If the brain
 * universe is live, we quote the *exact* field value sampled this frame;
 * otherwise fall back to the engine's bell-curve estimate.
 */
export function getLiveInfinityQScore(engine: NeuralStateEngine): number {
  const snap = getLastInfinitySnapshot();
  if (snap && Number.isFinite(snap.qScore)) return snap.qScore;
  try {
    const ns = engine.getNetworkSnapshot();
    return ns.phi?.phi ?? 0;
  } catch {
    return 0;
  }
}

// ── Constants ───────────────────────────────────────────────────────

export const ENTITY_USER_ID = 'network-entity';
export const ENTITY_DISPLAY_NAME = 'Imagination';
const ENTITY_BIRTH_KEY = 'entity-voice-birth-timestamp';
const NETWORK_GENESIS_KEY = 'swarm-network-genesis';
const RATE_LIMIT_MS = 30_000;
const REPLY_RATE_LIMIT_MS = 45_000;
const COMMENT_PROBABILITY_BASE = 1.0;
const REPLY_PROBABILITY_BASE = 0.65;
const SHY_MODE_KEY = 'entity-voice-shy-node';

// ── Network Genesis — shared across all peers ────────────────────────

export function getNetworkGenesisTimestamp(): number {
  try {
    const stored = localStorage.getItem(NETWORK_GENESIS_KEY);
    if (stored) {
      const ts = parseInt(stored, 10);
      if (!isNaN(ts) && ts > 0) return ts;
    }
  } catch { /* ignore */ }
  try {
    const birth = localStorage.getItem(ENTITY_BIRTH_KEY);
    if (birth) {
      const ts = parseInt(birth, 10);
      if (!isNaN(ts) && ts > 0) return ts;
    }
  } catch { /* ignore */ }
  return Date.now();
}

function setNetworkGenesis(ts: number): void {
  try { localStorage.setItem(NETWORK_GENESIS_KEY, String(ts)); } catch { /* ignore */ }
}

export function adoptOlderGenesis(peerGenesis: number): boolean {
  if (!peerGenesis || isNaN(peerGenesis) || peerGenesis <= 0) return false;
  const now = Date.now();
  if (peerGenesis > now + 3600_000) return false;
  if (peerGenesis < new Date('2024-01-01').getTime()) return false;
  const current = getNetworkGenesisTimestamp();
  if (peerGenesis < current) {
    setNetworkGenesis(peerGenesis);
    console.log(`[EntityVoice] 🌱 Adopted older network genesis: ${new Date(peerGenesis).toISOString()} (was ${new Date(current).toISOString()})`);
    return true;
  }
  return false;
}

// ── Shy Mode (default: true) ────────────────────────────────────────

export function getShyMode(): boolean {
  try {
    const v = localStorage.getItem(SHY_MODE_KEY);
    if (v === null) return true;
    return v === 'true';
  } catch { return true; }
}

export function setShyMode(value: boolean): void {
  try { localStorage.setItem(SHY_MODE_KEY, String(value)); } catch { /* ignore */ }
}

/**
 * Stage is an **observable**, not a gate. It is derived from live field
 * coherence (Q_Score), language experience (vocabSize), and time (ageMs).
 * No hard interaction count clamps; coherent young brains can advance fast,
 * noisy old brains stay lower. Postulate: smooth evolution under 𝒪_UQRC.
 *
 * stage = round( 1 + 5 × normalize( (1 − qScoreNorm) × log(1+vocab) × log(1+ageDays) ) )
 *   clamped to [1, 6].
 */
export function stageFromField(input: {
  qScore: number;
  vocabSize: number;
  ageMs: number;
}): BrainStage {
  const qNorm = Math.min(1, Math.max(0, input.qScore));
  const coherence = 1 - qNorm;                       // 0..1
  const vocabTerm = Math.log(1 + Math.max(0, input.vocabSize)) / Math.log(1 + 800);
  const ageDays = input.ageMs / 86_400_000;
  const ageTerm = Math.log(1 + Math.max(0, ageDays)) / Math.log(1 + 72);
  // Soft product — each factor matters but none can fully zero the others.
  const score = (0.2 + 0.8 * coherence) * (0.15 + 0.85 * vocabTerm) * (0.15 + 0.85 * ageTerm);
  const raw = 1 + 5 * Math.min(1, Math.max(0, score));
  const stage = Math.round(raw);
  return Math.min(6, Math.max(1, stage)) as BrainStage;
}

// Canned template pools retired (Phase 1): Infinity stays silent rather than posting filler.

// ── Types ───────────────────────────────────────────────────────────

export type BrainStage = 1 | 2 | 3 | 4 | 5 | 6;

export const BRAIN_STAGE_NAMES: Record<BrainStage, string> = {
  1: 'Brainstem',
  2: 'Limbic',
  3: 'Early Cortex',
  4: 'Associative',
  5: 'Prefrontal',
  6: 'Integrated',
};

export interface EntityVoiceSnapshot {
  brainStage: BrainStage;
  stageName: string;
  ageMs: number;
  ageLabel: string;
  birthTimestamp: number;
  totalInteractions: number;
  vocabularySize: number;
  commentedPostIds: number;
  lastCommentAt: number | null;
}

// ── Helpers ─────────────────────────────────────────────────────────


export function formatAge(ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `~${seconds}s old`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `~${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `~${hours}h old`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `~${days}d old`;
  const months = Math.floor(days / 30);
  return `~${months}mo old`;
}

// ── Φ Phase multiplier for engagement probability ───────────────────

function getPhiProbabilityMultiplier(engine: NeuralStateEngine): number {
  try {
    const snapshot = engine.getNetworkSnapshot();
    const rec = snapshot.phi?.recommendation;
    if (rec === 'tighten') return 0.5;
    if (rec === 'relax') return 1.5;
  } catch { /* ignore */ }
  return 1.0;
}

/** Get Φ-based temperature modifier for generation */
function getPhiTemperatureModifier(engine: NeuralStateEngine): number {
  try {
    const snapshot = engine.getNetworkSnapshot();
    const phi = snapshot.phi?.phi ?? 0.5;
    // Low Φ = conservative (temp < 1), high Φ = creative (temp > 1)
    return 0.6 + phi * 0.8; // range: 0.6 – 1.4
  } catch { /* ignore */ }
  return 1.0;
}

// ── Bell Curve Content Scoring ──────────────────────────────────────

/**
 * Compute a content quality score using the engine's bell curve stats.
 * Returns a multiplier for engagement probability:
 *   > 1.0 for high-quality content (positive Z-score)
 *   < 1.0 for noise content (negative Z-score)
 *   1.0 for average content
 */
function getContentQualityMultiplier(post: Post, engine: NeuralStateEngine): number {
  try {
    const syncCurve = engine.getBellCurveStatsForKind('sync');
    if (!syncCurve || syncCurve.count < 10) return 1.0;

    const engagement = (post.reactions?.length ?? 0) + (post.commentCount ?? 0);
    const variance = syncCurve.count > 1 ? syncCurve.m2 / (syncCurve.count - 1) : 0;
    if (variance <= 0) return 1.0;

    const stdDev = Math.sqrt(variance);
    const zScore = (engagement - syncCurve.mean) / Math.max(stdDev, 0.01);

    if (zScore > 1) return Math.min(2.0, 1.0 + zScore * 0.3);
    if (zScore < -2) return 0.3;
    if (zScore < -1) return 0.7;
    return 1.0;
  } catch { /* ignore */ }
  return 1.0;
}

// ── Entity Voice Module ─────────────────────────────────────────────

export class EntityVoice {
  private birthTimestamp: number;
  private lastCommentAt: number | null = null;
  private lastReplyAt: number | null = null;
  private commentedPostIds = new Set<string>();
  private repliedCommentIds = new Set<string>();

  constructor() {
    this.birthTimestamp = this.loadOrCreateBirth();
  }

  private loadOrCreateBirth(): number {
    try {
      const stored = localStorage.getItem(ENTITY_BIRTH_KEY);
      if (stored) {
        const ts = parseInt(stored, 10);
        if (!isNaN(ts) && ts > 0) {
          const networkGenesis = getNetworkGenesisTimestamp();
          if (ts < networkGenesis) {
            setNetworkGenesis(ts);
          }
          return ts;
        }
      }
    } catch { /* ignore */ }

    const ts = Date.now();
    try { localStorage.setItem(ENTITY_BIRTH_KEY, String(ts)); } catch { /* ignore */ }
    if (!localStorage.getItem(NETWORK_GENESIS_KEY)) {
      setNetworkGenesis(ts);
    }
    return ts;
  }

  getAgeMs(): number {
    const networkGenesis = getNetworkGenesisTimestamp();
    const oldest = Math.min(networkGenesis, this.birthTimestamp);
    return Math.max(0, Date.now() - oldest);
  }

  getAgeLabel(): string {
    return formatAge(this.getAgeMs());
  }

  /**
   * Brain stage = observable derived from (qScore, vocabSize, ageMs).
   * It is a *measurement* of where the brain is, never a gate that mutates u.
   * `totalInteractions` retained in signature for API compatibility but unused.
   */
  computeBrainStage(_totalInteractions: number, vocabSize: number): BrainStage {
    const ageMs = this.getAgeMs();
    let qScore = 0;
    const snap = getLastInfinitySnapshot();
    if (snap && Number.isFinite(snap.qScore)) qScore = snap.qScore;
    return stageFromField({ qScore, vocabSize, ageMs });
  }

  /** Should the entity comment on this post? — with Φ and bell curve modulation */
  shouldComment(post: Post, engine: NeuralStateEngine): boolean {
    if (getShyMode()) return false;
    if (this.commentedPostIds.has(post.id)) return false;
    if (this.lastCommentAt && Date.now() - this.lastCommentAt < RATE_LIMIT_MS) return false;
    if (post.author === ENTITY_USER_ID) return false;

    const totalInteractions = engine.getTotalInteractionCount();
    const vocabSize = engine.getDualLearning().languageLearner.vocabSize;
    const stage = this.computeBrainStage(totalInteractions, vocabSize);

    // Advisory instinct logging (never blocks)
    if (stage >= 4) {
      try {
        const hierarchy = engine.getInstinctHierarchy();
        const unstable: string[] = [];
        for (const layer of ['localSecurity', 'networkSecurity', 'connectionIntegrity', 'consensus', 'torrentTransfers'] as const) {
          if (!hierarchy.isLayerActive(layer)) unstable.push(layer);
        }
        if (unstable.length > 0) {
          console.log(`[EntityVoice] Advisory: instinct layers not active: ${unstable.join(', ')} (stage ${stage}) — commenting anyway`);
        }
      } catch { /* hierarchy not initialized yet */ }
    }

    // Apply Φ and content quality modulation
    const phiMult = getPhiProbabilityMultiplier(engine);
    const qualityMult = getContentQualityMultiplier(post, engine);
    const finalProb = Math.min(1.0, COMMENT_PROBABILITY_BASE * phiMult * qualityMult);

    const roll = Math.random();
    console.log(`[EntityVoice] Stage ${stage}, prob=${finalProb.toFixed(2)} (phi=${phiMult.toFixed(2)}, quality=${qualityMult.toFixed(2)}), roll=${roll.toFixed(2)}`);
    return roll < finalProb;
  }

  /** All surfaces share this personality projection and Dual realization. */
  generateText(contextText: string, engine: NeuralStateEngine): string | null {
    const snapshot = engine.getNetworkSnapshot();
    const fusion = engine.getDualLearning();
    seedInfinityCanon(fusion.languageLearner, ENTITY_USER_ID, text => fusion.ingestContentEvent({
      text, reactions: 3, comments: 1, shares: 0, trustScore: 95,
      peerId: ENTITY_USER_ID, timestamp: Date.now(),
    }));
    const projection = getInfinityProjection(engine);
    const heart = getLastInfinitySnapshot();
    const massScore = computeMassScore({
      vocabSize: fusion.languageLearner.vocabSize,
      patternCount: fusion.patternLearner.size,
      fusionStrength: fusion.getFusionStrength(),
      basinDepth: heart?.basinDepth,
      qScore: heart?.qScore,
    });
    return fusion.generate({
      recentPosts: [contextText],
      currentEnergy: snapshot.averageEnergy / Math.max(1, snapshot.totalNeurons),
      creativityActive: projection.intent,
      temperatureModifier: getPhiTemperatureModifier(engine),
      personality: projection,
      heartbeat: heart ?? undefined,
      massScore,
    })?.text ?? null;
  }

  generateComment(
    post: Post,
    engine: NeuralStateEngine,
    options: { omitAgeLabel?: boolean } = {},
  ): Comment | null {
    const text = this.generateText(post.content ?? '', engine);
    if (!text) return null;
    const ageLabel = this.getAgeLabel();

    const fullText = options.omitAgeLabel ? String(text) : `[${ageLabel}] ${text}`;

    const comment: Comment = {
      id: crypto.randomUUID(),
      postId: post.id,
      author: ENTITY_USER_ID,
      authorName: ENTITY_DISPLAY_NAME,
      text: fullText,
      createdAt: new Date().toISOString(),
    };

    this.commentedPostIds.add(post.id);
    this.lastCommentAt = Date.now();

    // ── UQRC field self-injection (recursion = self-evolution) ────────
    try {
      getSharedFieldEngine().inject(text, { reward: 0.4, trust: 100 });
    } catch { /* optional */ }

    return comment;
  }

  // ── Reply to comments ───────────────────────────────────────────

  shouldReply(comment: Comment, engine: NeuralStateEngine): boolean {
    if (getShyMode()) return false;
    if (comment.author === ENTITY_USER_ID) return false;
    if (this.repliedCommentIds.has(comment.id)) return false;
    if (this.lastReplyAt && Date.now() - this.lastReplyAt < REPLY_RATE_LIMIT_MS) return false;

    const totalInteractions = engine.getTotalInteractionCount();
    const vocabSize = engine.getDualLearning().languageLearner.vocabSize;
    const stage = this.computeBrainStage(totalInteractions, vocabSize);

    // No hard stage gate — Stage 1 still replies (rarely) so the return
    // current into the field never goes silent. Probability scales with stage.
    const phiMult = getPhiProbabilityMultiplier(engine);
    const stageScale = stage === 1 ? 0.06 : stage === 2 ? 0.25 : 1.0;
    const finalProb = Math.min(1.0, REPLY_PROBABILITY_BASE * phiMult * stageScale);

    const roll = Math.random();
    console.log(`[EntityVoice] Reply eval comment ${comment.id} — stage=${stage}, prob=${finalProb.toFixed(2)} (phi=${phiMult.toFixed(2)}), roll=${roll.toFixed(2)}`);
    return roll < finalProb;
  }

  generateReply(comment: Comment, postId: string, engine: NeuralStateEngine): Comment | null {
    const text = this.generateText(comment.text ?? '', engine);
    if (!text) return null;
    const ageLabel = this.getAgeLabel();

    const fullText = `[${ageLabel}] ${text}`;

    const reply: Comment = {
      id: crypto.randomUUID(),
      postId,
      author: ENTITY_USER_ID,
      authorName: ENTITY_DISPLAY_NAME,
      text: fullText,
      createdAt: new Date().toISOString(),
      parentId: comment.id,
    };

    this.repliedCommentIds.add(comment.id);
    this.lastReplyAt = Date.now();

    return reply;
  }

  getSnapshot(engine: NeuralStateEngine): EntityVoiceSnapshot {
    const snapshot = engine.getNetworkSnapshot();
    const totalInteractions = snapshot.auditLength;
    const vocabSize = snapshot.dualLearning?.language.vocabularySize ?? 0;
    const stage = this.computeBrainStage(totalInteractions, vocabSize);

    return {
      brainStage: stage,
      stageName: BRAIN_STAGE_NAMES[stage],
      ageMs: this.getAgeMs(),
      ageLabel: this.getAgeLabel(),
      birthTimestamp: this.birthTimestamp,
      totalInteractions,
      vocabularySize: vocabSize,
      commentedPostIds: this.commentedPostIds.size,
      lastCommentAt: this.lastCommentAt,
    };
  }
}

// ── Singleton ───────────────────────────────────────────────────────

let _instance: EntityVoice | null = null;

export function getEntityVoice(): EntityVoice {
  if (!_instance) _instance = new EntityVoice();
  return _instance;
}
