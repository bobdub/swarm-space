import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetSynapseExchangerForTests,
  buildManifoldBody,
  buildManifoldRecord,
  getNetworkSynapsePrior,
  getNetworkSynapseView,
  getSynapseMapStats,
  getSynapseManifold,
  parseManifoldRecord,
  publishSynapseRecord,
  signManifoldRecord,
  startSynapseExchanger,
  stopSynapseExchanger,
  SYNAPSE_MANIFOLD_CHANNEL,
  SYNAPSE_MAX_RECORD_CHARS,
  SYNAPSE_MAX_EDGES,
  SYNAPSE_NETWORK_DAMPING,
  SYNAPSE_STALE_MS,
  SYNAPSE_UNVOUCHED_WEIGHT,
  SynapseManifold,
  synapsePeerKey,
  synapseSignerUserId,
  synapseSlot,
  verifyManifoldRecord,
  type SynapseEdge,
  type SynapseExchangerDeps,
  type SynapseSigner,
} from '../synapseExchanger';
import { computeSmoothness } from '../globalCell';
import { _resetSynapseForTests, recordHandshake } from '../synapseLayer';

const NOW = 1_800_000_000_000;
const SPKI_BYTES = 91;
const SIG_BYTES = 64;
const edge = (to: string, smoothness: number, latencyMs: number | null = 40, weight = 1): SynapseEdge =>
  ({ to, smoothness, latencyMs, weight });

const b64 = (buf: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buf)));
async function makeSigner(): Promise<SynapseSigner> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = b64(await crypto.subtle.exportKey('spki', pair.publicKey));
  return {
    publicKey,
    sign: async (data) => new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, data)),
  };
}

let signer: SynapseSigner;
let other: SynapseSigner;
beforeAll(async () => {
  signer = await makeSigner();
  other = await makeSigner();
});

const record = async (peerId: string, edges: SynapseEdge[], at = NOW - 1_000, by: SynapseSigner = signer): Promise<string> =>
  (await buildManifoldRecord({ peerId, at, conns: edges.length, phi: 0.8, edges }, by))!;
const decode = (raw: string): Uint8Array => Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
const encode = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const settle = () => new Promise((r) => setTimeout(r, 30));

