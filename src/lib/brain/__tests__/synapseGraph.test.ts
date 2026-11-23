import { describe, expect, it } from 'vitest';
import {
  STDP_DEPRESSION,
  SYNAPSE_HALF_LIFE_MS,
  SYNAPSE_NODE_CAPACITY,
  SynapseGraph,
  nodeId,
  stdpWindow,
  topicSequence,
  topicsOf,
} from '../agent/synapseGraph';

const T = (t: string) => nodeId('topic', t);

describe('directional (STDP-style) links', () => {
  it('potentiates the forward edge and depresses the reverse', () => {
    const g = new SynapseGraph();
    g.reinforceDirected(T('flood'), T('rain'), 2, 0); // flood seen before rain once
    g.reinforceDirected(T('rain'), T('flood'), 1, 0);
    expect(g.directedWeight(T('rain'), T('flood'), 0)).toBe(1);
    expect(g.directedWeight(T('flood'), T('rain'), 0)).toBeCloseTo(2 * (1 - STDP_DEPRESSION));
    // The association stays symmetric and counts every co-occurrence.
    expect(g.weight(T('rain'), T('flood'), 0)).toBe(3);
    expect(g.weight(T('flood'), T('rain'), 0)).toBe(3);
  });

  it('learns order from ordered observations, weighted by distance', () => {
    const g = new SynapseGraph();
    for (let i = 0; i < 3; i++) g.observe({ topics: ['clouds', 'rain', 'flood'], ordered: true }, 0);
    expect(g.directedWeight(T('clouds'), T('rain'), 0)).toBeGreaterThan(g.directedWeight(T('rain'), T('clouds'), 0));
    expect(g.directedWeight(T('rain'), T('clouds'), 0)).toBe(0);
    // Two steps apart teaches half as much as adjacent.
    expect(g.directedWeight(T('clouds'), T('flood'), 0)).toBeCloseTo(g.directedWeight(T('clouds'), T('rain'), 0) * stdpWindow(2));
    // Ordered and unordered observation give the same association.
    const u = new SynapseGraph();
    for (let i = 0; i < 3; i++) u.observe({ topics: ['clouds', 'rain', 'flood'] }, 0);
    expect(g.weight(T('clouds'), T('flood'), 0)).toBeCloseTo(u.weight(T('clouds'), T('flood'), 0));
    expect(u.directedWeight(T('clouds'), T('rain'), 0)).toBe(0);
    expect(g.successors(T('clouds'), 2, 0).map((s) => s.id)).toEqual([T('rain'), T('flood')]);
  });

  it('leans associations toward what follows a seed', () => {
    const g = new SynapseGraph();
    g.reinforce(T('storm'), T('calm'), 1, 0);
    g.reinforce(T('storm'), T('thunder'), 1, 0);
    g.reinforceDirected(T('storm'), T('thunder'), 0.5, 0);
    g.reinforceDirected(T('calm'), T('storm'), 0.5, 0);
    expect(g.associate(['storm'], 2, 0).map((a) => a.topic)).toEqual(['thunder', 'calm']);
  });

  it('decays direction with the same half-life and weakens it too', () => {
    const g = new SynapseGraph();
    g.reinforceDirected(T('a'), T('b'), 2, 0);
    expect(g.directedWeight(T('a'), T('b'), SYNAPSE_HALF_LIFE_MS)).toBeCloseTo(1);
    g.weaken(T('a'), T('b'), 0.5, SYNAPSE_HALF_LIFE_MS);
    expect(g.directedWeight(T('a'), T('b'), SYNAPSE_HALF_LIFE_MS)).toBeCloseTo(0.5);
  });

  it('orders topics by first appearance', () => {
    const text = 'Rain fell, then the flood came. Flood after flood after rain.';
    expect(new Set(topicSequence(text))).toEqual(new Set(topicsOf(text)));
    expect(topicSequence(text).indexOf('rain')).toBeLessThan(topicSequence(text).indexOf('flood'));
  });
});

