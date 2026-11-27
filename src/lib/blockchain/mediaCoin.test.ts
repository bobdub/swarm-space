/**
 * Media Coin courier engine — unit tests (mock transports only; the real
 * mesh relays are bot-protected).
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  MediaCoinEngine,
  MemoryChunkStore,
  buildMerkleRoot,
  buildMerkleProof,
  verifyMerkleProof,
  mintMediaCoinContent,
  mediaCoinChunkSizeFor,
  MEDIA_COIN_PASS_MAX_BYTES,
  MEDIA_COIN_BUFFER_HIGH_WATER,
  type MeshTransportAdapter,
  type MediaCoinSource,
} from "./mediaCoin.standalone";
import { MEDIA_COIN_PASS_MAX_BYTES as SHARED_CAP } from "@/lib/media/meshUploadLimits";

type Msg = { type: string; coinId: string; payload: Record<string, unknown> };

/** In-memory mesh with an optional per-link buffered amount. */
function createNetwork() {
  const handlers = new Map<string, (from: string, payload: unknown) => void>();
  const links = new Map<string, Set<string>>();
  const sent: Array<{ from: string; to: string; msg: Msg }> = [];
  const buffered = new Map<string, number>();
  const link = (a: string, b: string) => {
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!links.has(x)) links.set(x, new Set());
      links.get(x)!.add(y);
    }
  };
  const transport = (id: string): MeshTransportAdapter => ({
    localPeerId: id,
    async send(_c, peerId, payload) {
      const h = handlers.get(peerId);
      if (!h || !links.get(id)?.has(peerId)) return false;
      const copy = JSON.parse(JSON.stringify(payload));
      sent.push({ from: id, to: peerId, msg: copy });
      queueMicrotask(() => h(id, copy));
      return true;
    },
    broadcast() {},
    onMessage(_c, handler) { handlers.set(id, handler); return () => handlers.delete(id); },
    getConnectedPeerIds: () => Array.from(links.get(id) ?? []),
    getBufferedAmount: (peerId) => buffered.get(`${id}>${peerId}`) ?? 0,
  });
  return { transport, link, sent, buffered };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (ready: () => boolean, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!ready() && Date.now() < deadline) await tick();
  for (let i = 0; i < 30; i++) await tick();
};

const engines: MediaCoinEngine[] = [];
afterEach(() => { for (const e of engines.splice(0)) e.stop(); });

function engineFor(net: ReturnType<typeof createNetwork>, id: string, opts: ConstructorParameters<typeof MediaCoinEngine>[1] = {}) {
  const e = new MediaCoinEngine(net.transport(id), opts);
  e.start();
  engines.push(e);
  return e;
}

const bytes = (n: number, mod = 251) => new Uint8Array(n).map((_, i) => i % mod);
const chunksSent = (net: ReturnType<typeof createNetwork>, to: string) => net.sent.filter((s) => s.to === to && s.msg.type === "coin-chunk");

describe("mint", () => {
  it("splits content into adaptive chunks under one Merkle root", async () => {
    const store = new MemoryChunkStore();
    const m = await mintMediaCoinContent(
      { name: "clip.mp4", type: "video/mp4", size: 700_000, async *pieces() { yield bytes(700_000); } },
      "creator-1", store, { encrypt: true },
    );
    expect(m.chunkSize).toBe(256 * 1024);
    expect(m.totalChunks).toBe(3);
    expect(m.merkleRoot).toBe(await buildMerkleRoot(m.chunkHashes));
    expect(await store.isComplete(m.merkleRoot)).toBe(true);
    expect(await store.heldIndices(m.merkleRoot)).toEqual([0, 1, 2]);
  });

  it("picks 256 KB to 1 MB chunks by size", () => {
    expect(mediaCoinChunkSizeFor(1024)).toBe(256 * 1024);
    expect(mediaCoinChunkSizeFor(100 * 1024 * 1024)).toBe(512 * 1024);
    expect(mediaCoinChunkSizeFor(400 * 1024 * 1024)).toBe(1024 * 1024);
  });

  it("enforces the 500 MB cap shared with the upload limits", async () => {
    expect(MEDIA_COIN_PASS_MAX_BYTES).toBe(500 * 1024 * 1024);
    expect(SHARED_CAP).toBe(MEDIA_COIN_PASS_MAX_BYTES);
    const tooBig: MediaCoinSource = { name: "huge", type: "video/mp4", size: MEDIA_COIN_PASS_MAX_BYTES + 1, async *pieces() { /* never read */ } };
    await expect(mintMediaCoinContent(tooBig, "c", new MemoryChunkStore())).rejects.toThrow(/limited/);
  });
});

