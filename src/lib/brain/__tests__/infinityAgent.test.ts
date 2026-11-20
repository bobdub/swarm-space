import { beforeEach, describe, expect, it } from 'vitest';
import { ConnectionClock, DROP_GRACE_MS, msToNextTier, tierAtLeast, tierFor } from '../agent/connectionClock';
import { SynapseGraph, SYNAPSE_HALF_LIFE_MS, nodeId, topicsOf } from '../agent/synapseGraph';
import { INITIATIVE_COOLDOWN_MS, isInitiativeLeader, quotesAny, shouldInitiate, type ChatLineLike } from '../agent/initiative';
import { deepMap, reflect } from '../agent/reflection';
import { isLearnable, selfLearnStamp } from '../agent/learnConsent';
import { setShyMode } from '@/lib/p2p/shyMode';

const MIN = 60_000;

describe('connection clock', () => {
  it('climbs through the tiers while connected', () => {
    const c = new ConnectionClock();
    c.observe(1, 0);
    for (let t = MIN; t <= 130 * MIN; t += MIN) c.observe(2, t);
    expect(tierFor(c.connectedFor(5 * MIN))).toBe('base');
    expect(tierFor(12 * MIN)).toBe('converse');
    expect(tierFor(20 * MIN)).toBe('initiate');
    expect(tierFor(45 * MIN)).toBe('reflect');
    expect(tierFor(c.connectedFor(130 * MIN))).toBe('deep');
    expect(tierAtLeast('deep', 'initiate')).toBe(true);
    expect(msToNextTier(12 * MIN)).toEqual({ tier: 'initiate', ms: 3 * MIN });
  });

  it('forgives a short drop and resets after a long one', () => {
    const c = new ConnectionClock();
    for (let t = 0; t <= 21 * MIN; t += MIN) c.observe(1, t);
    c.observe(0, 22 * MIN); // brief drop
    c.observe(1, 21 * MIN + DROP_GRACE_MS - 1000);
    expect(c.connectedFor(23 * MIN)).toBe(23 * MIN);
    c.observe(0, 40 * MIN); // long gap since last connected
    expect(c.connectedFor(40 * MIN)).toBe(0);
    c.observe(1, 41 * MIN);
    expect(c.connectedFor(42 * MIN)).toBe(MIN);
  });
});

describe('learn consent (shy node)', () => {
  beforeEach(() => localStorage.clear());
  it('stamps only when not shy and learns only stamped items', () => {
    expect(selfLearnStamp()).toEqual({ infinityLearn: true });
    setShyMode(true);
    expect(selfLearnStamp()).toEqual({});
    expect(isLearnable({ infinityLearn: true })).toBe(true);
    expect(isLearnable({})).toBe(false);
    expect(isLearnable({ infinityLearn: 'true' })).toBe(false);
  });
});

describe('synapse graph', () => {
  it('links co-occurring topics, peers and coins, and decays them', () => {
    const g = new SynapseGraph();
    g.observe({ topics: ['ocean', 'boat', 'wind'], peer: 'abc', coin: 'c1' }, 0);
    g.observe({ topics: ['ocean', 'boat'] }, 0);
    expect(g.weight(nodeId('topic', 'ocean'), nodeId('topic', 'boat'), 0)).toBe(2);
    expect(g.weight(nodeId('peer', 'abc'), nodeId('topic', 'wind'), 0)).toBe(1);
    expect(g.weight(nodeId('topic', 'ocean'), nodeId('topic', 'boat'), SYNAPSE_HALF_LIFE_MS)).toBeCloseTo(1);
    expect(g.associate(['ocean'], 2, 0)[0].topic).toBe('boat');
    const restored = SynapseGraph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(restored.size).toEqual(g.size);
    g.forget(nodeId('peer', 'abc'));
    expect(g.weight(nodeId('peer', 'abc'), nodeId('topic', 'wind'), 0)).toBe(0);
    expect(g.prune(SYNAPSE_HALF_LIFE_MS * 20)).toBeGreaterThan(0);
    expect(g.size.links).toBe(0);
  });

  it('extracts content topics', () => {
    expect(topicsOf('The boat sails the ocean, the boat rocks')).toContain('boat');
  });
});

