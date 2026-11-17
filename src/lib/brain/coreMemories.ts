/**
 * ═══════════════════════════════════════════════════════════════════════
 * ENGRAVED CORE MEMORIES — Phase 4 of the concentric brain (middle ring)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Instead of treating every learned line alike, Infinity engraves a small
 * set of lines that reached deep significance:
 *
 *   • reinforcement — weight ≥ CORE_MIN_WEIGHT (heard and rewarded often)
 *   • multi-voice resonance — carried by ≥ CORE_MIN_VOICES distinct voices
 *   • stable curvature — when the UQRC field is warmed up, the line's
 *     lattice region is calm (curvature ≤ CORE_MAX_CURVATURE); this is a
 *     stability gate only, never a truth test
 *   • insight, not chatter — a whole learned (non-personality) line with
 *     at least CORE_MIN_TOPICS content words
 *
 * Engravings are immutable once sealed (text, seal hash, sealedAt) and
 * device-local: they are never wallet coins, never move SWARM balances and
 * never enter the mesh digest. Realization treats them as touchstones: when
 * an engraving is eligible for an act, it is preferred over ordinary lines.
 */

import type { LearnedExpression } from './infinityPersonality';
import { contentWords } from '../uqrc/semanticBasins';

export const CORE_MIN_WEIGHT = 3;
export const CORE_MIN_VOICES = 2;
export const CORE_MIN_TOPICS = 3;
export const CORE_MAX_CURVATURE = 0.5;
export const MAX_CORE_MEMORIES = 64;
export const CORE_MEMORY_STORAGE_KEY = 'infinity-core-memories';

export interface CoreMemory {
  text: string;
  /** FNV-1a seal over text + sealedAt; identifies the engraving, proves nothing. */
  seal: string;
  sealedAt: number;
  weight: number;
  voices: number;
}

export interface CurvatureProbe {
  isWarmedUp(): boolean;
  getCurvatureForText(text: string): number;
}

function fnvHex(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Does a learned line qualify for engraving right now? */
export function qualifiesForCore(expression: LearnedExpression, field?: CurvatureProbe | null): boolean {
  if (expression.source !== 'memory') return false;
  if (expression.weight < CORE_MIN_WEIGHT) return false;
  if ((expression.voices?.length ?? 0) < CORE_MIN_VOICES) return false;
  if (new Set(contentWords(expression.text)).size < CORE_MIN_TOPICS) return false;
  if (field) {
    try {
      if (field.isWarmedUp() && field.getCurvatureForText(expression.text) > CORE_MAX_CURVATURE) return false;
    } catch { /* field optional: other gates still hold */ }
  }
  return true;
}

export class CoreMemoryStore {
  private readonly engraved = new Map<string, CoreMemory>();

  get size(): number { return this.engraved.size; }

  list(): CoreMemory[] {
    return [...this.engraved.values()].map(m => ({ ...m }));
  }

  has(text: string): boolean {
    return this.engraved.has(norm(text));
  }

  /** Texts of all engravings, for realization lookups. */
  texts(): Set<string> {
    return new Set([...this.engraved.values()].map(m => m.text));
  }

  /**
   * Seal every qualifying learned line not yet engraved. Existing
   * engravings are never rewritten. Over the cap, the lightest engraving
   * gives way so the ring keeps its deepest memories.
   */
  sealFrom(expressions: LearnedExpression[], field?: CurvatureProbe | null, now = Date.now()): CoreMemory[] {
    const sealed: CoreMemory[] = [];
    const candidates = expressions
      .filter(e => !this.has(e.text) && qualifiesForCore(e, field))
      .sort((a, b) => b.weight - a.weight || (b.voices?.length ?? 0) - (a.voices?.length ?? 0));
    for (const e of candidates) {
      const memory: CoreMemory = {
        text: e.text,
        seal: fnvHex(`${e.text}␟${now}`),
        sealedAt: now,
        weight: e.weight,
        voices: e.voices?.length ?? 0,
      };
      this.engraved.set(norm(e.text), memory);
      sealed.push({ ...memory });
    }
    this.enforceCap();
    return sealed.filter(m => this.has(m.text));
  }

  private enforceCap(): void {
    while (this.engraved.size > MAX_CORE_MEMORIES) {
      let lightest: [string, CoreMemory] | null = null;
      for (const entry of this.engraved) {
        const m = entry[1];
        if (!lightest || m.weight < lightest[1].weight || (m.weight === lightest[1].weight && m.sealedAt < lightest[1].sealedAt)) {
          lightest = entry;
        }
      }
      if (!lightest) break;
      this.engraved.delete(lightest[0]);
    }
  }

  serialize(): CoreMemory[] {
    return this.list();
  }

  restore(saved: unknown): void {
    if (!Array.isArray(saved)) return;
    for (const raw of saved) {
      const m = raw as Partial<CoreMemory> | null;
      if (!m || typeof m.text !== 'string' || typeof m.seal !== 'string') continue;
      if (!Number.isFinite(m.sealedAt) || !Number.isFinite(m.weight) || !Number.isFinite(m.voices)) continue;
      this.engraved.set(norm(m.text), { text: m.text, seal: m.seal, sealedAt: m.sealedAt!, weight: m.weight!, voices: m.voices! });
    }
    this.enforceCap();
  }
}

// ── Attentional routing ─────────────────────────────────────────────

export interface PeerTraffic {
  getAllNeurons(): Array<{ peerId: string }>;
  getPeerScore(peerId: string): number;
}

/**
 * Build a routing function from the neural manifold: a line carried by
 * high-traffic, long-lived, trusted peers scores near 1; unknown voices 0.
 * Scores are normalized against the strongest neuron on this device.
 */
export function routingFromNeurons(engine: PeerTraffic): (voices: string[] | undefined) => number {
  const scores = new Map<string, number>();
  let max = 0;
  try {
    for (const n of engine.getAllNeurons()) {
      const s = Math.max(0, engine.getPeerScore(n.peerId));
      scores.set(n.peerId, s);
      max = Math.max(max, s);
    }
  } catch { /* routing optional */ }
  return (voices) => {
    if (!voices?.length || max <= 0) return 0;
    let best = 0;
    for (const v of voices) best = Math.max(best, (scores.get(v) ?? 0) / max);
    return best;
  };
}

/**
 * Stable reorder of an already-eligible candidate band: engraved memories
 * first, then by synapse routing weight; ties keep their relevance order.
 */
export function routeCandidates<T extends { text: string; voices?: string[] }>(
  candidates: T[],
  core?: Set<string>,
  routing?: (voices: string[] | undefined) => number,
): T[] {
  if (!core?.size && !routing) return candidates;
  return candidates
    .map((c, i) => ({ c, i, core: core?.has(c.text) ? 1 : 0, route: routing?.(c.voices) ?? 0 }))
    .sort((a, b) => b.core - a.core || b.route - a.route || a.i - b.i)
    .map(x => x.c);
}
