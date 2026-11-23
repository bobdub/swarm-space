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

let copies = 0;
vi.mock("@/lib/fileEncryption", () => ({
  genFileKey: async () => ({}) as CryptoKey,
  chunkAndEncryptFile: async () => ({ fileId: `copy-${++copies}` }),
}));

let fillStatus: "complete" | "partial" | "flushed" | "invalid" = "complete";
const fill = vi.fn(async (b: { fileId: string }) => ({ fileId: b.fileId, status: fillStatus, had: 1, filled: 2, mismatched: 0, total: 3 }));
vi.mock("../mediaCoinTorrentFill", () => ({
  fillTorrentFromCoin: (b: { fileId: string }) => fill(b),
  buildTorrentBinding: async () => null,
}));

import { MediaCoinEngine, type MeshTransportAdapter, type MediaCoinUnpacked } from "../mediaCoin.standalone";
import { startMediaCoinRuntime, stopMediaCoinRuntime } from "../mediaCoinRuntime";
import { listAwaitingFiles } from "../syncVault";

const transport: MeshTransportAdapter = {
  localPeerId: "me",
  async send() { return true; },
  broadcast() {},
  onMessage() { return () => {}; },
  getConnectedPeerIds: () => [],
};

const coin = (root: string) => ({
  manifest: {
    coinId: "c", merkleRoot: root, name: "song.m4a", mimeType: "audio/mp4", totalSize: 10,
    torrent: { fileId: "file-post", manifest: {}, chunkIvs: [], chunkSizes: [] },
  },
  route: { creatorId: "peer-alice", hops: ["peer-alice"], ttl: 3 },
  fromPeerId: "peer-alice",
  bytes: new Uint8Array(10),
}) as unknown as MediaCoinUnpacked;

async function arrive(u: MediaCoinUnpacked) {
  const listeners: Array<(u: MediaCoinUnpacked) => Promise<void> | void> = [];
  const spy = vi.spyOn(MediaCoinEngine.prototype, "onUnpack").mockImplementation((cb) => { listeners.push(cb); return () => {}; });
  startMediaCoinRuntime(transport);
  await listeners[0](u);
  spy.mockRestore();
  stopMediaCoinRuntime();
}

beforeEach(() => {
  stores.clear();
  localStorage.clear();
  copies = 0;
  fill.mockClear();
  stopMediaCoinRuntime();
});

describe("media coin arriving for a post's torrent", () => {
  it("completes the post's torrent and points the vault at it, with no second copy", async () => {
    fillStatus = "complete";
    await arrive(coin("root-a"));
    expect(fill).toHaveBeenCalledTimes(1);
    expect(copies).toBe(0);
    const awaiting = await listAwaitingFiles();
    expect(awaiting.map((a) => a.file.ref)).toEqual(["file-post"]);
  });

  it("stores nothing for a file the user flushed", async () => {
    fillStatus = "flushed";
    await arrive(coin("root-b"));
    expect(copies).toBe(0);
    expect(await listAwaitingFiles()).toEqual([]);
  });

  it("falls back to its own copy when the torrent could not be matched", async () => {
    fillStatus = "invalid";
    await arrive(coin("root-c"));
    expect(copies).toBe(1);
  });
});
