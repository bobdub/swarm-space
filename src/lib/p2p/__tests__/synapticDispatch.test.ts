import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rankBySynapticPath, synapticResistance, SYNAPSE_NODE_CAPACITY } from "../synapticDispatch";
import { _resetSynapseForTests, recordHandshake } from "../synapseLayer";
import {
  _resetSynapseExchangerForTests,
  buildManifoldRecord,
  startSynapseExchanger,
  type SynapseEdge,
} from "../synapseExchanger";
import { TorrentSwarm, type MeshTransportAdapter, type TorrentManifest } from "../torrentSwarm.standalone";

const neutral = { rttMs: null, smoothness: null, network: null, reportedConns: null };

describe("synaptic resistance", () => {
  it("is neutral without data and rises with latency, failures and load", () => {
    const base = synapticResistance(neutral);
    expect(base).toBeCloseTo(0.5 * 0.3 + 0.3 * 0.5 + 0.2 * 0.5);
    expect(synapticResistance({ ...neutral, rttMs: 20 })).toBeLessThan(base);
    expect(synapticResistance({ ...neutral, rttMs: 900 })).toBeGreaterThan(base);
    expect(synapticResistance({ ...neutral, smoothness: 1 })).toBeLessThan(base);
    expect(synapticResistance({ ...neutral, reportedConns: SYNAPSE_NODE_CAPACITY * 2 })).toBeGreaterThan(base);
    expect(synapticResistance({ ...neutral, reportedConns: 0 })).toBeLessThan(base);
  });

  it("lets first-hand smoothness beat the network view", () => {
    const network = { reporters: 3, smoothness: 1, latencyMs: 10, confidence: 1 };
    const local = synapticResistance({ ...neutral, smoothness: 0, rttMs: 500, network });
    expect(local).toBeCloseTo(0.5 * 0.5 + 0.3 * 1 + 0.2 * 0.5);
  });

  it("damps the network view", () => {
    const network = { reporters: 3, smoothness: 1, latencyMs: null, confidence: 1 };
    const r = synapticResistance({ ...neutral, network });
    expect(r).toBeCloseTo(0.5 * 0.3 + 0.3 * (1 - 0.75) + 0.2 * 0.5);
  });
});

describe("rankBySynapticPath", () => {
  let handler: ((from: string, payload: unknown) => void) | null = null;
  const record = (peerId: string, conns: number, edges: SynapseEdge[] = []) =>
    buildManifoldRecord({ peerId, at: Date.now(), conns, phi: null, edges })!;

  beforeEach(() => {
    _resetSynapseForTests();
    _resetSynapseExchangerForTests();
    startSynapseExchanger({
      localPeerId: () => "peer-me",
      publish: () => true,
      subscribe: (_c, fn) => { handler = fn; return () => { handler = null; }; },
      collect: () => ({ conns: 0, phi: null, edges: [] }),
      isOnline: () => false,
    });
  });
  afterEach(() => _resetSynapseExchangerForTests());

  it("keeps the input order when nothing is known", () => {
    expect(rankBySynapticPath(["peer-a", "peer-b", "peer-c"])).toEqual(["peer-a", "peer-b", "peer-c"]);
  });

  it("puts the fast, smooth link first", () => {
    recordHandshake("peer-a", false);
    recordHandshake("peer-b", true);
    const ranked = rankBySynapticPath(["peer-a", "peer-b"], { rttOf: (id) => (id === "peer-b" ? 30 : 400) });
    expect(ranked).toEqual(["peer-b", "peer-a"]);
  });

  it("slides traffic away from a peer that reports itself busy", () => {
    handler!("peer-a", record("peer-a", 40));
    handler!("peer-b", record("peer-b", 2));
    expect(rankBySynapticPath(["peer-a", "peer-b"])).toEqual(["peer-b", "peer-a"]);
  });

  it("never adds or drops a peer", () => {
    const ids = ["peer-a", "peer-b", "peer-c", "peer-d"];
    expect(rankBySynapticPath(ids).slice().sort()).toEqual(ids);
  });
});

describe("torrent chunk requests follow the transport's ranking", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => vi.useRealTimers());

  function setup(rankPeers?: (ids: string[]) => string[]) {
    let handler: ((peerId: string, payload: unknown) => void) | null = null;
    const sent: Array<{ peerId: string; msg: { msg: string } }> = [];
    const peers = ["p1", "p2", "p3"];
    const transport: MeshTransportAdapter = {
      localPeerId: "me",
      async send(_c, peerId, payload) { sent.push({ peerId, msg: payload as { msg: string } }); return true; },
      broadcast() {},
      onMessage(_c, h) { handler = h; return () => { handler = null; }; },
      getConnectedPeerIds: () => peers,
      ...(rankPeers ? { rankPeers } : {}),
    };
    const swarm = new TorrentSwarm(transport);
    swarm.start();
    const m: TorrentManifest = {
      id: "m", name: "m", totalSize: 10, chunkSize: 10, totalChunks: 1,
      chunkHashes: ["x"], contentHash: "y", creatorId: "z", createdAt: 0,
    };
    swarm.download(m);
    for (const p of peers) handler!(p, { msg: "have", manifestId: "m", payload: { indices: [0] }, msgId: `h-${p}` });
    vi.advanceTimersByTime(2_000);
    swarm.stop();
    return sent.filter((s) => s.msg.msg === "request").map((s) => s.peerId);
  }

  it("asks the best-ranked holder for a chunk", () => {
    expect(setup((ids) => ids.slice().reverse())[0]).toBe("p3");
  });

  it("ignores a ranking that drops or invents peers", () => {
    expect(setup(() => ["p9"])[0]).toBe("p1");
  });
});