describe('homeostatic synaptic scaling', () => {
  it('caps a bursting node while keeping relative weights', () => {
    const g = new SynapseGraph();
    g.reinforce(T('ocean'), T('boat'), 3, 0);
    g.reinforce(T('ocean'), T('wind'), 1, 0);
    // A burst: "ocean" suddenly co-occurs with "storm" over and over.
    for (let i = 0; i < 100; i++) g.reinforce(T('ocean'), T('storm'), 1, 0);
    expect(g.nodeStrength(T('ocean'), 0)).toBeLessThanOrEqual(SYNAPSE_NODE_CAPACITY + 1e-9);
    expect(g.weight(T('ocean'), T('storm'), 0)).toBeLessThan(SYNAPSE_NODE_CAPACITY);
    // The older paths shrank by the same factor, so their ratio holds.
    expect(g.weight(T('ocean'), T('boat'), 0) / g.weight(T('ocean'), T('wind'), 0)).toBeCloseTo(3, 9);
  });

  it('keeps new links visible next to a saturated hub', () => {
    const g = new SynapseGraph();
    for (let i = 0; i < 200; i++) g.reinforce(T('ocean'), T('boat'), 1, 0);
    g.reinforce(T('ocean'), T('kelp'), 1, 0);
    // Without scaling kelp would be 1 against 200; now it is a real share.
    expect(g.weight(T('ocean'), T('kelp'), 0) / g.weight(T('ocean'), T('boat'), 0)).toBeGreaterThan(1 / 20);
  });

  it('bounds total directed input to a node', () => {
    const g = new SynapseGraph();
    g.reinforceDirected(T('spark'), T('fire'), 2, 0);
    g.reinforceDirected(T('wood'), T('fire'), 1, 0);
    for (let i = 0; i < 100; i++) g.reinforceDirected(T('wind'), T('fire'), 1, 0);
    const into = ['spark', 'wood', 'wind'].reduce((s, t) => s + g.directedWeight(T(t), T('fire'), 0), 0);
    expect(into).toBeLessThanOrEqual(SYNAPSE_NODE_CAPACITY + 1e-9);
    expect(g.directedWeight(T('spark'), T('fire'), 0) / g.directedWeight(T('wood'), T('fire'), 0)).toBeCloseTo(2, 9);
  });

  it('leaves quiet nodes alone', () => {
    const g = new SynapseGraph();
    g.reinforce(T('moss'), T('stone'), 2, 0);
    expect(g.weight(T('moss'), T('stone'), 0)).toBe(2);
  });
});

describe('review fixes', () => {
  it('does not age newer links when backfilling an older memory', () => {
    const g = new SynapseGraph();
    g.reinforce(T('hub'), T('fresh'), 16, SYNAPSE_HALF_LIFE_MS);
    g.reinforce(T('hub'), T('old'), 1, 0); // backfill pushes hub over capacity
    const fresh = g.weight(T('hub'), T('fresh'), SYNAPSE_HALF_LIFE_MS);
    expect(fresh).toBeCloseTo(16 * (16 / 17), 6);
  });

  it('keeps nonadjacent ordered pairs on a full node like unordered ones', () => {
    const build = () => {
      const g = new SynapseGraph();
      for (let i = 0; i < 24; i++) g.reinforce(T('a'), T(`n${i}`), 0.6, 0);
      return g;
    };
    const u = build();
    u.observe({ topics: ['a', 'middle', 'z'] }, 0);
    const o = build();
    o.observe({ topics: ['a', 'middle', 'z'], ordered: true }, 0);
    expect(u.weight(T('a'), T('z'), 0)).toBe(1);
    expect(o.weight(T('a'), T('z'), 0)).toBe(1);
    expect(o.directedWeight(T('a'), T('z'), 0)).toBeCloseTo(0.5);
  });
});

describe('persistence', () => {
  it('round-trips direction and loads snapshots from before it', () => {
    const g = new SynapseGraph();
    g.reinforceDirected(T('seed'), T('tree'), 1, 0);
    const restored = SynapseGraph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(restored.directedWeight(T('seed'), T('tree'), 0)).toBe(1);
    expect(restored.directedWeight(T('tree'), T('seed'), 0)).toBe(0);

    const legacy = { v: 1, links: [{ a: T('sea'), b: T('salt'), w: 2, at: 0 }] };
    const old = SynapseGraph.fromJSON(legacy);
    expect(old.weight(T('salt'), T('sea'), 0)).toBe(2);
    expect(old.directedWeight(T('salt'), T('sea'), 0)).toBe(0);
    expect(old.toJSON().links[0]).toEqual({ a: T('salt'), b: T('sea'), w: 2, at: 0 });

    const junk = { v: 1, links: [{ a: T('x'), b: T('y'), w: 1, at: 0, ab: 'NaN', ba: -3 }] };
    expect(SynapseGraph.fromJSON(junk).toJSON().links[0]).toEqual({ a: T('x'), b: T('y'), w: 1, at: 0 });
  });
});
