/**
 * Infinity's synapse graph — device-local paths between what it has learned.
 *
 * Nodes are topics (content words), memory coins (engraved reflections) and
 * peers' knowledge basins (an author hash, never a name or id). A link grows
 * each time two nodes appear together and fades with a half-life, so paths
 * that keep being walked get stronger and forgotten ones fall away.
 *
 * Two refinements keep the paths meaningful:
 *  - Direction (STDP-style): when topics arrive in order, the link also keeps
 *    a directed strength each way. The earlier topic strengthens its forward
 *    edge and depresses the reverse one, so "rain → flood" can differ from
 *    "flood → rain". The plain association weight stays symmetric.
 *  - Homeostatic scaling: no node may hold more than a fixed total strength.
 *    When a burst pushes a node past it, all of that node's links shrink by
 *    the same factor, keeping their proportions, so a busy topic cannot
 *    saturate and new links still register against it.
 *
 * The graph never leaves the device and never enters the mesh digest. It is
 * bounded: weak links are pruned and the least used nodes are evicted.
 */
import { contentWords } from '@/lib/uqrc/semanticBasins';

export type SynapseNodeKind = 'topic' | 'coin' | 'peer';

/**
 * One link, stored with a < b. `w` is the symmetric association. `ab` and
 * `ba` are the directed strengths a → b and b → a; they are absent on links
 * that were never seen in order (and on snapshots from before direction).
 * All three decay together from `at`.
 */
export interface SynapseLink { a: string; b: string; w: number; at: number; ab?: number; ba?: number }
export interface SynapseSnapshot { v: 1; links: SynapseLink[] }

export const SYNAPSE_HALF_LIFE_MS = 3 * 24 * 60 * 60_000;
export const SYNAPSE_MIN_WEIGHT = 0.05;
export const MAX_SYNAPSE_NODES = 600;
export const MAX_LINKS_PER_NODE = 24;
export const TOPICS_PER_ITEM = 6;
export const SYNAPSE_STORAGE_KEY = 'infinity-synapse-graph';
/** Most total strength one node may hold, per kind (association, directed in). */
export const SYNAPSE_NODE_CAPACITY = 16;
/** Share of a reverse edge removed when the forward edge fires (adjacent topics). */
export const STDP_DEPRESSION = 0.3;

export const nodeId = (kind: SynapseNodeKind, key: string): string => `${kind}:${key}`;
export const nodeKind = (id: string): SynapseNodeKind => id.slice(0, id.indexOf(':')) as SynapseNodeKind;
export const nodeKey = (id: string): string => id.slice(id.indexOf(':') + 1);

/** The most frequent content words of a text, ties broken by first use. */
export function topicsOf(text: string, max = TOPICS_PER_ITEM): string[] {
  const counts = new Map<string, number>();
  for (const w of contentWords(text)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, max).map(([w]) => w);
}

/** The same topics as `topicsOf`, in the order they first appear in the text. */
export function topicSequence(text: string, max = TOPICS_PER_ITEM): string[] {
  const picked = new Set(topicsOf(text, max));
  const out: string[] = [];
  for (const w of contentWords(text)) if (picked.has(w) && !out.includes(w)) out.push(w);
  return out;
}

/** How much a pair `gap` places apart in a sequence counts: 1, ½, ¼ … */
export const stdpWindow = (gap: number): number => Math.pow(0.5, Math.max(0, gap - 1));

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function decayed(w: number, ageMs: number, halfLife = SYNAPSE_HALF_LIFE_MS): number {
  return ageMs <= 0 ? w : w * Math.pow(0.5, ageMs / halfLife);
}

export class SynapseGraph {
  private links = new Map<string, SynapseLink>();
  private adjacency = new Map<string, Set<string>>();

  get size(): { nodes: number; links: number } {
    return { nodes: this.adjacency.size, links: this.links.size };
  }

  /** Strengthen the link between two nodes. */
  reinforce(a: string, b: string, amount = 1, now = Date.now()): void {
    if (!a || !b || a === b) return;
    const link = this.current(a, b, now);
    link.w += amount;
    this.store(link, now);
  }

