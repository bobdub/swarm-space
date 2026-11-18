import { describe, it, expect, vi, beforeEach } from "vitest";

const stores = new Map<string, Map<string, unknown>>();
const s = (n: string) => {
  if (!stores.has(n)) stores.set(n, new Map());
  return stores.get(n)!;
};

vi.mock("@/lib/store", () => ({
  put: async (n: string, v: { peerId?: string }) => { s(n).set(v.peerId as string, v); },
  get: async (n: string, k: string) => s(n).get(k),
  getAll: async (n: string) => Array.from(s(n).values()),
  remove: async (n: string, k: string) => { s(n).delete(k); },
  getChunk: async () => null,
}));

let stored = 0;
vi.mock("@/lib/fileEncryption", () => ({
  genFileKey: async () => ({}) as CryptoKey,
  chunkAndEncryptFile: async () => ({ fileId: `file-${++stored}` }),
  importFileKey: async () => ({}) as CryptoKey,
  decryptAndReassembleFile: async () => new Blob([new Uint8Array([1, 2, 3])]),
}));

import { MediaCoinEngine, type MeshTransportAdapter, type MediaCoinUnpacked } from "../mediaCoin.standalone";
import { startMediaCoinRuntime, stopMediaCoinRuntime, launchMediaCoinLoop, unpackedContentHash } from "../mediaCoinRuntime";
import { listAwaitingFiles } from "../syncVault";

const transport = (sent: unknown[]): MeshTransportAdapter => ({
  localPeerId: "me",
  async send(_c, _p, payload) { sent.push(payload); return true; },
  broadcast() {},
  onMessage() { return () => {}; },
  getConnectedPeerIds: () => ["bob"],
});

beforeEach(() => {
  stores.clear();
  stored = 0;
  localStorage.clear();
  stopMediaCoinRuntime();
});

describe("mediaCoinRuntime", () => {
  it("queues a launch made before the mesh is online and runs it at start", async () => {
    s("manifests").set("file-a", { fileId: "file-a", chunks: ["c"] });
    expect(await launchMediaCoinLoop("mined-9", { ref: "file-a", contentHash: "file-a", name: "a.bin" })).toBe(false);
    expect(localStorage.getItem("media-coin-pending-launches")).toContain("mined-9");

    const sent: Array<{ type: string; coinId: string }> = [];
    startMediaCoinRuntime(transport(sent as unknown[]));
    await vi.waitFor(() => expect(sent.some((m) => m.type === "coin-pass" && m.coinId === "mined-9")).toBe(true));
    expect(localStorage.getItem("media-coin-pending-launches")).toBeNull();
    stopMediaCoinRuntime();
  });

  it("stores a coin's content only once however often it arrives", async () => {
    const listeners: Array<(u: MediaCoinUnpacked) => Promise<void> | void> = [];
    const spy = vi.spyOn(MediaCoinEngine.prototype, "onUnpack").mockImplementation((cb) => { listeners.push(cb); return () => {}; });
    startMediaCoinRuntime(transport([]));
    const u = {
      manifest: { coinId: "c", merkleRoot: "root-1", name: "x", mimeType: "text/plain", totalSize: 3 },
      route: { creatorId: "peer-alice", hops: ["peer-alice"], ttl: 3 },
      fromPeerId: "peer-alice",
      bytes: new Uint8Array([1, 2, 3]),
    } as unknown as MediaCoinUnpacked;
    await listeners[0](u);
    await listeners[0](u);
    expect(stored).toBe(1);
    const awaiting = await listAwaitingFiles();
    expect(awaiting.map((a) => a.file.contentHash)).toEqual([unpackedContentHash("root-1")]);
    spy.mockRestore();
    stopMediaCoinRuntime();
  });
});
