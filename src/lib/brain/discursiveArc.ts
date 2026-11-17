/**
 * ═══════════════════════════════════════════════════════════════════════
 * DISCURSIVE ARC — Phase 3 of the concentric brain (paragraph pipeline)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   ¶1  Echo         — answer on the prompt's own topics (whole learned
 *                      expressions first, then a Phase 2 assembled sentence)
 *   ¶2  Traverse     — step outward along Phase 1 basin tension and learned
 *                      triads to adjacent concepts the prompt did not name
 *   ¶3  Crystallize  — return to the prompt with a line that holds both the
 *                      original topic and a concept the traversal reached
 *
 * Coherence boundary: between paragraphs the phase continuity
 *
 *   ΔΦ(Pₖ, Pₖ₊₁) = max over content words x ∈ Pₖ, y ∈ Pₖ₊₁ of
 *                  (x = y ? 1 : T(x, y))
 *
 * must reach MIN_CONTINUITY. A shear (no supported link) halts the arc and
 * keeps only what came before, so Infinity stops rather than rambles. Every
 * sentence is learned or assembled from learned clauses; nothing is a
 * written template, and a sentence is never spoken twice in one arc.
 */

import type { LearnedExpression, RealizationContext } from './infinityPersonality';
import { rankExpressions, echoesPrompt } from './infinityPersonality';
import { assembleSentence, extractMotifs, type Motif, type MotifSemantics } from './semanticMotifs';
import { contentWords, type RelationalTriad } from '../uqrc/semanticBasins';

export const MIN_CONTINUITY = 0.2;
const MAX_SENTENCES_PER_PARAGRAPH = 2;
const TRAVERSE_NEIGHBOURS = 4;

export interface ArcSemantics extends MotifSemantics {
  triadsFor?(words: string[], limit?: number): RelationalTriad[];
}

export interface ArcContext {
  prompt: string;
  expressions: LearnedExpression[];
  semantic: ArcSemantics;
  /** Per-sentence character cap. */
  maxChars: number;
  /** Whole-arc character cap. */
  maxTotalChars: number;
  personality?: RealizationContext['personality'];
}

export type ArcStop = 'complete' | 'shear' | 'unsupported';