  /**
   * Spike-timing style update: `pre` was seen before `post`. The association
   * grows as in `reinforce`, the forward edge pre → post is potentiated and
   * the reverse edge post → pre is depressed. `timing` (0..1) scales both, so
   * pairs further apart in a sequence teach less.
   */
  reinforceDirected(pre: string, post: string, amount = 1, now = Date.now(), timing = 1): void {
    if (!pre || !post || pre === post) return;
    const t = Math.min(1, Math.max(0, timing));
    const link = this.current(pre, post, now);
    link.w += amount * t;
    const forward = pre < post ? 'ab' : 'ba';
    const reverse = forward === 'ab' ? 'ba' : 'ab';
    link[forward] = (link[forward] ?? 0) + amount * t;
    if (link[reverse]) link[reverse] = link[reverse]! * (1 - STDP_DEPRESSION * t);
    this.store(link, now);
  }

  /** Weaken a link (used when a reflection finds a path no longer holds). */
  weaken(a: string, b: string, factor = 0.5, now = Date.now()): void {
    const key = pairKey(a, b);
    if (!this.links.has(key)) return;
    const link = this.current(a, b, now);
    link.w *= factor;
    if (link.ab) link.ab *= factor;
    if (link.ba) link.ba *= factor;
    if (link.w < SYNAPSE_MIN_WEIGHT) this.drop(key);
    else this.links.set(key, tidy(link));
  }

  weight(a: string, b: string, now = Date.now()): number {
    const l = this.links.get(pairKey(a, b));
    return l ? decayed(l.w, now - l.at) : 0;
  }

  /** Directed strength from → to (0 when the pair was never seen in order). */
  directedWeight(from: string, to: string, now = Date.now()): number {
    const l = this.links.get(pairKey(from, to));
    if (!l) return 0;
    const d = from < to ? l.ab : l.ba;
    return d ? decayed(d, now - l.at) : 0;
  }

  /** Total association strength a node holds (what homeostasis bounds). */
  nodeStrength(id: string, now = Date.now()): number {
    let sum = 0;
    for (const other of this.adjacency.get(id) ?? []) sum += this.weight(id, other, now);
    return sum;
  }

  /** What tends to follow a node: directed out-edges, strongest first. */
  successors(id: string, limit = 8, now = Date.now()): Array<{ id: string; w: number }> {
    const out: Array<{ id: string; w: number }> = [];
    for (const other of this.adjacency.get(id) ?? []) {
      const w = this.directedWeight(id, other, now);
      if (w > 0) out.push({ id: other, w });
    }
    return out.sort((x, y) => y.w - x.w).slice(0, limit);
  }

  /**
   * Link everything that appeared together in one learned item: topics with
   * each other, and each topic with the author's basin and any coin.
   */
  observe(input: { topics: string[]; peer?: string; coin?: string; amount?: number; ordered?: boolean }, now = Date.now()): void {
    const amount = input.amount ?? 1;
    const topics = [...new Set(input.topics)].slice(0, TOPICS_PER_ITEM).map((t) => nodeId('topic', t));
    for (let i = 0; i < topics.length; i++) {
      for (let j = i + 1; j < topics.length; j++) {
        // Ordered topics (first-appearance order) also teach direction. The
        // association still counts in full so ordered and unordered agree.
        if (input.ordered) {
          const t = stdpWindow(j - i);
          if (t < 1) this.reinforce(topics[i], topics[j], amount * (1 - t), now);
          this.reinforceDirected(topics[i], topics[j], amount, now, t);
        } else this.reinforce(topics[i], topics[j], amount, now);
      }
    }
    const anchors = [input.peer && nodeId('peer', input.peer), input.coin && nodeId('coin', input.coin)].filter(Boolean) as string[];
    for (const anchor of anchors) for (const t of topics) this.reinforce(anchor, t, amount, now);
    this.evictNodes(now);
  }

