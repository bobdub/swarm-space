/**
 * ═══════════════════════════════════════════════════════════════════════
 * ENGRAVED CORE MEMORIES — Phase 4 of the concentric brain (middle ring)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * An engraving is a crystallized reflection: a complete Echo → Traverse →
 * Crystallize arc (2–3 paragraphs) that Infinity itself composed and that
 * held together without wandering:
 *
 *   • complete — at least CORE_MIN_PARAGRAPHS acts, ending in Crystallize
 *   • coherent — every paragraph boundary kept phase continuity
 *     ΔΦ ≥ CORE_MIN_CONTINUITY (stricter than the arc's halt threshold)
 *   • calm — when the UQRC field is warmed up, the reflection's lattice
 *     region is calm (curvature ≤ CORE_MAX_CURVATURE); a stability gate,
 *     never a truth test
 *
 * Engravings are immutable once sealed (paragraphs, topics, seal, sealedAt)
 * and device-local: they are never wallet coins, never move SWARM balances
 * and never enter the mesh digest. When Infinity later reflects on a
 * related topic, the sentences of its engraved reflections are touchstones:
 * preferred whenever an act can use them, ahead of ordinary lines.
 */

import { contentWords } from '../uqrc/semanticBasins';

export const CORE_MIN_PARAGRAPHS = 3;
export const CORE_MIN_CONTINUITY = 0.3;
export const CORE_MAX_CURVATURE = 0.5;
export const MAX_CORE_MEMORIES = 64;
export const CORE_MEMORY_STORAGE_KEY = 'infinity-core-memories';

export interface CoreMemory {
  /** The crystallized reflection, one entry per paragraph. */
  paragraphs: string[];
  /** Prompt topics the reflection answered. */
  topics: string[];
  /** Weakest phase continuity across its boundaries. */
  continuity: number;
  /** FNV-1a seal over the reflection + sealedAt; identifies it, proves nothing. */
  seal: string;
  sealedAt: number;
}

export interface CurvatureProbe {
  isWarmedUp(): boolean;
  getCurvatureForText(text: string): number;
}

export interface ArcForEngraving {
  paragraphs: string[];
  continuity: number[];
  stop: string;
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
const keyOf = (paragraphs: string[]) => norm(paragraphs.join('\n\n'));
const sentencesOf = (paragraph: string) => paragraph.split(/(?<=[.!?…])\s+/u).map(t => t.trim()).filter(Boolean);

/** Does a composed arc qualify to be engraved? */
export function qualifiesForCore(arc: ArcForEngraving, field?: CurvatureProbe | null): boolean {
  if (arc.stop !== 'complete' || arc.paragraphs.length < CORE_MIN_PARAGRAPHS) return false;
  if (arc.continuity.length < arc.paragraphs.length - 1) return false;
  if (Math.min(...arc.continuity) < CORE_MIN_CONTINUITY) return false;
  if (field) {
    try {
      if (field.isWarmedUp() && field.getCurvatureForText(arc.paragraphs.join(' ')) > CORE_MAX_CURVATURE) return false;
    } catch { /* field optional: the other gates still hold */ }
  }
  return true;
}

export class CoreMemoryStore {
  private readonly engraved = new Map<string, CoreMemory>();

  get size(): number { return this.engraved.size; }

  list(): CoreMemory[] {
    return [...this.engraved.values()].map(m => ({ ...m, paragraphs: [...m.paragraphs], topics: [...m.topics] }));
  }

  has(paragraphs: string[]): boolean {
    return this.engraved.has(keyOf(paragraphs));
  }

  /** Every sentence of every engraved reflection: the touchstones realization prefers. */
  texts(): Set<string> {
    const out = new Set<string>();
    for (const m of this.engraved.values()) for (const p of m.paragraphs) for (const s of sentencesOf(p)) out.add(s);
    return out;
  }

  /** Engraved reflections that answered any of these topics, newest first. */
  recall(topics: string[]): CoreMemory[] {
    const want = new Set(topics.map(t => t.toLowerCase()));
    return this.list().filter(m => m.topics.some(t => want.has(t))).sort((a, b) => b.sealedAt - a.sealedAt);
  }

  /**
   * Seal a crystallized arc if it qualifies and is not already engraved.
   * Existing engravings are never rewritten. Over the cap the oldest gives way.
   */
  engraveArc(arc: ArcForEngraving, prompt: string, field?: CurvatureProbe | null, now = Date.now()): CoreMemory | null {
    if (!qualifiesForCore(arc, field)) return null;
    const key = keyOf(arc.paragraphs);
    if (this.engraved.has(key)) return null;
    const memory: CoreMemory = {
      paragraphs: [...arc.paragraphs],
      topics: [...new Set(contentWords(prompt))],
      continuity: Math.min(...arc.continuity),
      seal: fnvHex(`${arc.paragraphs.join('\n\n')}\u241f${now}`),
      sealedAt: now,
    };
    this.engraved.set(key, memory);
    this.enforceCap();
    return this.engraved.has(key) ? { ...memory, paragraphs: [...memory.paragraphs], topics: [...memory.topics] } : null;
  }

  private enforceCap(): void {
    while (this.engraved.size > MAX_CORE_MEMORIES) {
      let oldest: [string, CoreMemory] | null = null;
      for (const entry of this.engraved) {
        if (!oldest || entry[1].sealedAt < oldest[1].sealedAt) oldest = entry;
      }
      if (!oldest) break;
      this.engraved.delete(oldest[0]);
    }
  }

  serialize(): CoreMemory[] {
    return this.list();
  }

  restore(saved: unknown): void {
    if (!Array.isArray(saved)) return;
    for (const raw of saved) {
      const m = raw as Partial<CoreMemory> | null;
      if (!m || !Array.isArray(m.paragraphs) || !m.paragraphs.length || !m.paragraphs.every(p => typeof p === 'string')) continue;
      if (typeof m.seal !== 'string' || !Number.isFinite(m.sealedAt) || !Number.isFinite(m.continuity)) continue;
      const topics = Array.isArray(m.topics) ? m.topics.filter((t): t is string => typeof t === 'string') : [];
      this.engraved.set(keyOf(m.paragraphs), {
        paragraphs: [...m.paragraphs], topics, continuity: m.continuity!, seal: m.seal, sealedAt: m.sealedAt!,
      });
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