describe('synapse manifold records', () => {
  it('round-trips a signed record attributed to its slot owner', async () => {
    const raw = await record('peer-a', [edge('peer-b', 0.94, 38, 4.82)]);
    const node = (await verifyManifoldRecord(raw, 'peer-a', NOW))!;
    expect(node).toMatchObject({ peerId: 'peer-a', conns: 1, at: NOW - 1_000, publicKey: signer.publicKey, vouched: false });
    expect(node.phi).toBeCloseTo(0.8, 2);
    expect(node.edges).toHaveLength(1);
    expect(node.edges[0].key).toBe(synapsePeerKey('peer-b'));
    expect(node.edges[0].smoothness).toBeCloseTo(0.94, 2);
    expect(node.edges[0].latencyMs).toBe(38);
    expect(node.edges[0].weight).toBeCloseTo(4.82, 0);
  });

  it('is compact binary: header, 10 bytes per edge, signer key and signature, no peer ids', async () => {
    const raw = await record('peer-alice-0123456789', [edge('peer-bob-0123456789', 0.5), edge('peer-carol-0123456789', 0.4)]);
    expect(raw).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(decode(raw)).toHaveLength(9 + 2 * 10 + 1 + SPKI_BYTES + SIG_BYTES);
    expect(atob(raw)).not.toContain('peer-');
    const full = await record('peer-a', Array.from({ length: SYNAPSE_MAX_EDGES }, (_, i) => edge(`peer-n${i}`, 0.5)));
    expect(full.length).toBeLessThanOrEqual(SYNAPSE_MAX_RECORD_CHARS);
    expect(full.length).toBeLessThan(600);
  });

  it('keeps unmeasured latency and unknown phi distinct from zero', async () => {
    const raw = (await buildManifoldRecord({ peerId: 'peer-a', at: NOW, conns: 1, phi: null, edges: [edge('peer-b', 0.5, null)] }, signer))!;
    const node = parseManifoldRecord(raw, 'peer-a', NOW)!;
    expect(node.phi).toBeNull();
    expect(node.edges[0].latencyMs).toBeNull();
  });

  it('refuses stale, future, malformed, oversized and wrong-version records', async () => {
    expect(parseManifoldRecord(await record('peer-a', [], NOW - SYNAPSE_STALE_MS - 1_000), 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord(await record('peer-a', [], NOW + SYNAPSE_STALE_MS + 1_000), 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord('not base64!', 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord(btoa('abc'), 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord({ v: 1 }, 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord('A'.repeat(SYNAPSE_MAX_RECORD_CHARS + 4), 'peer-a', NOW)).toBeNull();
    expect(parseManifoldRecord(await record('peer-a', []), 'javascript:x', NOW)).toBeNull();
    const bytes = decode(await record('peer-a', []));
    bytes[0] = 2;
    expect(parseManifoldRecord(encode(bytes), 'peer-a', NOW)).toBeNull();
    // An unsigned body (the old record shape) is not a record.
    expect(parseManifoldRecord(buildManifoldBody({ peerId: 'peer-a', at: NOW, conns: 0, phi: null, edges: [] }), 'peer-a', NOW)).toBeNull();
  });

  it('clamps numbers and drops self, duplicate and malformed edges', async () => {
    const raw = (await buildManifoldRecord({
      peerId: 'peer-a', at: NOW, conns: 3, phi: 7,
      edges: [edge('peer-a', 1), edge('peer-b', 9, -5, -2), edge('peer-b', 0.1), edge('javascript:x', 1), { to: 'peer-c', smoothness: NaN, latencyMs: 1, weight: 1 }],
    }, signer))!;
    const node = parseManifoldRecord(raw, 'peer-a', NOW)!;
    expect(node.phi).toBe(1);
    expect(node.edges).toEqual([{ key: synapsePeerKey('peer-b'), smoothness: 1, latencyMs: null, weight: 0 }]);
  });

  it('keeps only the strongest links', async () => {
    const edges = Array.from({ length: SYNAPSE_MAX_EDGES + 10 }, (_, i) => edge(`peer-n${i}`, i / 100));
    const node = parseManifoldRecord(await record('peer-a', edges), 'peer-a', NOW)!;
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

describe('record signatures', () => {
  it('refuses a tampered record', async () => {
    const bytes = decode(await record('peer-a', [edge('peer-b', 0.2)]));
    bytes[9 + 6] = 255; // raise the reported smoothness
    expect(await verifyManifoldRecord(encode(bytes), 'peer-a', NOW)).toBeNull();
  });

  it('keeps every edge when an edge hash starts with a plausible key length', async () => {
    // peer-14 hashes to 65a1…: its first byte is 101 = one 10-byte edge + a 91-byte SPKI key.
    expect(synapsePeerKey('peer-14').slice(0, 2)).toBe('65');
    const raw = await record('peer-a', [edge('peer-14', 0.7)]);
    const node = await verifyManifoldRecord(raw, 'peer-a', NOW);
    expect(node?.edges.map((e) => e.key)).toEqual([synapsePeerKey('peer-14')]);
    for (let i = 0; i < 200; i++) {
      const many = await record('peer-a', [edge(`peer-${i}`, 0.5), edge(`peer-x${i}`, 0.4)]);
      expect((await verifyManifoldRecord(many, 'peer-a', NOW))?.edges).toHaveLength(2);
    }
  });

  it('refuses a record whose edge count does not match its length', async () => {
    const bytes = decode(await record('peer-a', [edge('peer-b', 0.5)]));
    bytes[8] = 2;
    expect(parseManifoldRecord(encode(bytes), 'peer-a', NOW)).toBeNull();
    bytes[8] = SYNAPSE_MAX_EDGES + 1;
    expect(parseManifoldRecord(encode(bytes), 'peer-a', NOW)).toBeNull();
  });

  it('refuses a record replayed into another node\'s slot', async () => {
    const raw = await record('peer-a', [edge('peer-b', 0.5)]);
    expect(parseManifoldRecord(raw, 'peer-mallory', NOW)).not.toBeNull();
    expect(await verifyManifoldRecord(raw, 'peer-mallory', NOW)).toBeNull();
  });

  it('vouches only when the key hashes to the user id the library holds', async () => {
    const raw = await record('peer-a', []);
    const userId = (await synapseSignerUserId(signer.publicKey))!;
    expect(userId).toMatch(/^[0-9a-f]{16}$/);
    expect((await verifyManifoldRecord(raw, 'peer-a', NOW, userId))?.vouched).toBe(true);
    expect((await verifyManifoldRecord(raw, 'peer-a', NOW, 'someone-else'))?.vouched).toBe(false);
  });

  it('signs a prepared body for one slot', async () => {
    const body = buildManifoldBody({ peerId: 'peer-a', at: NOW, conns: 0, phi: null, edges: [] })!;
    const raw = (await signManifoldRecord(body, 'peer-a', signer))!;
    expect(await verifyManifoldRecord(raw, 'peer-a', NOW)).not.toBeNull();
  });
});

describe('SynapseManifold', () => {
  it('keeps the newest record per node and evicts the stalest past its cap', async () => {
    const m = new SynapseManifold(2);
    const a1 = parseManifoldRecord(await record('peer-a', [edge('peer-x', 0.2)], NOW - 3_000), 'peer-a', NOW)!;
    const a2 = parseManifoldRecord(await record('peer-a', [edge('peer-x', 0.9)], NOW - 1_000), 'peer-a', NOW)!;
    expect(m.merge(a2)).toBe(true);
    expect(m.merge(a1)).toBe(false);
    expect(m.getEdge('peer-a', 'peer-x', NOW)?.smoothness).toBeCloseTo(0.9, 2);
    m.merge(parseManifoldRecord(await record('peer-b', [], NOW - 2_000), 'peer-b', NOW)!);
    m.merge(parseManifoldRecord(await record('peer-c', [], NOW - 500), 'peer-c', NOW)!);
    expect(m.size).toBe(2);
    expect(m.getNode('peer-b', NOW)).toBeNull();
  });

  it('summarises what other nodes report, weighing vouched reporters in full', async () => {
    const m = new SynapseManifold();
    const vouched = { ...parseManifoldRecord(await record('peer-a', [edge('peer-t', 0.9, 30)]), 'peer-a', NOW)!, vouched: true };
    m.merge(vouched);
    m.merge(parseManifoldRecord(await record('peer-b', [edge('peer-t', 0.6, 50)]), 'peer-b', NOW)!);
    m.merge(parseManifoldRecord(await record('peer-me', [edge('peer-t', 0.1, 900)]), 'peer-me', NOW)!);
    const view = m.getNetworkView('peer-t', NOW, 'peer-me')!;
    const w = SYNAPSE_UNVOUCHED_WEIGHT;
    expect(view.reporters).toBe(2);
    expect(view.smoothness).toBeCloseTo((0.9 + w * 0.6) / (1 + w), 2);
    expect(view.latencyMs).toBe(40);
    expect(view.confidence).toBeCloseTo((1 + w) / 3);
    expect(m.getNetworkView('peer-t', NOW + SYNAPSE_STALE_MS + 2_000, 'peer-me')).toBeNull();
  });
});

describe('synapse exchanger lifecycle', () => {
  let handler: ((from: string, payload: unknown) => void | Promise<void>) | null;
  let published: Array<{ channel: string; slot: string; payload: string }>;
  let edges: SynapseEdge[];
  let shy: boolean;
  let known: Record<string, string>;
  let deps: SynapseExchangerDeps;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(NOW);
    _resetSynapseExchangerForTests();
    _resetSynapseForTests();
    handler = null;
    published = [];
    edges = [edge('peer-b', 0.9, 20)];
    shy = false;
    known = {};
    deps = {
      localPeerId: () => 'peer-me',
      publish: (channel, slot, payload) => { published.push({ channel, slot, payload }); return true; },
      subscribe: (_channel, fn) => { handler = fn; return () => { handler = null; }; },
      collect: () => ({ conns: edges.length, phi: 0.5, edges }),
      signer: async () => signer,
      knownUserIdOf: (peerId) => known[peerId] ?? null,
      isShy: () => shy,
      isOnline: () => true,
    };
  });

  afterEach(() => {
    _resetSynapseExchangerForTests();
    vi.useRealTimers();
  });

  it('publishes a signed record on start and folds in verified nodes', async () => {
    startSynapseExchanger(deps);
    await settle();
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ channel: SYNAPSE_MANIFOLD_CHANNEL, slot: 'neural~peer-me' });
    expect(await verifyManifoldRecord(published[0].payload, 'peer-me', NOW)).not.toBeNull();
    await handler!('peer-a', await record('peer-a', [edge('peer-t', 0.8)], NOW));
    await handler!('peer-me', await record('peer-me', [edge('peer-t', 0.0)], NOW));
    expect(getNetworkSynapseView('peer-t')?.smoothness).toBeCloseTo(0.8, 2);
    expect(getNetworkSynapsePrior('peer-t')).toBeCloseTo(SYNAPSE_NETWORK_DAMPING * 0.8 * SYNAPSE_UNVOUCHED_WEIGHT / 3, 2);
    stopSynapseExchanger();
    expect(handler).toBeNull();
    expect(getSynapseManifold().size).toBe(0);
  });

  it('pins the first key per peer and lets only a vouched key replace it', async () => {
    startSynapseExchanger(deps);
    await handler!('peer-a', await record('peer-a', [edge('peer-t', 0.8)], NOW - 2_000));
    await handler!('peer-a', await record('peer-a', [edge('peer-t', 0.0)], NOW - 1_000, other));
    expect(getSynapseManifold().getNode('peer-a')?.publicKey).toBe(signer.publicKey);
    expect(getSynapseMapStats().refused).toBe(1);
    known['peer-a'] = (await synapseSignerUserId(other.publicKey))!;
    await handler!('peer-a', await record('peer-a', [edge('peer-t', 0.3)], NOW));
    // Same key as the pin but now unvouched: still accepted, not vouched.
    expect(getSynapseManifold().getNode('peer-a')?.vouched).toBe(false);
    await handler!('peer-a', await record('peer-a', [edge('peer-t', 0.4)], NOW + 1_000, other));
    expect(getSynapseManifold().getNode('peer-a')).toMatchObject({ publicKey: other.publicKey, vouched: true });
  });

  it('writes one empty record when links are gone, then stays quiet', async () => {
    startSynapseExchanger(deps);
    await settle();
    edges = [];
    vi.advanceTimersByTime(60_000);
    await settle();
    vi.advanceTimersByTime(60_000);
    await settle();
    expect(published).toHaveLength(2);
    expect(decode(published[1].payload)).toHaveLength(9 + 1 + SPKI_BYTES + SIG_BYTES);
  });

  it('shy, offline and unsigned nodes read the map without publishing', async () => {
    shy = true;
    startSynapseExchanger(deps);
    await settle();
    expect(published).toHaveLength(0);
    await handler!('peer-a', await record('peer-a', [edge('peer-t', 0.8)], NOW));
    expect(getNetworkSynapseView('peer-t')).not.toBeNull();
    shy = false;
    expect(await publishSynapseRecord({ ...deps, isOnline: () => false })).toBe(false);
    expect(await publishSynapseRecord({ ...deps, signer: async () => null })).toBe(false);
    expect(getSynapseMapStats().unsigned).toBe(true);
  });
});

describe('Bus Cycle smoothness with the synapse map', () => {
  let handler: ((from: string, payload: unknown) => void | Promise<void>) | null = null;

  beforeEach(() => {
    _resetSynapseExchangerForTests();
    _resetSynapseForTests();
    startSynapseExchanger({
      localPeerId: () => 'peer-me',
      publish: () => true,
      subscribe: (_c, fn) => { handler = fn; return () => { handler = null; }; },
      collect: () => ({ conns: 0, phi: null, edges: [] }),
      signer: async () => signer,
      isOnline: () => false,
    });
  });

  afterEach(() => _resetSynapseExchangerForTests());

  it('lifts a stranger the network reports as smooth and fast', async () => {
    const now = Date.now();
    const before = computeSmoothness(0.5, 'peer-t', 0, 20, now);
    for (const r of ['peer-a', 'peer-b', 'peer-c']) await handler!(r, await record(r, [edge('peer-t', 1, 30)], now));
    const after = computeSmoothness(0.5, 'peer-t', 0, 20, now);
    expect(after).toBeGreaterThan(before);
    // Damped: the network alone gives at most half the first-hand weight.
    expect(after - before).toBeLessThanOrEqual(0.25 * SYNAPSE_NETWORK_DAMPING + 0.2 * 0.5 + 1e-9);
  });

  it('never overrides first-hand memory of a peer', async () => {
    const now = Date.now();
    recordHandshake('peer-t', false, 500);
    const local = computeSmoothness(0.5, 'peer-t', 0, 20, now);
    for (const r of ['peer-a', 'peer-b', 'peer-c']) await handler!(r, await record(r, [edge('peer-t', 1, 10)], now));
    expect(computeSmoothness(0.5, 'peer-t', 0, 20, now)).toBe(local);
  });
});

describe('synapse map stats', () => {
  afterEach(() => _resetSynapseExchangerForTests());

  it('counts received, refused and published records, and Bus Cycle assists', async () => {
    _resetSynapseExchangerForTests();
    _resetSynapseForTests();
    let handler: ((from: string, payload: unknown) => void | Promise<void>) | null = null;
    startSynapseExchanger({
      localPeerId: () => 'peer-me',
      publish: () => true,
      subscribe: (_c, fn) => { handler = fn; return () => { handler = null; }; },
      collect: () => ({ conns: 1, phi: null, edges: [edge('peer-b', 0.5)] }),
      signer: async () => signer,
      isOnline: () => true,
    });
    await settle();
    const now = Date.now();
    await handler!('peer-a', await record('peer-a', [edge('peer-t', 1)], now));
    await handler!('peer-a', 'garbage');
    computeSmoothness(0.5, 'peer-t', 0, 20, now);
    const stats = getSynapseMapStats(now);
    expect(stats).toMatchObject({ running: true, shy: false, unsigned: false, nodes: 1, edges: 1, vouched: 0, received: 1, refused: 1, published: 1, assists: 1 });
    expect(stats.lastPublishedChars).toBe(Math.ceil((9 + 10 + 1 + SPKI_BYTES + SIG_BYTES) / 3) * 4);
  });
});