  /** Neighbours of a node, strongest first. */
  neighbours(id: string, limit = 8, now = Date.now()): Array<{ id: string; w: number }> {
    const out: Array<{ id: string; w: number }> = [];
    for (const other of this.adjacency.get(id) ?? []) out.push({ id: other, w: this.weight(id, other, now) });
    return out.sort((x, y) => y.w - x.w).slice(0, limit);
  }

  /**
   * Topics most strongly reached from a set of seed topics (spreading one
   * hop). Seeds themselves are excluded. Used to pick what to talk about.
   * What tends to follow a seed (its forward edges) counts on top of plain
   * association, so the pick leans toward where a thought goes next.
   */
  associate(seedTopics: string[], limit = 5, now = Date.now()): Array<{ topic: string; w: number }> {
    const seeds = new Set(seedTopics.map((t) => nodeId('topic', t)));
    const score = new Map<string, number>();
    for (const seed of seeds) {
      for (const n of this.neighbours(seed, MAX_LINKS_PER_NODE, now)) {
        if (seeds.has(n.id) || nodeKind(n.id) !== 'topic') continue;
        score.set(n.id, (score.get(n.id) ?? 0) + n.w + this.directedWeight(seed, n.id, now));
      }
    }
    return [...score.entries()].sort((x, y) => y[1] - x[1]).slice(0, limit).map(([id, w]) => ({ topic: nodeKey(id), w }));
  }

  /** Strongest links overall, for the brain map. */
  strongest(limit = 10, now = Date.now()): SynapseLink[] {
    return [...this.links.values()]
      .map((l) => ({ ...l, w: decayed(l.w, now - l.at) }))
      .sort((x, y) => y.w - x.w)
      .slice(0, limit);
  }

  /** Drop every link that decayed below the floor. Returns how many went. */
  prune(now = Date.now()): number {
    let removed = 0;
    for (const [key, l] of [...this.links]) {
      if (decayed(l.w, now - l.at) < SYNAPSE_MIN_WEIGHT) { this.drop(key); removed++; }
    }
    return removed;
  }

  /** Forget a node and all its links (e.g. a peer's basin). */
  forget(id: string): void {
    for (const other of [...(this.adjacency.get(id) ?? [])]) this.drop(pairKey(id, other));
    this.adjacency.delete(id);
  }

  toJSON(): SynapseSnapshot {
    return { v: 1, links: [...this.links.values()] };
  }

  static fromJSON(raw: unknown): SynapseGraph {
    const g = new SynapseGraph();
    const links = (raw as SynapseSnapshot | null)?.links;
    if (!Array.isArray(links)) return g;
    for (const l of links) {
      if (!l || typeof l.a !== 'string' || typeof l.b !== 'string' || !Number.isFinite(l.w) || !Number.isFinite(l.at)) continue;
      // Older snapshots have no direction; stored order may not be sorted.
      const sorted = l.a < l.b;
      const ab = finitePositive(sorted ? l.ab : l.ba);
      const ba = finitePositive(sorted ? l.ba : l.ab);
      g.links.set(pairKey(l.a, l.b), tidy({ a: sorted ? l.a : l.b, b: sorted ? l.b : l.a, w: l.w, at: l.at, ab, ba }));
      g.attach(l.a, l.b);
      g.attach(l.b, l.a);
    }
    return g;
  }

  /** A fresh copy of the a–b link decayed to `now` (zero if absent). */
  private current(a: string, b: string, now: number): SynapseLink {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const prev = this.links.get(pairKey(a, b));
    if (!prev) return { a: lo, b: hi, w: 0, at: now };
    const age = now - prev.at;
    return {
      a: lo, b: hi, w: decayed(prev.w, age), at: now,
      ab: prev.ab ? decayed(prev.ab, age) : undefined,
      ba: prev.ba ? decayed(prev.ba, age) : undefined,
    };
  }

  /** Write a link, wire both ends, then keep both ends bounded. */
  private store(link: SynapseLink, now: number): void {
    this.links.set(pairKey(link.a, link.b), tidy(link));
    this.attach(link.a, link.b);
    this.attach(link.b, link.a);
    for (const id of [link.a, link.b]) {
      this.scaleNode(id, now);
      this.trimNode(id, now);
    }
  }

