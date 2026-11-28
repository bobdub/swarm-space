import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetSynapseExchangerForTests,
  buildManifoldRecord,
  getNetworkSynapsePrior,
  getNetworkSynapseView,
  getSynapseManifold,
  parseManifoldRecord,
  publishSynapseRecord,
  startSynapseExchanger,
  stopSynapseExchanger,
  SYNAPSE_MANIFOLD_CHANNEL,
  SYNAPSE_MAX_BYTES,
  SYNAPSE_MAX_EDGES,
  SYNAPSE_NETWORK_DAMPING,
  SYNAPSE_STALE_MS,
  SynapseManifold,
  synapseSlot,
  type SynapseEdge,
  type SynapseExchangerDeps,
} from '../synapseExchanger';
import { computeSmoothness } from '../globalCell';
import { _resetSynapseForTests, recordHandshake } from '../synapseLayer';

const NOW = 1_800_000_000_000;
const edge = (to: string, smoothness: number, latencyMs: number | null = 40, weight = 1): SynapseEdge =>
  ({ to, smoothness, latencyMs, weight });
const record = (peerId: string, edges: SynapseEdge[], at = NOW - 1_000): string =>
  buildManifoldRecord({ peerId, at, conns: edges.length, phi: 0.8, edges })!;

describe('synapse manifold records', () => {
  it('round-trips a record written by its own node', () => {
    const raw = record('peer-a', [edge('peer-b', 0.94, 38, 4.82)]);
    const node = parseManifoldRecord(raw, 'peer-a', NOW);
    expect(node).toMatchObject({ peerId: 'peer-a', conns: 1, phi: 0.8 });
    expect(node?.edges).toEqual([{ to: 'peer-b', smoothness: 0.94, latencyMs: 38, weight: 4.82 }]);
  });

  it('carries topology numbers only', () => {
    const raw = record('peer-a', [edge('peer-b', 0.5)]);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['at', 'conns', 'e', 'peerId', 'phi', 'v']);
  });

  it('refuses records spoken for another node, stale, future or malformed', () => {
    const raw = record('peer-a', [edge('peer-b', 0.5)]);
    expect(parseManifoldRecord(raw, 'peer-mallory', NOW)).toBeNull();
    expect(parseManifoldRecord(record('peer-a', [], NOW - SYNAPSE_STALE_MS - 1), 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord(record('peer-a', [], NOW + SYNAPSE_STALE_MS + 1), 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord('not json', 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord({ v: 1 }, 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord('x'.repeat(SYNAPSE_MAX_BYTES + 1), 'peer-a', NOW)).toBeNull();
  });

  it('clamps numbers and drops self, duplicate and malformed edges', () => {
    const raw = JSON.stringify({
      v: 1, peerId: 'peer-a', at: NOW, conns: 3, phi: 7,
      e: [['peer-a', 1, 1, 1], ['peer-b', 9, -5, -2], ['peer-b', 0.1, 1, 1], ['javascript:x', 1, 1, 1], ['peer-c', 'x', 1, 1]],
    });
    const node = parseManifoldRecord(raw, 'peer-a', NOW);
    expect(node?.phi).toBe(1);
    expect(node?.edges).toEqual([{ to: 'peer-b', smoothness: 1, latencyMs: null, weight: 0 }]);
  });

  it('keeps only the strongest links', () => {
    const edges = Array.from({ length: SYNAPSE_MAX_EDGES + 10 }, (_, i) => edge(`peer-n${i}`, i / 100));
    const node = parseManifoldRecord(record('peer-a', edges), 'peer-a', NOW)!;
    expect(node.edges).toHaveLength(SYNAPSE_MAX_EDGES);
    expect(node.edges[0].to).toBe(`peer-n${SYNAPSE_MAX_EDGES + 9}`);
  });

  it('uses its own registry slot', () => {
    expect(synapseSlot('peer-abc')).toBe('neural~peer-abc');
  });
});

describe('SynapseManifold', () => {
  it('keeps the newest record per node and evicts the stalest past its cap', () => {
    const m = new SynapseManifold(2);
    const a1 = parseManifoldRecord(record('peer-a', [edge('peer-x', 0.2)], NOW - 3_000), 'peer-a', NOW)!;
    const a2 = parseManifoldRecord(record('peer-a', [edge('peer-x', 0.9)], NOW - 1_000), 'peer-a', NOW)!;
    expect(m.merge(a2)).toBe(true);
    expect(m.merge(a1)).toBe(false);
    expect(m.getEdge('peer-a', 'peer-x', NOW)?.smoothness).toBe(0.9);
    m.merge(parseManifoldRecord(record('peer-b', [], NOW - 2_000), 'peer-b', NOW)!);
    m.merge(parseManifoldRecord(record('peer-c', [], NOW - 500), 'peer-c', NOW)!);
    expect(m.size).toBe(2);
    expect(m.getNode('peer-b', NOW)).toBeNull();
  });

  it('summarises what other nodes report about a peer', () => {
    const m = new SynapseManifold();
    m.merge(parseManifoldRecord(record('peer-a', [edge('peer-t', 0.9, 30)]), 'peer-a', NOW)!);
    m.merge(parseManifoldRecord(record('peer-b', [edge('peer-t', 0.7, 50)]), 'peer-b', NOW)!);
    m.merge(parseManifoldRecord(record('peer-me', [edge('peer-t', 0.1, 900)]), 'peer-me', NOW)!);
    const view = m.getNetworkView('peer-t', NOW, 'peer-me')!;
    expect(view.reporters).toBe(2);
    expect(view.smoothness).toBeCloseTo(0.8);
    expect(view.latencyMs).toBe(40);
    expect(view.confidence).toBeCloseTo(2 / 3);
    expect(m.getNetworkView('peer-t', NOW + SYNAPSE_STALE_MS + 2_000, 'peer-me')).toBeNull();
  });
});

describe('synapse exchanger lifecycle', () => {
  let handler: ((from: string, payload: unknown) => void) | null;
  let published: Array<{ channel: string; slot: string; payload: string }>;
  let edges: SynapseEdge[];
  let shy: boolean;
  let deps: SynapseExchangerDeps;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    _resetSynapseExchangerForTests();
    _resetSynapseForTests();
    handler = null;
    published = [];
    edges = [edge('peer-b', 0.9, 20)];
    shy = false;
    deps = {
      localPeerId: () => 'peer-me',
      publish: (channel, slot, payload) => { published.push({ channel, slot, payload }); return true; },
      subscribe: (_channel, fn) => { handler = fn; return () => { handler = null; }; },
      collect: () => ({ conns: edges.length, phi: 0.5, edges }),
      isShy: () => shy,
      isOnline: () => true,
    };
  });

  afterEach(() => {
    _resetSynapseExchangerForTests();
    vi.useRealTimers();
  });

  it('publishes our links on start and folds in other nodes', () => {
    startSynapseExchanger(deps);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ channel: SYNAPSE_MANIFOLD_CHANNEL, slot: 'neural~peer-me' });
    handler!('peer-a', record('peer-a', [edge('peer-t', 0.8)], NOW));
    handler!('peer-mallory', record('peer-a', [edge('peer-t', 0.0)], NOW + 1));
    expect(getNetworkSynapseView('peer-t')?.smoothness).toBe(0.8);
    expect(getNetworkSynapsePrior('peer-t')).toBeCloseTo(SYNAPSE_NETWORK_DAMPING * 0.8 / 3);
    stopSynapseExchanger();
    expect(handler).toBeNull();
    expect(getSynapseManifold().size).toBe(0);
  });

  it('writes one empty record when links are gone, then stays quiet', () => {
    startSynapseExchanger(deps);
    edges = [];
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(60_000);
    expect(published).toHaveLength(2);
    expect(JSON.parse(published[1].payload).e).toEqual([]);
  });

  it('shy and offline nodes read the map without publishing', () => {
    shy = true;
    startSynapseExchanger(deps);
    expect(published).toHaveLength(0);
    handler!('peer-a', record('peer-a', [edge('peer-t', 0.8)], NOW));
    expect(getNetworkSynapseView('peer-t')).not.toBeNull();
    shy = false;
    expect(publishSynapseRecord({ ...deps, isOnline: () => false })).toBe(false);
  });
});

