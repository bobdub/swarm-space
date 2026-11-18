import { describe, it, expect, afterEach } from "vitest";
import {
  MediaCoinEngine,
  type MeshTransportAdapter,
  type MediaCoinUnpacked,
  type MediaCoinLoopComplete,
} from "../mediaCoin.standalone";

/** In-memory mesh: delivers messages synchronously-ish between engines. */
function createNetwork() {
  const handlers = new Map<string, (from: string, payload: unknown) => void>();
  const links = new Map<string, Set<string>>();
  const broadcasts: { from: string; payload: unknown }[] = [];
  const link = (a: string, b: string) => {
    if (!links.has(a)) links.set(a, new Set());
    if (!links.has(b)) links.set(b, new Set());
    links.get(a)!.add(b);
    links.get(b)!.add(a);
  };
  const transport = (id: string): MeshTransportAdapter => ({
    localPeerId: id,
    async send(_c, peerId, payload) {
      const h = handlers.get(peerId);
      if (!h || !links.get(id)?.has(peerId)) return false;
      const copy = JSON.parse(JSON.stringify(payload));
      queueMicrotask(() => h(id, copy));
      return true;
    },
    broadcast(_c, payload) { broadcasts.push({ from: id, payload }); },
    onMessage(_c, handler) { handlers.set(id, handler); return () => handlers.delete(id); },
    getConnectedPeerIds: () => Array.from(links.get(id) ?? []),
  });
  return { transport, link, broadcasts };
}

const settle = async () => { for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0)); };
const engines: MediaCoinEngine[] = [];
afterEach(() => { for (const e of engines.splice(0)) e.stop(); });

function engineFor(net: ReturnType<typeof createNetwork>, id: string) {
  const e = new MediaCoinEngine(net.transport(id));
  e.start();
  engines.push(e);
  return e;
}

describe("media coin loop", () => {
  it("carries the bytes peer to peer and loops back to its creator", async () => {
    const net = createNetwork();
    net.link("alice", "bob");
    net.link("bob", "carol");
    net.link("carol", "alice");
    const alice = engineFor(net, "alice");
    const bob = engineFor(net, "bob");
    const carol = engineFor(net, "carol");

    const unpacked: Array<{ at: string; u: MediaCoinUnpacked }> = [];
    bob.onUnpack((u) => { unpacked.push({ at: "bob", u }); });
    carol.onUnpack((u) => { unpacked.push({ at: "carol", u }); });
    const done: MediaCoinLoopComplete[] = [];
    alice.onLoopComplete((l) => done.push(l));

    const data = new Uint8Array(2_200_000).map((_, i) => i % 251);
    const manifest = await alice.mint({ name: "clip.mp4", type: "video/mp4", data }, "alice", { encrypt: true, coinId: "mined-7" });
    expect(manifest.coinId).toBe("mined-7");
    expect(alice.launch("mined-7")).toBe(true);
    await settle();

    expect(unpacked.map((x) => x.at)).toEqual(["bob", "carol"]);
    for (const { u } of unpacked) expect(Array.from(u.bytes)).toEqual(Array.from(data));
    expect(done).toHaveLength(1);
    expect(done[0].route.hops).toEqual(["alice", "bob", "carol", "alice"]);
    expect(bob.hasAllChunks("mined-7")).toBe(true);
  });

  it("holds the coin until a new peer connects", async () => {
    const net = createNetwork();
    const alice = engineFor(net, "alice");
    const bob = engineFor(net, "bob");
    const got: string[] = [];
    bob.onUnpack((u) => { got.push(u.manifest.coinId); });

    await alice.mint({ name: "a.txt", type: "text/plain", data: new Uint8Array([1, 2, 3]) }, "alice", { coinId: "c1" });
    alice.launch("c1");
    await settle();
    expect(alice.getHeldCoinIds()).toEqual(["c1"]);

    net.link("alice", "bob");
    (alice as unknown as { retryHeld(): void }).retryHeld();
    await settle();
    expect(got).toEqual(["c1"]);
  });

  it("rejects a coin whose bytes do not match its manifest", async () => {
    const net = createNetwork();
    net.link("mallory", "bob");
    const bob = engineFor(net, "bob");
    const forger = engineFor(net, "mallory");
    const got: string[] = [];
    bob.onUnpack((u) => { got.push(u.manifest.coinId); });

    const manifest = await forger.mint({ name: "x", type: "text/plain", data: new Uint8Array([9, 9, 9]) }, "mallory", { coinId: "c2" });
    const t = net.transport("mallory");
    await t.send("media-coin", "bob", { type: "coin-pass", coinId: "c2", payload: { passId: "p1", manifest, route: { creatorId: "mallory", hops: ["mallory"], ttl: 4 } }, msgId: "m1" });
    await t.send("media-coin", "bob", { type: "coin-pass-piece", coinId: "c2", payload: { passId: "p1", chunk: { index: 0, hash: "h", data: btoa("forged"), size: 6, priority: true } }, msgId: "m2" });
    await settle();
    expect(got).toEqual([]);
  });

  it("never broadcasts the decryption key", async () => {
    const net = createNetwork();
    const alice = engineFor(net, "alice");
    const m = await alice.mint({ name: "s", type: "text/plain", data: new Uint8Array([1]) }, "alice", { encrypt: true });
    alice.relay(m);
    const announce = net.broadcasts.find((b) => (b.payload as { type: string }).type === "coin-announce")!;
    expect((announce.payload as { payload: Record<string, unknown> }).payload.encryptionKey).toBeUndefined();
  });
});