describe('initiative', () => {
  const now = 100 * MIN;
  const lines: ChatLineLike[] = [
    { text: 'the tide is coming in', ts: now - 3 * MIN, peerId: 'peer-b' },
    { text: 'boats are all tied up', ts: now - 2 * MIN, peerId: 'peer-c' },
    { text: 'storm later tonight maybe', ts: now - MIN, peerId: 'peer-b' },
  ];
  const base = { now, tierAllows: true, shy: false, chatEnabled: true, selfPeerId: 'peer-a', lines, lastInfinityAt: 0 };

  it('lets exactly the lowest peer id speak into a live conversation', () => {
    expect(shouldInitiate(base)).toBe(true);
    expect(shouldInitiate({ ...base, selfPeerId: 'peer-z' })).toBe(false);
    expect(isInitiativeLeader('peer-a', lines)).toBe(true);
  });

  it('respects tier, shy, chat mode and cooldown', () => {
    expect(shouldInitiate({ ...base, tierAllows: false })).toBe(false);
    expect(shouldInitiate({ ...base, shy: true })).toBe(false);
    expect(shouldInitiate({ ...base, chatEnabled: false })).toBe(false);
    expect(shouldInitiate({ ...base, lastInfinityAt: now - INITIATIVE_COOLDOWN_MS + MIN })).toBe(false);
    expect(shouldInitiate({ ...base, lines: lines.slice(0, 2) })).toBe(false);
  });

  it('detects quoting a person word for word', () => {
    expect(quotesAny('I heard the tide is coming in now', [{ text: 'well the tide is coming in now friends', ts: 0 }])).toBe(true);
    expect(quotesAny('tides follow the moon', lines)).toBe(false);
  });
});

describe('reflection and deep mapping', () => {
  it('strengthens answered topics, weakens ignored ones, re-links coins', () => {
    const g = new SynapseGraph();
    g.reinforce(nodeId('topic', 'stars'), nodeId('topic', 'night'), 1, 0);
    g.reinforce(nodeId('topic', 'rain'), nodeId('topic', 'clouds'), 1, 0);
    const own = [
      { text: 'stars at night', ts: 0, answered: true },
      { text: 'rain from clouds', ts: 0, answered: false },
    ];
    const r = reflect(g, { own, coins: [{ coinId: 'c9', topics: ['stars'], paragraphs: ['Stars hold the night.'] }], recentTopics: ['stars'], now: 10 * MIN });
    expect(r.strengthened).toBeGreaterThan(0);
    expect(r.weakened).toBeGreaterThan(0);
    expect(g.weight(nodeId('topic', 'stars'), nodeId('topic', 'night'), 10 * MIN)).toBeGreaterThan(1.4);
    expect(g.weight(nodeId('topic', 'rain'), nodeId('topic', 'clouds'), 10 * MIN)).toBeLessThan(0.9);
    expect(g.weight(nodeId('coin', 'c9'), nodeId('topic', 'stars'), 10 * MIN)).toBeGreaterThan(0);
    // Already reflected messages are not counted twice.
    expect(reflect(g, { own, coins: [], recentTopics: [], now: 11 * MIN }).strengthened).toBe(0);
  });

  it('closes strong two-step paths', () => {
    const g = new SynapseGraph();
    g.reinforce(nodeId('topic', 'sea'), nodeId('topic', 'salt'), 4, 0);
    g.reinforce(nodeId('topic', 'salt'), nodeId('topic', 'tears'), 4, 0);
    expect(deepMap(g, 0)).toBeGreaterThan(0);
    expect(g.weight(nodeId('topic', 'sea'), nodeId('topic', 'tears'), 0)).toBeGreaterThan(0);
  });
});