describe('Bus Cycle smoothness with the synapse map', () => {
  let handler: ((from: string, payload: unknown) => void) | null = null;

  beforeEach(() => {
    _resetSynapseExchangerForTests();
    _resetSynapseForTests();
    startSynapseExchanger({
      localPeerId: () => 'peer-me',
      publish: () => true,
      subscribe: (_c, fn) => { handler = fn; return () => { handler = null; }; },
      collect: () => ({ conns: 0, phi: null, edges: [] }),
      isOnline: () => false,
    });
  });

  afterEach(() => _resetSynapseExchangerForTests());

  it('lifts a stranger the network reports as smooth and fast', () => {
    const now = Date.now();
    const before = computeSmoothness(0.5, 'peer-t', 0, 20, now);
    for (const r of ['peer-a', 'peer-b', 'peer-c']) handler!(r, record(r, [edge('peer-t', 1, 30)], now));
    const after = computeSmoothness(0.5, 'peer-t', 0, 20, now);
    expect(after).toBeGreaterThan(before);
    // Damped: the network alone gives at most half the first-hand weight.
    expect(after - before).toBeLessThanOrEqual(0.25 * SYNAPSE_NETWORK_DAMPING + 0.2 * 0.5 + 1e-9);
  });

  it('never overrides first-hand memory of a peer', () => {
    const now = Date.now();
    recordHandshake('peer-t', false, 500);
    const local = computeSmoothness(0.5, 'peer-t', 0, 20, now);
    for (const r of ['peer-a', 'peer-b', 'peer-c']) handler!(r, record(r, [edge('peer-t', 1, 10)], now));
    expect(computeSmoothness(0.5, 'peer-t', 0, 20, now)).toBe(local);
  });
});
