/**
 * Ollivier-Ricci curvature on the synapse graph, and bypass building.
 *
 * For a link x–y, put a lazy random walk on each end: stay put with
 * probability α, otherwise step to a neighbour in proportion to link weight.
 * The curvature is κ(x, y) = 1 − W₁(μx, μy) / d(x, y), where W₁ is the cost
 * of moving one walk's mass onto the other's along hop distances.
 *
 *  - κ > 0: the two ends share neighbourhoods (a well-knit cluster).
 *  - κ < 0: the link is a narrow bridge between regions that otherwise do not
 *    touch, an informational bottleneck.
 *
 * When a strong topic link is a bottleneck, Infinity adds a weak bypass
 * between the best topic neighbours on either side, so the two regions are
 * joined by more than one path before that bridge is overloaded or decays.
 * Everything is local and bounded: the scan visits a fixed number of links
 * and stops early once its time budget is spent. Nothing is posted or sent.
 */
import { MAX_LINKS_PER_NODE, SynapseGraph, nodeKind } from './synapseGraph';

/** Probability the lazy walk stays at its node. */
export const RICCI_IDLENESS = 0.5;
/** Curvature at or below which a link counts as a bottleneck. */
export const RICCI_BOTTLENECK = -0.25;
/** Strongest topic links considered per scan. */
export const RICCI_EDGE_BUDGET = 40;
/** Wall-clock budget for one scan, in milliseconds. */
export const RICCI_TIME_BUDGET_MS = 50;
/** Bypass strength as a share of the weaker of the two links it rides on. */
export const BYPASS_FACTOR = 0.2;
/** Most bypasses added per bottleneck. */
export const BYPASSES_PER_BOTTLENECK = 2;

const SINKHORN_EPSILON = 0.05;
const SINKHORN_ITERATIONS = 120;

type Neighbourhoods = Map<string, Map<string, number>>;

function neighbourhood(graph: SynapseGraph, id: string, now: number, cache: Neighbourhoods): Map<string, number> {
  let n = cache.get(id);
  if (!n) {
    n = new Map(graph.neighbours(id, MAX_LINKS_PER_NODE, now).filter((x) => x.w > 0).map((x) => [x.id, x.w]));
    cache.set(id, n);
  }
  return n;
}

/** Lazy random-walk distribution around a node. */
function walk(id: string, around: Map<string, number>, alpha: number): Map<string, number> {
  const mu = new Map<string, number>([[id, alpha]]);
  let total = 0;
  for (const w of around.values()) total += w;
  if (total <= 0) { mu.set(id, 1); return mu; }
  for (const [other, w] of around) mu.set(other, (mu.get(other) ?? 0) + (1 - alpha) * (w / total));
  return mu;
}

/** Hop distance, exact up to 2 and capped at 3 (always reachable via x–y). */
function hops(graph: SynapseGraph, u: string, v: string, now: number, cache: Neighbourhoods): number {
  if (u === v) return 0;
  const nu = neighbourhood(graph, u, now, cache);
  if (nu.has(v)) return 1;
  const nv = neighbourhood(graph, v, now, cache);
  const [small, large] = nu.size <= nv.size ? [nu, nv] : [nv, nu];
  for (const k of small.keys()) if (large.has(k)) return 2;
  return 3;
}

/**
 * Earth mover's distance between two small distributions, by entropic
 * (Sinkhorn) transport with a small regulariser. Accurate to a few hundredths
 * on these integer hop costs, which is plenty for telling bridges apart.
 */
export function transportCost(p: number[], q: number[], cost: number[][]): number {
  const n = p.length;
  const m = q.length;
  const K = cost.map((row) => row.map((c) => Math.exp(-c / SINKHORN_EPSILON)));
  const u = new Array<number>(n).fill(1);
  const v = new Array<number>(m).fill(1);
  for (let it = 0; it < SINKHORN_ITERATIONS; it++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < m; j++) s += K[i][j] * v[j];
      u[i] = s > 0 ? p[i] / s : 0;
    }
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += K[i][j] * u[i];
      v[j] = s > 0 ? q[j] / s : 0;
    }
  }
  let total = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) total += u[i] * K[i][j] * v[j] * cost[i][j];
  return total;
}