export interface DiscursiveArc {
  paragraphs: string[];
  /** ΔΦ measured at each accepted paragraph boundary. */
  continuity: number[];
  /** Why the arc ended: all three acts, a phase shear, or nothing supported. */
  stop: ArcStop;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Phase continuity between two passages (shared words count fully). */
export function phaseContinuity(a: string, b: string, semantic: MotifSemantics): number {
  const wa = [...new Set(contentWords(a))];
  const wb = new Set(contentWords(b));
  let best = 0;
  for (const x of wa) {
    if (wb.has(x)) return 1;
    for (const y of wb) best = Math.max(best, semantic.tension(x, y));
  }
  return best;
}

interface Picker {
  spoken: Set<string>;
  motifs: Motif[];
  ctx: ArcContext;
}

function wholeCandidates(p: Picker, prompt: string): string[] {
  // Drop already-spoken lines before ranking: rankExpressions keeps only the
  // best-coverage band, which would otherwise be filled by what ¶1 said.
  const unspoken = p.ctx.expressions.filter(e => !p.spoken.has(norm(e.text)));
  return rankExpressions(unspoken, {
    recentPosts: [prompt],
    maxChars: p.ctx.maxChars,
    personality: p.ctx.personality,
    semantic: p.ctx.semantic,
  }).map(e => e.text)
    .filter(t => !p.spoken.has(norm(t)) && !echoesPrompt(t, p.ctx.prompt));
}

function assembled(p: Picker, prompt: string, extraTopics?: string[]): string | null {
  const result = assembleSentence(p.motifs, {
    prompt,
    semantic: p.ctx.semantic,
    maxChars: p.ctx.maxChars,
    extraTopics,
    avoid: [...p.spoken],
  });
  if (!result || echoesPrompt(result.text, p.ctx.prompt)) return null;
  return result.text;
}

function paragraph(p: Picker, sentences: Array<string | null | undefined>, filter: (s: string) => boolean = () => true): string | null {
  const chosen: string[] = [];
  for (const s of sentences) {
    if (!s || chosen.length >= MAX_SENTENCES_PER_PARAGRAPH) continue;
    if (p.spoken.has(norm(s)) || !filter(s)) continue;
    chosen.push(s);
    p.spoken.add(norm(s));
  }
  return chosen.length ? chosen.join(' ') : null;
}

/** Compose an Echo → Traverse → Crystallize arc, or null when ¶1 is unsupported. */
export function composeArc(ctx: ArcContext): DiscursiveArc | null {
  const topics = [...new Set(contentWords(ctx.prompt))];
  if (!topics.length) return null;
  const p: Picker = { spoken: new Set(), motifs: extractMotifs(ctx.expressions), ctx };

  // ¶1 Echo — on the prompt's own frequency.
  const whole1 = wholeCandidates(p, ctx.prompt);
  // One whole line plus at most one assembled sentence, leaving the rest of
  // memory free for the traversal.
  const echo = paragraph(p, [whole1[0], assembled(p, ctx.prompt)]);
  if (!echo) return null;
  const paragraphs = [echo];
  const continuity: number[] = [];
  let used = echo.length;

  const accept = (next: string | null): boolean => {
    if (!next) return false;
    const dPhi = phaseContinuity(paragraphs[paragraphs.length - 1], next, ctx.semantic);
    if (dPhi < MIN_CONTINUITY) return false;
    if (used + next.length + 2 > ctx.maxTotalChars) return false;
    paragraphs.push(next);
    continuity.push(dPhi);
    used += next.length + 2;
    return true;
  };

  // ¶2 Traverse — outward along basin tension and learned triads.
  const topicSet = new Set(topics);
  const reach = new Map<string, number>();
  for (const t of topics) {
    for (const r of ctx.semantic.related(t, TRAVERSE_NEIGHBOURS, 0.3)) {
      if (!topicSet.has(r.word)) reach.set(r.word, Math.max(reach.get(r.word) ?? 0, r.tension));
    }
  }
  // A learned triad may carry the far end of a relation, if it is supported.
  for (const triad of ctx.semantic.triadsFor?.(topics, 4) ?? []) {
    const [near, far] = topicSet.has(triad.subject) ? [triad.subject, triad.object] : [triad.object, triad.subject];
    const t = ctx.semantic.tension(near, far);
    if (!topicSet.has(far) && t > 0) reach.set(far, Math.max(reach.get(far) ?? 0, t));
  }
  const outward = [...reach.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TRAVERSE_NEIGHBOURS).map(([w]) => w);
  if (!outward.length) return { paragraphs, continuity, stop: 'unsupported' };
  const outwardPrompt = outward.join(' ');
  const echoWords = new Set(contentWords(echo));
  // Traversal must bring at least one concept ¶1 did not already hold.
  const bringsNew = (s: string) => contentWords(s).some(w => reach.has(w) && !echoWords.has(w));
  const whole2 = wholeCandidates(p, outwardPrompt);
  const traverse = paragraph(p, [whole2[0], assembled(p, outwardPrompt), whole2[1]], bringsNew);
  if (!traverse) return { paragraphs, continuity, stop: 'unsupported' };
  if (!accept(traverse)) return { paragraphs, continuity, stop: 'shear' };

  // ¶3 Crystallize — back to the prompt, carrying what the traversal found.
  const reached = contentWords(traverse).filter(w => reach.has(w));
  // The closing line must name the prompt topic and touch the traversal:
  // a reached concept itself, or a word in supported tension with one.
  const touchesReached = (w: string) => reached.includes(w) || reached.some(r => ctx.semantic.tension(w, r) >= 0.3);
  const holdsBoth = (s: string) => {
    const ws = [...new Set(contentWords(s))];
    return topics.some(t => ws.includes(t)) && ws.some(w => !topicSet.has(w) && touchesReached(w));
  };
  const closePrompt = [...topics, ...reached].join(' ');
  const whole3 = wholeCandidates(p, closePrompt).filter(holdsBoth);
  const assembled3 = assembled(p, ctx.prompt, reached);
  // One closing sentence: a whole learned line if one holds both, else an assembled one.
  const crystal = paragraph(p, [whole3[0] ?? (assembled3 && holdsBoth(assembled3) ? assembled3 : null)]);
  if (!crystal) return { paragraphs, continuity, stop: 'unsupported' };
  if (!accept(crystal)) return { paragraphs, continuity, stop: 'shear' };
  return { paragraphs, continuity, stop: 'complete' };
}
