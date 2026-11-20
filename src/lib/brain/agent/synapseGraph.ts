/**
 * Infinity's synapse graph — device-local paths between what it has learned.
 *
 * Nodes are topics (content words), memory coins (engraved reflections) and
 * peers' knowledge basins (an author hash, never a name or id). A link grows
 * each time two nodes appear together and fades with a half-life, so paths
 * that keep being walked get stronger and forgotten ones fall away.
 *
 * The graph never leaves the device and never enters the mesh digest. It is
 * bounded: weak links are pruned and the least used nodes are evicted.
 */
import { contentWords } from '@/lib/uqrc/semanticBasins';

export type SynapseNodeKind = 'topic' | 'coin' | 'peer';

export interface SynapseLink { a: string; b: string; w: number; at: number }
export interface SynapseSnapshot { v: 1; links: SynapseLink[] }

export const SYNAPSE_HALF_LIFE_MS = 3 * 24 * 60 * 60_000;
export const SYNAPSE_MIN_WEIGHT = 0.05;
export const MAX_SYNAPSE_NODES = 600;
export const MAX_LINKS_PER_NODE = 24;
export const TOPICS_PER_ITEM = 6;
export const SYNAPSE_STORAGE_KEY = 'infinity-synapse-graph';

export const nodeId = (kind: SynapseNodeKind, key: string): string => `${kind}:${key}`;
export const nodeKind = (id: string): SynapseNodeKind => id.slice(0, id.indexOf(':')) as SynapseNodeKind;
export const nodeKey = (id: string): string => id.slice(id.indexOf(':') + 1);

/** The most frequent content words of a text, ties broken by first use. */
export function topicsOf(text: string, max = TOPICS_PER_ITEM): string[] {
  const counts = new Map<string, number>();
  for (const w of contentWords(text)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, max).map(([w]) => w);
}

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
    const key = pairKey(a, b);
    const prev = this.links.get(key);
    const w = (prev ? decayed(prev.w, now - prev.at) : 0) + amount;
    const link = { a: a < b ? a : b, b: a < b ? b : a, w, at: now };
    this.links.set(key, link);
    this.attach(a, b);
    this.attach(b, a);
    this.trimNode(a, now);
    this.trimNode(b, now);
  }

  /** Weaken a link (used when a reflection finds a path no longer holds). */
  weaken(a: string, b: string, factor = 0.5, now = Date.now()): void {
    const key = pairKey(a, b);
    const prev = this.links.get(key);
    if (!prev) return;
    const w = decayed(prev.w, now - prev.at) * factor;
    if (w < SYNAPSE_MIN_WEIGHT) this.drop(key);
    else this.links.set(key, { ...prev, w, at: now });
  }

  weight(a: string, b: string, now = Date.now()): number {
    const l = this.links.get(pairKey(a, b));
    return l ? decayed(l.w, now - l.at) : 0;
  }

  /**
   * Link everything that appeared together in one learned item: topics with
   * each other, and each topic with the author's basin and any coin.
   */
  observe(input: { topics: string[]; peer?: string; coin?: string; amount?: number }, now = Date.now()): void {
    const amount = input.amount ?? 1;
    const topics = [...new Set(input.topics)].slice(0, TOPICS_PER_ITEM).map((t) => nodeId('topic', t));
    for (let i = 0; i < topics.length; i++) {
      for (let j = i + 1; j < topics.length; j++) this.reinforce(topics[i], topics[j], amount, now);
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
   */
  associate(seedTopics: string[], limit = 5, now = Date.now()): Array<{ topic: string; w: number }> {
    const seeds = new Set(seedTopics.map((t) => nodeId('topic', t)));
    const score = new Map<string, number>();
    for (const seed of seeds) {
      for (const n of this.neighbours(seed, MAX_LINKS_PER_NODE, now)) {
        if (seeds.has(n.id) || nodeKind(n.id) !== 'topic') continue;
        score.set(n.id, (score.get(n.id) ?? 0) + n.w);
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
      g.links.set(pairKey(l.a, l.b), { a: l.a, b: l.b, w: l.w, at: l.at });
      g.attach(l.a, l.b);
      g.attach(l.b, l.a);
    }
    return g;
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
