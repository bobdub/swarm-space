import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetSynapseExchangerForTests,
  buildManifoldRecord,
  getNetworkSynapsePrior,
  getNetworkSynapseView,
  getSynapseMapStats,
  getSynapseManifold,
  parseManifoldRecord,
  publishSynapseRecord,
  startSynapseExchanger,
  stopSynapseExchanger,
  SYNAPSE_MANIFOLD_CHANNEL,
  SYNAPSE_MAX_RECORD_CHARS,
  SYNAPSE_MAX_EDGES,
  SYNAPSE_NETWORK_DAMPING,
  SYNAPSE_STALE_MS,
  SynapseManifold,
  synapsePeerKey,
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
  it('round-trips a record attributed to its slot owner', () => {
    const raw = record('peer-a', [edge('peer-b', 0.94, 38, 4.82)]);
    const node = parseManifoldRecord(raw, 'peer-a', NOW)!;
    expect(node).toMatchObject({ peerId: 'peer-a', conns: 1, at: NOW - 1_000 });
    expect(node.phi).toBeCloseTo(0.8, 2);
    expect(node.edges).toHaveLength(1);
    expect(node.edges[0].key).toBe(synapsePeerKey('peer-b'));
    expect(node.edges[0].smoothness).toBeCloseTo(0.94, 2);
    expect(node.edges[0].latencyMs).toBe(38);
    expect(node.edges[0].weight).toBeCloseTo(4.82, 0);
  });

  it('is a compact base64 string: 8 header bytes and 10 per edge, no peer ids', () => {
    const raw = record('peer-alice-0123456789', [edge('peer-bob-0123456789', 0.5), edge('peer-carol-0123456789', 0.4)]);
    expect(raw).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(atob(raw)).toHaveLength(8 + 2 * 10);
    expect(atob(raw)).not.toContain('peer-');
    const full = record('peer-a', Array.from({ length: SYNAPSE_MAX_EDGES }, (_, i) => edge(`peer-n${i}`, 0.5)));
    expect(full.length).toBe(SYNAPSE_MAX_RECORD_CHARS);
    expect(full.length).toBeLessThan(400);
  });

  it('keeps unmeasured latency and unknown phi distinct from zero', () => {
    const raw = buildManifoldRecord({ peerId: 'peer-a', at: NOW, conns: 1, phi: null, edges: [edge('peer-b', 0.5, null)] })!;
    const node = parseManifoldRecord(raw, 'peer-a', NOW)!;
    expect(node.phi).toBeNull();
    expect(node.edges[0].latencyMs).toBeNull();
  });

  it('refuses stale, future, malformed, oversized and wrong-version records', () => {
    expect(parseManifoldRecord(record('peer-a', [], NOW - SYNAPSE_STALE_MS - 1_000), 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord(record('peer-a', [], NOW + SYNAPSE_STALE_MS + 1_000), 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord('not base64!', 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord(btoa('abc'), 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord({ v: 1 }, 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord('A'.repeat(SYNAPSE_MAX_RECORD_CHARS + 4), 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord(record('peer-a', []), 'javascript:x', NOW)).toBeNull();
    const bytes = Uint8Array.from(atob(record('peer-a', [])), (c) => c.charCodeAt(0));
    bytes[0] = 1;
    expect(parseManifoldRecord(btoa(String.fromCharCode(...bytes)), 'peer-a', NOW)).toBeNull();
  });

  it('clamps numbers and drops self, duplicate and malformed edges', () => {
    const raw = buildManifoldRecord({
      peerId: 'peer-a', at: NOW, conns: 3, phi: 7,
      edges: [edge('peer-a', 1), edge('peer-b', 9, -5, -2), edge('peer-b', 0.1), edge('javascript:x', 1), { to: 'peer-c', smoothness: NaN, latencyMs: 1, weight: 1 }],
    })!;
    const node = parseManifoldRecord(raw, 'peer-a', NOW)!;
    expect(node.phi).toBe(1);
    expect(node.edges).toEqual([{ key: synapsePeerKey('peer-b'), smoothness: 1, latencyMs: null, weight: 0 }]);
  });

  it('keeps only the strongest links', () => {
    const edges = Array.from({ length: SYNAPSE_MAX_EDGES + 10 }, (_, i) => edge(`peer-n${i}`, i / 100));
    const node = parseManifoldRecord(record('peer-a', edges), 'peer-a', NOW)!;
    expect(node.edges).toHaveLength(SYNAPSE_MAX_EDGES);
    expect(node.edges[0].key).toBe(synapsePeerKey(`peer-n${SYNAPSE_MAX_EDGES + 9}`));
  });

  it('uses its own registry slot and a stable 48-bit peer key', () => {
    expect(synapseSlot('peer-abc')).toBe('neural~peer-abc');
    expect(synapsePeerKey('peer-abc')).toMatch(/^[0-9a-f]{12}$/);
    expect(synapsePeerKey('peer-abc')).toBe(synapsePeerKey('peer-abc'));
    expect(synapsePeerKey('peer-abc')).not.toBe(synapsePeerKey('peer-abd'));
  });
});

describe('SynapseManifold', () => {
  it('keeps the newest record per node and evicts the stalest past its cap', () => {
    const m = new SynapseManifold(2);
    const a1 = parseManifoldRecord(record('peer-a', [edge('peer-x', 0.2)], NOW - 3_000), 'peer-a', NOW)!;
    const a2 = parseManifoldRecord(record('peer-a', [edge('peer-x', 0.9)], NOW - 1_000), 'peer-a', NOW)!;
    expect(m.merge(a2)).toBe(true);
    expect(m.merge(a1)).toBe(false);
    expect(m.getEdge('peer-a', 'peer-x', NOW)?.smoothness).toBeCloseTo(0.9, 2);
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
    expect(view.smoothness).toBeCloseTo(0.8, 2);
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
    handler!('peer-me', record('peer-me', [edge('peer-t', 0.0)], NOW));
    expect(getNetworkSynapseView('peer-t')?.smoothness).toBeCloseTo(0.8, 2);
    expect(getNetworkSynapsePrior('peer-t')).toBeCloseTo(SYNAPSE_NETWORK_DAMPING * 0.8 / 3, 2);
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
    expect(atob(published[1].payload)).toHaveLength(8);
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

describe('synapse map stats', () => {
  afterEach(() => _resetSynapseExchangerForTests());

  it('counts received, refused and published records, and Bus Cycle assists', () => {
    _resetSynapseExchangerForTests();
    _resetSynapseForTests();
    let handler: ((from: string, payload: unknown) => void) | null = null;
    startSynapseExchanger({
      localPeerId: () => 'peer-me',
      publish: () => true,
      subscribe: (_c, fn) => { handler = fn; return () => { handler = null; }; },
      collect: () => ({ conns: 1, phi: null, edges: [edge('peer-b', 0.5)] }),
      isOnline: () => true,
    });
    const now = Date.now();
    handler!('peer-a', record('peer-a', [edge('peer-t', 1)], now));
    handler!('peer-a', 'garbage');
    computeSmoothness(0.5, 'peer-t', 0, 20, now);
    const stats = getSynapseMapStats(now);
    expect(stats).toMatchObject({ running: true, shy: false, nodes: 1, edges: 1, received: 1, refused: 1, published: 1, assists: 1 });
    expect(stats.lastPublishedChars).toBe(Math.ceil(18 / 3) * 4);
  });
});
