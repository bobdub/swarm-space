import { describe, expect, it } from 'vitest';
import { FISHER_REFERENCE, SYNAPSE_MIN_WEIGHT, SynapseGraph, nodeId } from '../agent/synapseGraph';
import { RICCI_BOTTLENECK, buildBypass, ricciCurvature, ricciScan, transportCost } from '../agent/ricci';

const T = (t: string) => nodeId('topic', t);

/** Two 5-cliques joined by one bridge link left0–right0. */
function barbell(): SynapseGraph {
  const g = new SynapseGraph();
  for (const side of ['left', 'right']) {
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) g.reinforce(T(`${side}${i}`), T(`${side}${j}`), 1, 0);
  }
  g.reinforce(T('left0'), T('right0'), 1, 0);
  return g;
}

describe('Fisher-weighted (natural gradient) steps', () => {
  it('is plain Hebbian for fresh nodes and shrinks with information', () => {
    const g = new SynapseGraph();
    expect(g.precondition(T('a'), T('b'), 0)).toBe(1);
    for (let i = 0; i < 50; i++) g.observe({ topics: ['hello', 'there'], natural: true }, 0);
    expect(g.information(T('hello'), 0)).toBe(50);
    expect(g.precondition(T('hello'), T('there'), 0)).toBeCloseTo(1 / Math.sqrt(1 + 50 / FISHER_REFERENCE));
    // 50 repeats teach far less than 50 plain steps would.
    expect(g.weight(T('hello'), T('there'), 0)).toBeLessThan(25);
    expect(g.weight(T('hello'), T('there'), 0)).toBeGreaterThan(5);
  });

  it('protects a rare association from chatter on a shared topic', () => {
    const run = (natural: boolean) => {
      const g = new SynapseGraph();
      g.observe({ topics: ['tide', 'moon'], natural }, 0); // the rare memory
      for (let i = 0; i < 200; i++) {
        g.observe({ topics: ['tide', `chat${i % 15}`], natural }, 0); // chatter on tide
      }
      return g.weight(T('tide'), T('moon'), 0);
    };
    // Plain Hebbian + homeostasis washes the rare link out entirely; natural
    // steps and Fisher-aware scaling keep it above the pruning floor.
    expect(run(false)).toBeLessThan(SYNAPSE_MIN_WEIGHT);
    expect(run(true)).toBeGreaterThan(SYNAPSE_MIN_WEIGHT);
    expect(run(true)).toBeGreaterThan(run(false) * 100);
  });

  it('decays information with the link half-life and persists it', () => {
    const g = new SynapseGraph();
    for (let i = 0; i < 4; i++) g.observe({ topics: ['sun', 'sand'], natural: true }, 0);
    const restored = SynapseGraph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(restored.information(T('sun'), 0)).toBe(4);
    expect(restored.information(T('sun'), 3 * 24 * 60 * 60_000)).toBeCloseTo(2);
    // Plain observation adds no information, and snapshots without it load.
    const plain = new SynapseGraph();
    plain.observe({ topics: ['sun', 'sand'] }, 0);
    expect(plain.information(T('sun'), 0)).toBe(0);
    expect(plain.toJSON().fisher).toBeUndefined();
    // Forgetting a node forgets its information.
    restored.forget(T('sun'));
    expect(restored.information(T('sun'), 0)).toBe(0);
  });
});

describe('Ollivier-Ricci curvature', () => {
  it('computes earth mover cost on a tiny case', () => {
    expect(transportCost([1], [1], [[2]])).toBeCloseTo(2, 3);
    expect(transportCost([0.5, 0.5], [0.5, 0.5], [[1, 3], [3, 1]])).toBeCloseTo(1, 3);
  });

  it('is negative on a bridge and positive inside a cluster', () => {
    const g = barbell();
    const bridge = ricciCurvature(g, T('left0'), T('right0'), 0);
    const inside = ricciCurvature(g, T('left1'), T('left2'), 0);
    expect(bridge).toBeLessThan(RICCI_BOTTLENECK);
    expect(inside).toBeGreaterThan(0);
  });

  it('is symmetric', () => {
    const g = barbell();
    expect(ricciCurvature(g, T('left0'), T('right0'), 0)).toBeCloseTo(ricciCurvature(g, T('right0'), T('left0'), 0), 6);
  });

  it('finds the bottleneck and builds bypasses that ease it', () => {
    const g = barbell();
    const before = ricciCurvature(g, T('left0'), T('right0'), 0);
    const r = ricciScan(g, 0, { edgeBudget: 40 });
    expect(r.bottlenecks.map((b) => [b.a, b.b])).toEqual([[T('left0'), T('right0')]]);
    expect(r.bypasses).toBe(2);
    expect(ricciCurvature(g, T('left0'), T('right0'), 0)).toBeGreaterThan(before);
    // Bypasses are weak and cross between the two sides.
    const cross = g.strongest(100, 0).filter((l) => l.a.includes('left') !== l.b.includes('left'));
    expect(cross).toHaveLength(3);
    for (const l of cross) if (l.a !== T('left0') || l.b !== T('right0')) expect(l.w).toBeLessThan(1);
  });

  it('stays within its link and time budgets', () => {
    const g = barbell();
    expect(ricciScan(g, 0, { edgeBudget: 3 }).scanned).toBe(3);
    let t = 0;
    const slow = ricciScan(g, 0, { timeBudgetMs: 10, clock: () => (t += 4) });
    expect(slow.outOfTime).toBe(true);
    expect(slow.scanned).toBeLessThan(21);
  });

  it('leaves well-knit graphs alone and skips existing links', () => {
    const g = new SynapseGraph();
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) g.reinforce(T(`k${i}`), T(`k${j}`), 1, 0);
    expect(ricciScan(g, 0).bottlenecks).toHaveLength(0);
    expect(buildBypass(g, T('k0'), T('k1'), 0)).toBe(0);
  });
});
