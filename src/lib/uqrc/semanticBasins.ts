/**
 * ═══════════════════════════════════════════════════════════════════════
 * SEMANTIC BASINS — Phase 1 of the concentric brain (word geometry)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Each content word owns a coordinate u_w ∈ ℝ^D. Words that co-occur in
 * the same sentence pull on each other ("contextual gravity"); a gentle
 * Ricci decay keeps the manifold bounded and a single negative sample per
 * pair keeps it from collapsing into one point:
 *
 *   u_a(t+1) = u_a(t) + η·w·(u_b − u_a) − η_r·w·max(0, cos(u_a, u_r))·(u_r − u_a) − ℛ·u_a
 *
 * Repeated co-occurrence therefore carves basins: groups of words whose
 * coordinates have drifted together. Field tension between two words is
 *
 *   T(a, b) = cos(u_a, u_b) · n_ab / (n_ab + 1)     when n_ab ≥ MIN_EVIDENCE
 *
 * where n_ab counts real sentence co-occurrences. Tension is zero without
 * evidence, so geometry alone can never bridge words that were never seen
 * together. Basin-mates (high cosine, no direct evidence) are offered only
 * at a discount and only when both words are themselves well supported.
 *
 * Relational triads (Subject ──Action──▶ Object) are extracted with a small
 * local heuristic (no part-of-speech model). They are signals for later
 * clause assembly, not claims of grammatical understanding.
 *
 * Everything here is device-local: never part of the mesh digest.
 */

import { NU_VISCOSITY, RICCI_DECAY } from './field';

// ── Tunables ────────────────────────────────────────────────────────

export const SEMANTIC_DIM = 8;
const ATTRACTION = NU_VISCOSITY * 2;    // η
const REPULSION = NU_VISCOSITY;         // η_r
const WINDOW = 4;                       // co-occurrence window in content words
const MAX_WORDS_PER_SENTENCE = 24;
export const MAX_SEMANTIC_WORDS = 1200;
export const MAX_SEMANTIC_PAIRS = 5000;
export const MAX_TRIADS = 512;
/** Co-occurrences required before two words may share tension. */
export const MIN_EVIDENCE = 2;
/** Cosine required for basin-mates without direct evidence. */
const BASIN_COSINE = 0.8;
const BASIN_MIN_MASS = 3;
const BASIN_DISCOUNT = 0.5;

export const SEMANTIC_STOP_WORDS = new Set((
  'a an the is are was were be been being to of in on at and or for from with it its this that these those ' +
  'i you he she they them their his her my your me we our us how what why when where who which can could ' +
  'do does did done tell about hello hi hey old friend world explain not no yes so but if then than there ' +
  'here into onto over under just also very too all any some each every more most much many one two ' +
  'has have had will would shall should may might must am let lets like get got make made say said ' +
  'out up down off only even still ever never always again now'
).split(' '));

const AUXILIARIES = new Set(
  'is are was were be been being am has have had do does did will would can could shall should may might must'.split(' '),
);
const SKIP_BEFORE_OBJECT = new Set(
  'a an the to of in on at for from with into onto over under through across toward towards like as its their his her my your our not never always still also just'.split(' '),
);
/** Common verbs that carry no -s/-ed/-ing ending when used after a plural subject. */
const VERB_HINTS = new Set((
  'carry carries hold holds remember remembers settle settles grow grows flow flows hear hears keep keeps ' +
  'find finds give gives bring brings need needs know knows feel feels see sees seek seeks become becomes ' +
  'mine mines share shares learn learns build builds seal seals wait waits pulse pulses leave leaves left ' +
  'echo echoes bind binds open opens close closes connect connects shape shapes'
).split(' '));

// ── Types ───────────────────────────────────────────────────────────

export interface RelationalTriad {
  subject: string;
  action: string;
  object: string;
  weight: number;
}

export interface RelatedWord {
  word: string;
  tension: number;
}

interface WordNode {
  pos: Float32Array;
  mass: number;
}

interface PairStat {
  count: number;
  weight: number;
}

export interface SemanticLatticeSnapshot {
  v: 1;
  words: Array<[string, number, number[]]>;
  pairs: Array<[string, number, number]>;
  triads: Array<[string, string, string, number]>;
}