describe("courier pass", () => {
  it("streams the content to a new peer, verified, and loops home", async () => {
    const net = createNetwork();
    net.link("alice", "bob");
    net.link("bob", "alice");
    const alice = engineFor(net, "alice");
    const bob = engineFor(net, "bob");
    const got: Uint8Array[] = [];
    bob.onUnpack(async (u) => { got.push((await u.readBytes())!); });
    const home: string[][] = [];
    alice.onLoopComplete((l) => home.push(l.route.hops));

    const data = bytes(600_000);
    await alice.mint({ name: "a.bin", type: "application/octet-stream", data }, "alice", { encrypt: true, coinId: "mined-1" });
    expect(await alice.launch("mined-1")).toBe(true);
    await until(() => home.length > 0);

    expect(Array.from(got[0])).toEqual(Array.from(data));
    expect(home[0]).toEqual(["alice", "bob", "alice"]);
  });

  it("already-held sends 0 chunks", async () => {
    const net = createNetwork();
    net.link("alice", "bob");
    const shared = new MemoryChunkStore();
    const alice = engineFor(net, "alice", { store: shared });
    const m = await alice.mint({ name: "x", type: "text/plain", data: bytes(300_000) }, "alice", { coinId: "c1" });
    // Bob already holds the same content (same merkleRoot) in his own store.
    const bobStore = new MemoryChunkStore();
    await bobStore.putManifest(m, false);
    for (const i of await shared.heldIndices(m.merkleRoot)) await bobStore.putChunk(m.merkleRoot, i, (await shared.getChunk(m.merkleRoot, i))!);
    await bobStore.putManifest(m, true);
    const bob = engineFor(net, "bob", { store: bobStore });
    const held: string[] = [];
    bob.onAlreadyHeld((h) => { held.push(h.manifest.coinId); });

    await alice.launch("c1");
    await until(() => held.length > 0 && alice.getHeldCoinIds().length === 0);

    const replies = net.sent.filter((s) => s.from === "bob" && s.msg.type === "coin-pass-offer-reply").map((s) => s.msg.payload.reply);
    expect(replies).toEqual(["already-held"]);
    expect(chunksSent(net, "bob")).toHaveLength(0);
    expect(held).toEqual(["c1"]);
    expect(alice.getHeldCoinIds()).toEqual([]);
  });

  it("a refused root rejects any coinId carrying it, with 0 chunks", async () => {
    const net = createNetwork();
    net.link("alice", "bob");
    net.link("carol", "bob");
    const alice = engineFor(net, "alice");
    const m = await alice.mint({ name: "x", type: "text/plain", data: bytes(1000) }, "alice", { coinId: "orig" });
    // Carol holds the same content and supports it with her own coin.
    const carolStore = new MemoryChunkStore();
    await carolStore.putManifest(m, false);
    await carolStore.putChunk(m.merkleRoot, 0, (await alice.store.getChunk(m.merkleRoot, 0))!);
    await carolStore.putManifest(m, true);
    const carol = engineFor(net, "carol", { store: carolStore });
    const refused = new Set([m.merkleRoot]);
    const bob = engineFor(net, "bob", { isRefused: (r) => refused.has(r) });
    const got: string[] = [];
    bob.onUnpack((u) => { got.push(u.manifest.coinId); });

    await alice.launch("orig");
    await carol.adoptCoin("support-9", m.merkleRoot, { id: "carol", name: "Carol" });
    await carol.launch("support-9");
    const fromBob = () => net.sent.filter((s) => s.from === "bob" && s.msg.type === "coin-pass-offer-reply");
    await until(() => fromBob().length >= 2);

    expect(fromBob().map((s) => [s.to, s.msg.coinId, s.msg.payload.reply]).sort()).toEqual([
      ["alice", "orig", "refused"],
      ["carol", "support-9", "refused"],
    ]);
    expect(chunksSent(net, "bob")).toHaveLength(0);
    expect(got).toEqual([]);
  });

  it("a Support Coin carries the same content under its own coinId", async () => {
    const net = createNetwork();
    net.link("alice", "bob");
    const alice = engineFor(net, "alice");
    const orig = await alice.mint({ name: "x", type: "text/plain", data: bytes(2000) }, "alice", { coinId: "orig" });
    const support = await alice.adoptCoin("hollow-2", orig.merkleRoot, { id: "alice-user", name: "Alice" });
    expect(support!.coinId).toBe("hollow-2");
    expect(support!.coinId).not.toBe(orig.coinId);
    expect(support!.merkleRoot).toBe(orig.merkleRoot);
    expect(support!.supporter).toEqual({ id: "alice-user", name: "Alice" });

    const bob = engineFor(net, "bob");
    const arrivals: Array<{ coinId: string; root: string; supporter?: unknown }> = [];
    bob.onUnpack((u) => { arrivals.push({ coinId: u.manifest.coinId, root: u.manifest.merkleRoot }); });
    bob.onAlreadyHeld((h) => { arrivals.push({ coinId: h.manifest.coinId, root: h.manifest.merkleRoot, supporter: h.manifest.supporter }); });
    await alice.launch("orig");
    await until(() => arrivals.length > 0);
    const before = chunksSent(net, "bob").length;
    await alice.launch("hollow-2");
    await until(() => arrivals.length > 1);

    expect(arrivals.map((a) => a.coinId)).toEqual(["orig", "hollow-2"]);
    expect(new Set(arrivals.map((a) => a.root)).size).toBe(1);
    expect(arrivals[1].supporter).toEqual({ id: "alice-user", name: "Alice" });
    // Content is never re-sent to a peer already holding it.
    expect(chunksSent(net, "bob").length).toBe(before);
  });

  it("pacing waits while the link's buffered amount is above 128 KB", async () => {
    const net = createNetwork();
    net.link("alice", "bob");
    const alice = engineFor(net, "alice");
    const bob = engineFor(net, "bob");
    const got: string[] = [];
    bob.onUnpack((u) => { got.push(u.manifest.coinId); });
    await alice.mint({ name: "x", type: "text/plain", data: bytes(600_000) }, "alice", { coinId: "paced" });

    net.buffered.set("alice>bob", MEDIA_COIN_BUFFER_HIGH_WATER + 1);
    await alice.launch("paced");
    await until(() => net.sent.some((s) => s.msg.type === "coin-pass-offer-reply"));
    await new Promise((r) => setTimeout(r, 120));
    expect(chunksSent(net, "bob")).toHaveLength(0); // held back while the link is busy

    net.buffered.set("alice>bob", 0);
    await until(() => got.length > 0);
    expect(chunksSent(net, "bob").length).toBe(3);
    expect(got).toEqual(["paced"]);
  });

  it("resumes from the chunks the receiver already acknowledged", async () => {
    const net = createNetwork();
    net.link("alice", "bob");
    const alice = engineFor(net, "alice");
    const m = await alice.mint({ name: "x", type: "text/plain", data: bytes(700_000) }, "alice", { coinId: "r1" });
    const bobStore = new MemoryChunkStore();
    // Bob got chunk 0 before the link dropped.
    await bobStore.putManifest(m, false);
    await bobStore.putChunk(m.merkleRoot, 0, (await alice.store.getChunk(m.merkleRoot, 0))!);
    const bob = engineFor(net, "bob", { store: bobStore });
    const got: string[] = [];
    bob.onUnpack((u) => { got.push(u.manifest.coinId); });
    await alice.launch("r1");
    await until(() => got.length > 0);
    expect(chunksSent(net, "bob").map((s) => s.msg.payload.index)).toEqual([1, 2]);
  });

  it("drops a chunk whose hash does not match the manifest", async () => {
    const net = createNetwork();
    net.link("mallory", "bob");
    const bob = engineFor(net, "bob");
    const got: string[] = [];
    bob.onUnpack((u) => { got.push(u.manifest.coinId); });
    const store = new MemoryChunkStore();
    const m = await mintMediaCoinContent({ name: "x", type: "text/plain", size: 3, async *pieces() { yield new Uint8Array([1, 2, 3]); } }, "mallory", store, { coinId: "c2" });
    const t = net.transport("mallory");
    t.onMessage("media-coin", () => {});
    await t.send("media-coin", "bob", { type: "coin-pass-offer", coinId: "c2", payload: { offerId: "o1", merkleRoot: m.merkleRoot, size: 3, isSupport: false, manifest: m, route: { creatorId: "mallory", hops: ["mallory"], ttl: 4 } }, msgId: "m1" });
    await until(() => net.sent.some((s) => s.msg.type === "coin-pass-offer-reply"));
    await t.send("media-coin", "bob", { type: "coin-chunk", coinId: "c2", payload: { offerId: "o1", merkleRoot: m.merkleRoot, index: 0, data: btoa("forged") }, msgId: "m2" });
    await until(() => false, 200);
    expect(got).toEqual([]);
    expect(await bob.hasContent(m.merkleRoot)).toBe(false);
  });

  it("refuses an offer over the 500 MB cap and ignores retired whole-coin bursts", async () => {
    const net = createNetwork();
    net.link("mallory", "bob");
    const bob = engineFor(net, "bob");
    const hashes = ["a", "b"];
    const root = await buildMerkleRoot(hashes);
    const manifest = { coinId: "big", tokenId: "t", name: "big", mimeType: "video/mp4", totalSize: MEDIA_COIN_PASS_MAX_BYTES + 1, chunkSize: 1, totalChunks: 2, chunkHashes: hashes, merkleRoot: root, creatorId: "m", mintedAt: 0 };
    const t = net.transport("mallory");
    t.onMessage("media-coin", () => {});
    await t.send("media-coin", "bob", { type: "coin-pass-offer", coinId: "big", payload: { offerId: "o2", merkleRoot: root, size: manifest.totalSize, isSupport: false, manifest, route: { creatorId: "mallory", hops: ["mallory"], ttl: 2 } }, msgId: "m3" });
    await t.send("media-coin", "bob", { type: "coin-pass", coinId: "old", payload: { passId: "p", manifest, route: { creatorId: "mallory", hops: ["mallory"], ttl: 2 } }, msgId: "m4" });
    await until(() => net.sent.some((s) => s.msg.type === "coin-pass-offer-reply"));
    const replies = net.sent.filter((s) => s.msg.type === "coin-pass-offer-reply");
    expect(replies.map((r) => r.msg.payload.reply)).toEqual(["refused"]);
  });
});

describe("Merkle Tree", () => {
  it("builds roots and verifies proofs", async () => {
    expect(await buildMerkleRoot([])).toBe("");
    expect(await buildMerkleRoot(["only"])).toBe("only");
    const hashes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`leaf-${i}`));
      hashes.push(Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));
    }
    const root = await buildMerkleRoot(hashes);
    expect(root).toHaveLength(64);
    expect(await verifyMerkleProof(hashes[2], await buildMerkleProof(hashes, 2), root)).toBe(true);
  });
});