/** Ollivier-Ricci curvature of the x–y link (1 − W₁ for adjacent nodes). */
export function ricciCurvature(
  graph: SynapseGraph, x: string, y: string, now = Date.now(), alpha = RICCI_IDLENESS, cache: Neighbourhoods = new Map(),
): number {
  const mx = walk(x, neighbourhood(graph, x, now, cache), alpha);
  const my = walk(y, neighbourhood(graph, y, now, cache), alpha);
  // Mass already in place costs nothing; transport only the difference.
  const keys = new Set([...mx.keys(), ...my.keys()]);
  const from: Array<[string, number]> = [];
  const to: Array<[string, number]> = [];
  for (const k of keys) {
    const d = (mx.get(k) ?? 0) - (my.get(k) ?? 0);
    if (d > 1e-12) from.push([k, d]);
    else if (d < -1e-12) to.push([k, -d]);
  }
  if (!from.length) return 1;
  const cost = from.map(([a]) => to.map(([b]) => hops(graph, a, b, now, cache)));
  const w1 = transportCost(from.map(([, m]) => m), to.map(([, m]) => m), cost);
  return 1 - w1;
}

export interface Bottleneck { a: string; b: string; kappa: number }
export interface RicciScanResult { scanned: number; bottlenecks: Bottleneck[]; bypasses: number; outOfTime: boolean }

/**
 * Scan the strongest topic links for bottlenecks and build bypasses around
 * them. Bounded by `edgeBudget` links and `timeBudgetMs` of wall clock.
 */
export function ricciScan(
  graph: SynapseGraph,
  now = Date.now(),
  opts: { edgeBudget?: number; timeBudgetMs?: number; clock?: () => number } = {},
): RicciScanResult {
  const clock = opts.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const deadline = clock() + (opts.timeBudgetMs ?? RICCI_TIME_BUDGET_MS);
  const budget = opts.edgeBudget ?? RICCI_EDGE_BUDGET;
  const cache: Neighbourhoods = new Map();
  const result: RicciScanResult = { scanned: 0, bottlenecks: [], bypasses: 0, outOfTime: false };
  // Measure first, then build, so new bypasses do not skew this scan.
  const candidates = graph.strongest(budget * 2, now)
    .filter((l) => nodeKind(l.a) === 'topic' && nodeKind(l.b) === 'topic')
    .slice(0, budget);
  for (const l of candidates) {
    if (clock() > deadline) { result.outOfTime = true; break; }
    const kappa = ricciCurvature(graph, l.a, l.b, now, RICCI_IDLENESS, cache);
    result.scanned++;
    if (kappa <= RICCI_BOTTLENECK) result.bottlenecks.push({ a: l.a, b: l.b, kappa });
  }
  for (const { a, b } of result.bottlenecks) result.bypasses += buildBypass(graph, a, b, now);
  return result;
}

/**
 * Join the strongest topic neighbours on each side of a bottleneck a–b with
 * a weak link, so the two regions gain a second path. Returns links added.
 */
export function buildBypass(graph: SynapseGraph, a: string, b: string, now = Date.now()): number {
  const side = (hub: string, other: string) => graph.neighbours(hub, MAX_LINKS_PER_NODE, now)
    .filter((n) => n.id !== other && nodeKind(n.id) === 'topic');
  const left = side(a, b);
  const right = side(b, a);
  const bridge = graph.weight(a, b, now);
  // Strongest pairs first, preferring distinct endpoints (l0–r0, then l1–r0
  // and l0–r1, …) so the bypasses spread out instead of fanning from one node.
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < left.length; i++) for (let j = 0; j < right.length; j++) pairs.push([i, j]);
  pairs.sort((x, y) => x[0] + x[1] - (y[0] + y[1]) || x[0] - y[0]);
  let added = 0;
  for (const [i, j] of pairs) {
    if (added >= BYPASSES_PER_BOTTLENECK) break;
    const l = left[i];
    const r = right[j];
    if (l.id === r.id || graph.weight(l.id, r.id, now) > 0) continue;
    graph.reinforce(l.id, r.id, Math.min(l.w, r.w, bridge) * BYPASS_FACTOR, now);
    added++;
  }
  return added;
}
