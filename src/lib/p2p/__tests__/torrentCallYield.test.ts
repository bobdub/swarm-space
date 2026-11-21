import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  TorrentSwarm,
  type MeshTransportAdapter,
  type TorrentManifest,
  IN_CALL_TORRENT_SEND_BUFFER_LIMIT_BYTES,
  TORRENT_SEND_BUFFER_LIMIT_BYTES,
} from "../torrentSwarm.standalone";
import { applyHighMediaPriority } from "../callActivity";

type Sent = { peerId: string; msg: { msg: string; manifestId: string; payload: { index: number } } };

function makeTransport(peers: string[], state: { inCall: boolean; buffered: Record<string, number> }) {
  let handler: ((peerId: string, payload: unknown) => void) | null = null;
  const sent: Sent[] = [];
  const transport: MeshTransportAdapter = {
    localPeerId: "me",
    async send(_c, peerId, payload) {
      sent.push({ peerId, msg: payload as Sent["msg"] });
      return true;
    },
    broadcast() {},
    onMessage(_c, h) { handler = h; return () => { handler = null; }; },
    getConnectedPeerIds: () => peers,
    getBufferedAmount: (peerId) => state.buffered[peerId] ?? 0,
    isCallActive: () => state.inCall,
  };
  return { transport, sent, deliver: (peerId: string, msg: unknown) => handler?.(peerId, msg) };
}

function manifest(id: string, chunks: number): TorrentManifest {
  return {
    id, name: id, totalSize: chunks * 10, chunkSize: 10, totalChunks: chunks,
    chunkHashes: Array(chunks).fill("x"), contentHash: "y", creatorId: "z", createdAt: 0,
  };
}

const requests = (sent: Sent[]) => sent.filter((s) => s.msg.msg === "request");
const pieces = (sent: Sent[]) => sent.filter((s) => s.msg.msg === "piece");

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

describe("torrents yield to calls", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => vi.useRealTimers());

  function seedPeersWithAllChunks(swarm: TorrentSwarm, deliver: (p: string, m: unknown) => void, m: TorrentManifest, peers: string[]) {
    swarm.download(m);
    const all = Array.from({ length: m.totalChunks }, (_, i) => i);
    for (const p of peers) deliver(p, { msg: "have", manifestId: m.id, payload: { indices: all }, msgId: `h-${p}` });
  }

  it("downloads from two peers with one piece each while on a call", () => {
    const peers = ["p1", "p2", "p3", "p4"];
    const state = { inCall: true, buffered: {} };
    const { transport, sent, deliver } = makeTransport(peers, state);
    const swarm = new TorrentSwarm(transport);
    swarm.start();
    const m = manifest("m", 20);
    seedPeersWithAllChunks(swarm, deliver, m, peers);

    vi.advanceTimersByTime(2_000);
    const reqs = requests(sent);
    const byPeer = new Map<string, number>();
    for (const r of reqs) byPeer.set(r.peerId, (byPeer.get(r.peerId) ?? 0) + 1);
    expect(byPeer.size).toBe(2);
    for (const n of byPeer.values()) expect(n).toBe(1);
    swarm.stop();
  });

  it("uses up to four pieces per peer across all peers when not on a call", () => {
    const peers = ["p1", "p2", "p3", "p4"];
    const state = { inCall: false, buffered: {} };
    const { transport, sent, deliver } = makeTransport(peers, state);
    const swarm = new TorrentSwarm(transport);
    swarm.start();
    seedPeersWithAllChunks(swarm, deliver, manifest("m", 20), peers);

    vi.advanceTimersByTime(2_000);
    expect(requests(sent)).toHaveLength(16);
    swarm.stop();
  });

  it("holds pieces back while the channel is backed up, then sends them", async () => {
    const state = { inCall: false, buffered: { p1: TORRENT_SEND_BUFFER_LIMIT_BYTES + 1 } as Record<string, number> };
    const { transport, sent, deliver } = makeTransport(["p1"], state);
    const swarm = new TorrentSwarm(transport);
    swarm.start();
    const m = await swarm.seed("file", new Uint8Array(30), "me", "image/png", 10);
    sent.length = 0;

    deliver("p1", { msg: "request", manifestId: m.id, payload: { index: 0 }, msgId: "r0" });
    deliver("p1", { msg: "request", manifestId: m.id, payload: { index: 1 }, msgId: "r1" });
    vi.advanceTimersByTime(500);
    expect(pieces(sent)).toHaveLength(0);

    state.buffered.p1 = 0;
    vi.advanceTimersByTime(200);
    expect(pieces(sent).map((p) => p.msg.payload.index)).toEqual([0, 1]);
    swarm.stop();
  });

  it("uses a tighter backlog limit and serves only two peers while on a call", async () => {
    const peers = ["p1", "p2", "p3"];
    const state = { inCall: true, buffered: {} as Record<string, number> };
    const { transport, sent, deliver } = makeTransport(peers, state);
    const swarm = new TorrentSwarm(transport);
    swarm.start();
    const m = await swarm.seed("file", new Uint8Array(30), "me", "image/png", 10);
    sent.length = 0;

    // A backlog fine outside a call holds pieces back during one.
    state.buffered.p1 = IN_CALL_TORRENT_SEND_BUFFER_LIMIT_BYTES + 1;
    deliver("p1", { msg: "request", manifestId: m.id, payload: { index: 0 }, msgId: "a" });
    expect(pieces(sent)).toHaveLength(0);
    state.buffered.p1 = 0;

    deliver("p2", { msg: "request", manifestId: m.id, payload: { index: 0 }, msgId: "b" });
    deliver("p3", { msg: "request", manifestId: m.id, payload: { index: 0 }, msgId: "c" });
    vi.advanceTimersByTime(1_000);
    expect(new Set(pieces(sent).map((p) => p.peerId))).toEqual(new Set(["p1", "p2"]));

    // The third peer is served once the first two have gone quiet.
    vi.advanceTimersByTime(3_000);
    expect(new Set(pieces(sent).map((p) => p.peerId))).toEqual(new Set(peers));
    swarm.stop();
    await flush();
  });
});

describe("call media priority", () => {
  it("marks outgoing call tracks high priority", async () => {
    const params = { encodings: [{}] as Array<Record<string, unknown>> };
    const setParameters = vi.fn(async () => {});
    const pc = {
      connectionState: "connected",
      getSenders: () => [
        { track: { kind: "audio" }, getParameters: () => params, setParameters },
        { track: null, getParameters: () => ({ encodings: [{}] }), setParameters },
      ],
    } as unknown as RTCPeerConnection;

    await applyHighMediaPriority(pc);
    expect(setParameters).toHaveBeenCalledTimes(1);
    expect(params.encodings[0]).toMatchObject({ priority: "high", networkPriority: "high" });
  });

  it("ignores connections without sender support", async () => {
    await expect(applyHighMediaPriority({ connectionState: "connected" } as unknown as RTCPeerConnection)).resolves.toBeUndefined();
  });
});
