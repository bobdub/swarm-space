/**
 * ═══════════════════════════════════════════════════════════════════════
 * SEMANTIC MOTIFS — Phase 2 of the concentric brain (clause assembly)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Learned sentences are cut at their own clause boundaries into motifs:
 *
 *   A  Attunement  — an opening stance clause   ("When the mesh grows quiet")
 *   B  Core        — an independent clause carrying a relational triad
 *                    ("the pulse carries what was left unmined")
 *   C  Anchor      — a closing clause joined by a conjunction
 *                    ("and memory settles like silt in the ledger")
 *
 * A new sentence is A? + B + C? drawn from at least two different learned
 * sentences. Joins are allowed only where the Phase 1 lattice shows positive
 * field tension between the neighbouring clauses (phase resonance), and the
 * core must carry a prompt topic or a supported basin neighbour. Clauses
 * may not restate each other's content words.
 *
 * Every word comes from Infinity's own learned lines; nothing here is a
 * written template. Symbolic expressions (formulas, kets, Embers) are never
 * cut. Assembly is a fallback after whole-expression ranking finds nothing,
 * and it returns null when no resonant combination exists — silence stays.
 */

import type { LearnedExpression } from './infinityPersonality';
import { echoesPrompt, hasBalancedNotation } from './infinityPersonality';
import { contentWords, extractTriad } from '../uqrc/semanticBasins';

export type MotifRole = 'attunement' | 'core' | 'anchor';

export interface Motif {
  text: string;
  role: MotifRole;
  words: string[];
  source: string;
  weight: number;
}

/** Tension geometry from Phase 1 (SemanticLattice satisfies this). */
export interface MotifSemantics {
  tension(a: string, b: string): number;
  related(word: string, limit?: number, minTension?: number): Array<{ word: string; tension: number }>;
}

export interface MotifAssemblyContext {
  prompt: string;
  semantic: MotifSemantics;
  maxChars: number;
  /** Optional extra topics (e.g. from a previous paragraph) the core may carry. */
  extraTopics?: string[];
  /** Sentences that must not be reproduced (already spoken). */
  avoid?: string[];
}

export interface AssembledSentence {
  text: string;
  motifs: Motif[];
  /** Weakest resonance across the joins (0..1). */
  resonance: number;
  relevance: number;
}

/** Below this, a join between clauses is a phase shear and is rejected. */
export const MIN_RESONANCE = 0.2;
const BRIDGE_MIN_TENSION = 0.3;

const SYMBOLIC_RE = /[=Ψ⊗ℓ⟩⟨μν𝒟𝒪∇Δλε‖↔ℛ|]/u;
const STANCE_OPENERS = new Set(
  'when while as if in within between beneath beyond before after where through across under among since once though although whenever wherever'.split(' '),
);
const ANCHOR_OPENERS = new Set('and so yet like until where while as'.split(' '));
/** Opening words of a core that may be lowercased safely after an attunement. */
const LOWERCASE_SAFE = new Set(
  'the a an every each this that these those its our my your their his her we they it there some all no one'.split(' '),
);