// ── Helpers ─────────────────────────────────────────────────────────

const WORD_RE = /[\p{L}\p{N}_]+/gu;

export function contentWords(text: string): string[] {
  const all: string[] = text.toLowerCase().match(WORD_RE) ?? [];
  return all.filter(w => w.length > 2 && !SEMANTIC_STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic initial coordinate: the word's hash seeds an xorshift walk. */
function seedPosition(word: string): Float32Array {
  const pos = new Float32Array(SEMANTIC_DIM);
  let s = fnv1a(word) || 1;
  for (let i = 0; i < SEMANTIC_DIM; i++) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    pos[i] = (s / 0xffffffff) * 2 - 1;
  }
  return pos;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

function splitSentences(text: string): string[] {
  return text.split(/[\n.!?;]+/).map(s => s.trim()).filter(Boolean);
}

function looksLikeVerb(word: string): boolean {
  if (VERB_HINTS.has(word)) return true;
  if (word.length < 4) return false;
  if (/(?:ss|us|is|ous|ness)$/.test(word)) return false;
  return /(?:ed|ing|es|s)$/.test(word);
}

/**
 * Heuristic Subject ──Action──▶ Object extraction for one sentence.
 * Subject = first content word; Action = the first later word that follows
 * an auxiliary or looks verb-like; Object = the next content word after it.
 */
export function extractTriad(sentence: string): Omit<RelationalTriad, 'weight'> | null {
  const raw: string[] = sentence.toLowerCase().match(WORD_RE) ?? [];
  const isContent = (w: string) => w.length > 2 && !SEMANTIC_STOP_WORDS.has(w) && !/^\d+$/.test(w);
  const s = raw.findIndex(isContent);
  if (s < 0) return null;
  let a = -1;
  for (let j = s + 1; j < raw.length; j++) {
    const w = raw[j];
    if (AUXILIARIES.has(w)) {
      const next = raw.slice(j + 1).findIndex(x => !AUXILIARIES.has(x) && !SKIP_BEFORE_OBJECT.has(x));
      if (next >= 0 && raw[j + 1 + next].length > 2) { a = j + 1 + next; break; }
      continue;
    }
    if (isContent(w) && looksLikeVerb(w)) { a = j; break; }
  }
  if (a < 0) return null;
  let o = -1;
  for (let j = a + 1; j < raw.length; j++) {
    if (SKIP_BEFORE_OBJECT.has(raw[j])) continue;
    if (isContent(raw[j])) { o = j; break; }
  }
  if (o < 0) return null;
  const triad = { subject: raw[s], action: raw[a], object: raw[o] };
  if (triad.subject === triad.object || triad.action === triad.subject) return null;
  return triad;
}

// ── Lattice ─────────────────────────────────────────────────────────

export class SemanticLattice {
  private readonly words = new Map<string, WordNode>();
  private readonly pairs = new Map<string, PairStat>();
  private readonly triads = new Map<string, RelationalTriad>();
  private ingestCount = 0;

  get size(): number { return this.words.size; }
  get pairCount(): number { return this.pairs.size; }
  get triadCount(): number { return this.triads.size; }

  private node(word: string): WordNode {
    let n = this.words.get(word);
    if (!n) {
      n = { pos: seedPosition(word), mass: 0 };
      this.words.set(word, n);
    }
    return n;
  }

  /** Learn geometry and triads from one piece of text. */
  ingest(text: string, weight = 0.5): void {
    if (!text) return;
    const w = Math.min(1, Math.max(0.05, weight));
    for (const sentence of splitSentences(text)) {
      const seen = new Set<string>();
      const ws = contentWords(sentence).filter(x => !seen.has(x) && (seen.add(x), true)).slice(0, MAX_WORDS_PER_SENTENCE);
      for (const word of ws) this.node(word).mass += w;
      for (let i = 0; i < ws.length; i++) {
        for (let j = i + 1; j < Math.min(ws.length, i + 1 + WINDOW); j++) {
          this.attract(ws[i], ws[j], w);
        }
      }
      const triad = extractTriad(sentence);
      if (triad) {
        const key = `${triad.subject}>${triad.action}>${triad.object}`;
        const prev = this.triads.get(key);
        this.triads.delete(key); // re-insert keeps the map in recency order
        this.triads.set(key, { ...triad, weight: Math.min(10, (prev?.weight ?? 0) + w) });
        // The relation binds subject and object more tightly than mere adjacency.
        if (this.words.has(triad.subject) && this.words.has(triad.object)) this.attract(triad.subject, triad.object, w * 0.5, false);
      }
    }
    this.ingestCount++;
    this.enforceCaps();
  }

  private attract(a: string, b: string, w: number, count = true): void {
    const na = this.node(a);
    const nb = this.node(b);
    if (count) {
      const key = pairKey(a, b);
      const stat = this.pairs.get(key) ?? { count: 0, weight: 0 };
      stat.count += 1;
      stat.weight += w;
      this.pairs.set(key, stat);
    }
    // Negative sample: a deterministic neighbour pushes back only if it is
    // already aligned without evidence, which keeps basins distinct.
    const repel = this.sampleOther(a, b);
    for (let d = 0; d < SEMANTIC_DIM; d++) {
      const delta = nb.pos[d] - na.pos[d];
      na.pos[d] += ATTRACTION * w * delta;
      nb.pos[d] -= ATTRACTION * w * delta;
    }
    if (repel) {
      const nr = this.words.get(repel);
      if (nr && !this.pairs.has(pairKey(a, repel))) {
        const c = cosine(na.pos, nr.pos);
        if (c > 0) {
          for (let d = 0; d < SEMANTIC_DIM; d++) na.pos[d] -= REPULSION * w * c * (nr.pos[d] - na.pos[d]);
        }
      }
    }
    for (let d = 0; d < SEMANTIC_DIM; d++) {
      na.pos[d] *= 1 - RICCI_DECAY;
      nb.pos[d] *= 1 - RICCI_DECAY;
    }
  }

  private sampleOther(a: string, b: string): string | null {
    if (this.words.size < 3) return null;
    const keys = this.words.keys();
    const skip = (fnv1a(a) + this.ingestCount) % this.words.size;
    let i = 0;
    for (const k of keys) {
      if (i++ < skip) continue;
      if (k !== a && k !== b) return k;
    }
    return null;
  }

  private enforceCaps(): void {
    if (this.words.size > MAX_SEMANTIC_WORDS) {
      const drop = [...this.words.entries()].sort((x, y) => x[1].mass - y[1].mass)
        .slice(0, this.words.size - MAX_SEMANTIC_WORDS).map(([k]) => k);
      const dropped = new Set(drop);
      for (const k of drop) this.words.delete(k);
      for (const key of [...this.pairs.keys()]) {
        const [a, b] = key.split('|');
        if (dropped.has(a) || dropped.has(b)) this.pairs.delete(key);
      }
    }
    if (this.pairs.size > MAX_SEMANTIC_PAIRS * 1.1) {
      const keep = [...this.pairs.entries()].sort((x, y) => y[1].weight - x[1].weight).slice(0, MAX_SEMANTIC_PAIRS);
      this.pairs.clear();
      for (const [k, v] of keep) this.pairs.set(k, v);
    }
    while (this.triads.size > MAX_TRIADS) {
      const oldest = this.triads.keys().next().value;
      if (oldest === undefined) break;
      this.triads.delete(oldest);
    }
  }

  // ── Reading the geometry ──────────────────────────────────────────

  /** Number of sentences in which both words appeared within the window. */
  evidence(a: string, b: string): number {
    return this.pairs.get(pairKey(a, b))?.count ?? 0;
  }

  /** Positive field tension, or 0 when unsupported. Symmetric. */
  tension(a: string, b: string): number {
    if (a === b) return this.words.has(a) ? 1 : 0;
    const na = this.words.get(a);
    const nb = this.words.get(b);
    if (!na || !nb) return 0;
    const n = this.evidence(a, b);
    const cos = cosine(na.pos, nb.pos);
    if (n >= MIN_EVIDENCE) return Math.max(0, cos) * (n / (n + 1));
    // Basin-mates: shared geometry without direct evidence, discounted.
    if (cos >= BASIN_COSINE && na.mass >= BASIN_MIN_MASS && nb.mass >= BASIN_MIN_MASS) {
      return cos * BASIN_DISCOUNT * 0.5;
    }
    return 0;
  }

  /** Words that share positive tension with `word`, strongest first. */
  related(word: string, limit = 6, minTension = 0.3): RelatedWord[] {
    const w = word.toLowerCase();
    if (!this.words.has(w)) return [];
    const candidates = new Set<string>();
    for (const key of this.pairs.keys()) {
      const [a, b] = key.split('|');
      if (a === w) candidates.add(b);
      else if (b === w) candidates.add(a);
    }
    const out: RelatedWord[] = [];
    for (const other of candidates) {
      const t = this.tension(w, other);
      if (t >= minTension) out.push({ word: other, tension: t });
    }
    return out.sort((x, y) => y.tension - x.tension || x.word.localeCompare(y.word)).slice(0, limit);
  }

  /**
   * Minimum adjacent tension across the content words of a chain. A chain
   * whose neighbours share no supported tension scores 0 and is rejected by
   * `isCoherentChain` before it can reach the speech buffer.
   */
  chainTension(words: string[]): number {
    const ws = words.map(w => w.toLowerCase()).filter(w => this.words.has(w));
    if (ws.length < 2) return 0;
    let min = Infinity;
    for (let i = 0; i < ws.length - 1; i++) min = Math.min(min, this.tension(ws[i], ws[i + 1]));
    return Number.isFinite(min) ? min : 0;
  }

  isCoherentChain(words: string[], minTension = 0.2): boolean {
    return this.chainTension(words) >= minTension;
  }

  /** Learned triads touching any of the given words, strongest first. */
  triadsFor(words: string[], limit = 8): RelationalTriad[] {
    const set = new Set(words.map(w => w.toLowerCase()));
    return [...this.triads.values()]
      .filter(t => set.has(t.subject) || set.has(t.object))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit)
      .map(t => ({ ...t }));
  }

  /** Words sharing a basin with `word` (geometry + mass), for observability. */
  basinOf(word: string, limit = 8): string[] {
    const n = this.words.get(word.toLowerCase());
    if (!n) return [];
    return [...this.words.entries()]
      .filter(([k, m]) => k !== word && m.mass >= BASIN_MIN_MASS && cosine(n.pos, m.pos) >= BASIN_COSINE)
      .sort((a, b) => cosine(n.pos, b[1].pos) - cosine(n.pos, a[1].pos))
      .slice(0, limit)
      .map(([k]) => k);
  }

  // ── Persistence (device-local) ────────────────────────────────────

  serialize(): SemanticLatticeSnapshot {
    const r = (x: number) => Math.round(x * 1000) / 1000;
    return {
      v: 1,
      words: [...this.words.entries()].map(([k, n]) => [k, r(n.mass), Array.from(n.pos, r)]),
      pairs: [...this.pairs.entries()].map(([k, s]) => [k, s.count, r(s.weight)]),
      triads: [...this.triads.values()].map(t => [t.subject, t.action, t.object, r(t.weight)]),
    };
  }

  restore(snapshot: unknown): void {
    const snap = snapshot as Partial<SemanticLatticeSnapshot> | null;
    if (!snap || snap.v !== 1) return;
    for (const entry of Array.isArray(snap.words) ? snap.words : []) {
      const [word, mass, pos] = entry ?? [];
      if (typeof word !== 'string' || !Number.isFinite(mass) || !Array.isArray(pos) || pos.length !== SEMANTIC_DIM) continue;
      if (!pos.every(Number.isFinite)) continue;
      this.words.set(word, { pos: Float32Array.from(pos), mass });
    }
    for (const entry of Array.isArray(snap.pairs) ? snap.pairs : []) {
      const [key, count, weight] = entry ?? [];
      if (typeof key !== 'string' || !key.includes('|') || !Number.isFinite(count) || !Number.isFinite(weight)) continue;
      this.pairs.set(key, { count, weight });
    }
    for (const entry of Array.isArray(snap.triads) ? snap.triads : []) {
      const [subject, action, object, weight] = entry ?? [];
      if (typeof subject !== 'string' || typeof action !== 'string' || typeof object !== 'string' || !Number.isFinite(weight)) continue;
      this.triads.set(`${subject}>${action}>${object}`, { subject, action, object, weight });
    }
    this.enforceCaps();
  }
}