  /**
   * Homeostatic synaptic scaling. If a node's total association, or its total
   * directed input, is over capacity, every one of its links (or incoming
   * edges) is multiplied by the same factor, so relative strengths survive.
   * Only scales down: quiet nodes are left to decay as before.
   */
  private scaleNode(id: string, now: number): void {
    const others = [...(this.adjacency.get(id) ?? [])];
    let total = 0;
    let input = 0;
    for (const o of others) {
      total += this.weight(id, o, now);
      input += this.directedWeight(o, id, now);
    }
    const kw = total > SYNAPSE_NODE_CAPACITY ? SYNAPSE_NODE_CAPACITY / total : 1;
    const kin = input > SYNAPSE_NODE_CAPACITY ? SYNAPSE_NODE_CAPACITY / input : 1;
    if (kw === 1 && kin === 1) return;
    for (const o of others) {
      const link = this.current(id, o, now);
      link.w *= kw;
      const into = id === link.b ? 'ab' : 'ba';
      if (link[into]) link[into] = link[into]! * kin;
      this.links.set(pairKey(id, o), tidy(link));
    }
  }

  private attach(a: string, b: string): void {
    let set = this.adjacency.get(a);
    if (!set) { set = new Set(); this.adjacency.set(a, set); }
    set.add(b);
  }

  private drop(key: string): void {
    const l = this.links.get(key);
    if (!l) return;
    this.links.delete(key);
    for (const [x, y] of [[l.a, l.b], [l.b, l.a]]) {
      const set = this.adjacency.get(x);
      set?.delete(y);
      if (set && set.size === 0) this.adjacency.delete(x);
    }
  }

  private trimNode(id: string, now: number): void {
    const set = this.adjacency.get(id);
    if (!set || set.size <= MAX_LINKS_PER_NODE) return;
    const weakest = this.neighbours(id, set.size, now).slice(MAX_LINKS_PER_NODE);
    for (const n of weakest) this.drop(pairKey(id, n.id));
  }

  private evictNodes(now: number): void {
    if (this.adjacency.size <= MAX_SYNAPSE_NODES) return;
    const strength = [...this.adjacency.keys()].map((id) => ({
      id,
      s: [...(this.adjacency.get(id) ?? [])].reduce((sum, o) => sum + this.weight(id, o, now), 0),
    }));
    strength.sort((x, y) => x.s - y.s);
    for (const { id } of strength.slice(0, this.adjacency.size - MAX_SYNAPSE_NODES)) this.forget(id);
  }
}

const finitePositive = (x: unknown): number | undefined =>
  typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : undefined;

/** Drop empty direction fields so plain links serialize exactly as before. */
function tidy(l: SynapseLink): SynapseLink {
  const out: SynapseLink = { a: l.a, b: l.b, w: l.w, at: l.at };
  if (l.ab && l.ab > 0) out.ab = l.ab;
  if (l.ba && l.ba > 0) out.ba = l.ba;
  return out;
}

// ── Device-local singleton ──────────────────────────────────────────

let shared: SynapseGraph | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function getSynapseGraph(): SynapseGraph {
  if (shared) return shared;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SYNAPSE_STORAGE_KEY) : null;
    shared = raw ? SynapseGraph.fromJSON(JSON.parse(raw)) : new SynapseGraph();
  } catch {
    shared = new SynapseGraph();
  }
  return shared;
}

/** Persist soon (coalesced) so bursts of learning write once. */
export function saveSynapseGraph(): void {
  if (saveTimer || typeof localStorage === 'undefined') return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { localStorage.setItem(SYNAPSE_STORAGE_KEY, JSON.stringify(getSynapseGraph().toJSON())); } catch { /* quota: keep in memory */ }
  }, 3000);
}

/** Test hook. */
export function resetSynapseGraphForTests(): void {
  shared = new SynapseGraph();
}