const firstWord = (text: string): string => (text.toLowerCase().match(/[\p{L}\p{N}_']+/u)?.[0] ?? '');
const wordCount = (text: string): number => (text.match(/[\p{L}\p{N}_']+/gu) ?? []).length;
const stripEnd = (text: string): string => text.replace(/[\s.,;:!?…—–-]+$/u, '').trim();

/** Cut learned (non-symbolic) sentences into role-labelled motifs. */
export function extractMotifs(expressions: LearnedExpression[]): Motif[] {
  const out: Motif[] = [];
  const seen = new Set<string>();
  for (const expression of expressions) {
    const sentence = expression.text.trim();
    if (SYMBOLIC_RE.test(sentence) || /^Ember\s+\d/i.test(sentence)) continue;
    const clauses = sentence.split(/\s*(?:,|;|—|–|\s-\s)\s*/u).map(stripEnd).filter(Boolean);
    clauses.forEach((clause, i) => {
      const opener = firstWord(clause);
      const n = wordCount(clause);
      let role: MotifRole | null = null;
      if (i === 0 && clauses.length > 1 && STANCE_OPENERS.has(opener) && n >= 2 && n <= 12) role = 'attunement';
      else if (i > 0 && i === clauses.length - 1 && ANCHOR_OPENERS.has(opener) && n >= 3 && n <= 14) role = 'anchor';
      else if (!STANCE_OPENERS.has(opener) && !ANCHOR_OPENERS.has(opener) && n >= 3 && n <= 20 && extractTriad(clause)) role = 'core';
      if (!role || !hasBalancedNotation(clause)) return;
      const key = `${role}:${clause.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ text: clause, role, words: [...new Set(contentWords(clause))], source: sentence, weight: expression.weight });
    });
  }
  return out;
}

/** Strongest supported tension between distinct content words of two clauses. */
export function resonance(a: Motif, b: Motif, semantic: MotifSemantics): number {
  let best = 0;
  for (const x of a.words) for (const y of b.words) {
    if (x !== y) best = Math.max(best, semantic.tension(x, y));
  }
  return best;
}

/** Clauses that restate the same content word read as stutter, not thought. */
function repeatsWords(motifs: Array<Motif | null>): boolean {
  const seen = new Set<string>();
  for (const m of motifs) {
    if (!m) continue;
    for (const w of m.words) {
      if (seen.has(w)) return true;
    }
    for (const w of m.words) seen.add(w);
  }
  return false;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function joinMotifs(a: Motif | null, b: Motif, c: Motif | null): string | null {
  let core = b.text;
  if (a) {
    const opener = firstWord(core);
    if (opener !== 'i' && !LOWERCASE_SAFE.has(opener)) return null;
    if (opener !== 'i') core = core.charAt(0).toLowerCase() + core.slice(1);
  }
  const parts = [a ? capitalize(a.text) : capitalize(core)];
  if (a) parts.push(core);
  const head = parts.join(', ');
  return c ? `${head}, ${c.text.charAt(0).toLowerCase()}${c.text.slice(1)}.` : `${head}.`;
}

/**
 * Assemble the best resonant A? + B + C? sentence for a prompt, or null.
 * Deterministic: equal inputs give equal output.
 */
export function assembleSentence(motifs: Motif[], context: MotifAssemblyContext): AssembledSentence | null {
  const wanted = new Set([...contentWords(context.prompt), ...(context.extraTopics ?? [])]);
  if (!wanted.size) return null;
  const reach = new Map<string, number>();
  for (const topic of wanted) {
    reach.set(topic, 1);
    for (const r of context.semantic.related(topic, 6, BRIDGE_MIN_TENSION)) {
      reach.set(r.word, Math.max(reach.get(r.word) ?? 0, r.tension));
    }
  }
  const relevanceOf = (m: Motif) => Math.max(0, ...m.words.map(w => reach.get(w) ?? 0));
  const avoid = new Set((context.avoid ?? []).map(s => s.toLowerCase().replace(/\s+/g, ' ').trim()));

  const cores = motifs.filter(m => m.role === 'core')
    .map(m => ({ m, rel: relevanceOf(m) }))
    .filter(x => x.rel > 0)
    .sort((x, y) => y.rel - x.rel || y.m.weight - x.m.weight || x.m.text.localeCompare(y.m.text))
    .slice(0, 6);
  if (!cores.length) return null;
  const attunements = motifs.filter(m => m.role === 'attunement');
  const anchors = motifs.filter(m => m.role === 'anchor');

  let best: (AssembledSentence & { score: number }) | null = null;
  for (const { m: core, rel } of cores) {
    const aOptions: Array<{ m: Motif | null; r: number }> = [{ m: null, r: 1 }];
    for (const a of attunements) {
      if (a.source === core.source) continue;
      const r = resonance(a, core, context.semantic);
      if (r >= MIN_RESONANCE) aOptions.push({ m: a, r });
    }
    const cOptions: Array<{ m: Motif | null; r: number }> = [{ m: null, r: 1 }];
    for (const c of anchors) {
      if (c.source === core.source) continue;
      const r = resonance(core, c, context.semantic);
      if (r >= MIN_RESONANCE) cOptions.push({ m: c, r });
    }
    for (const a of aOptions) for (const c of cOptions) {
      if (!a.m && !c.m) continue; // a lone core is just a piece of an old line
      if (a.m && c.m && a.m.source === c.m.source) continue;
      if (repeatsWords([a.m, core, c.m])) continue;
      const text = joinMotifs(a.m, core, c.m);
      if (!text || text.length > context.maxChars) continue;
      if (echoesPrompt(text, context.prompt) || !hasBalancedNotation(text)) continue;
      const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
      if (avoid.has(norm)) continue;
      if ([core, a.m, c.m].some(m => m && m.source.toLowerCase().replace(/\s+/g, ' ').trim() === norm)) continue;
      const res = Math.min(a.r, c.r);
      const support = Math.min(1, ((a.m?.weight ?? 0) + core.weight + (c.m?.weight ?? 0)) / 15);
      const score = rel * 2 + (a.m ? a.r : 0) + (c.m ? c.r : 0) + support * 0.1;
      if (!best || score > best.score || (score === best.score && text < best.text)) {
        best = { text, motifs: [a.m, core, c.m].filter((m): m is Motif => !!m), resonance: res, relevance: rel, score };
      }
    }
  }
  if (!best) return null;
  const { score: _score, ...result } = best;
  return result;
}
