import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";

const stores = new Map<string, Map<string, unknown>>();
const s = (n: string) => {
  if (!stores.has(n)) stores.set(n, new Map());
  return stores.get(n)!;
};
const keyOf = (n: string, v: Record<string, unknown>) =>
  (n === "manifests" ? v.fileId : n === "chunks" ? v.ref : n === "swarmCoins" ? v.coinId : v.id) as string;

vi.mock("@/lib/store", () => ({
  put: async (n: string, v: Record<string, unknown>) => { s(n).set(keyOf(n, v), v); },
  get: async (n: string, k: string) => s(n).get(k),
  getAll: async (n: string) => Array.from(s(n).values()),
  remove: async (n: string, k: string) => { s(n).delete(k); },
}));

let fileKey: CryptoKey;
const deleted: string[] = [];
vi.mock("@/lib/fileEncryption", () => ({
  importFileKey: async () => fileKey,
  deleteManifest: async (id: string) => { deleted.push(id); s("manifests").delete(id); },
}));

const isHollow = (c: Record<string, unknown>, userId: string) =>
  c.ownerId === userId && c.status === "wallet" && c.kind !== "media" && !((c.payloadEntries as unknown[] | undefined)?.length);
vi.mock("../mediaCoinWrapSweep", () => ({
  isHollowWalletCoin: isHollow,
  freeMinedWalletCoins: async () => Array.from(s("swarmCoins").values()).filter((c) => isHollow(c as Record<string, unknown>, "user-alice")),
}));

const lockRuns: string[] = [];
vi.mock("../contentPayload", () => ({
  withEngravingLock: async (userId: string, task: () => Promise<unknown>) => { lockRuns.push(userId); return task(); },
}));

const coin = (coinId: string, extra: Record<string, unknown> = {}) => {
  s("swarmCoins").set(coinId, { coinId, ownerId: "user-alice", status: "wallet", ...extra });
};
const coinAt = (coinId: string) => s("swarmCoins").get(coinId) as Record<string, unknown>;

vi.mock("@/lib/auth", () => ({
  getCurrentUser: () => ({ id: "user-alice", username: "alice", displayName: "Alice" }),
}));

import type { MeshTransportAdapter } from "../mediaCoin.standalone";
import {
  startMediaCoinRuntime,
  stopMediaCoinRuntime,
  prepareCourierFiles,
  supportMediaCoin,
  deleteMediaCoinSync,
} from "../mediaCoinRuntime";
import { getMediaCoinContent, _resetMediaCoinContentStoreForTest } from "../mediaCoinContentStore";
import { isMediaCoinRefused, _resetRefusedMediaCoinsForTest } from "../refusedMediaCoinsStore";

const b64 = (u: Uint8Array) => {
  let out = "";
  for (let i = 0; i < u.length; i += 8192) out += String.fromCharCode(...u.subarray(i, i + 8192));
  return btoa(out);
};

/** A post file in the torrent store: two encrypted chunks. */
async function torrentFile(fileId: string, data: Uint8Array) {
  const half = Math.ceil(data.byteLength / 2);
  const refs: string[] = [];
  for (const [i, part] of [data.subarray(0, half), data.subarray(half)].entries()) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, fileKey, part));
    const ref = `chunk-${fileId}-${i}`;
    s("chunks").set(ref, { ref, seq: i, iv: b64(iv), cipher: b64(cipher) });
    refs.push(ref);
  }
  const manifest = { fileId, chunks: refs, mime: "video/mp4", size: data.byteLength, originalName: `${fileId}.mp4`, createdAt: "" };
  s("manifests").set(fileId, manifest);
  return manifest;
}

function transport(sent: Array<{ type: string; coinId: string }>): MeshTransportAdapter {
  return {
    localPeerId: "peer-me",
    async send(_c, _p, payload) { sent.push(payload as { type: string; coinId: string }); return true; },
    broadcast() {},
    onMessage() { return () => {}; },
    getConnectedPeerIds: () => ["peer-bob"],
  };
}

beforeEach(async () => {
  stopMediaCoinRuntime();
  stores.clear();
  deleted.length = 0;
  localStorage.clear();
  lockRuns.length = 0;
  fileKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  await _resetMediaCoinContentStoreForTest();
  _resetRefusedMediaCoinsForTest();
});

describe("mediaCoinRuntime courier mode", () => {
  it("publishes a post's files as Media Coins on a hollow coin and drops the torrent copy", async () => {
    coin("hollow-1");
    const data = new Uint8Array(300_000).map((_, i) => i % 199);
    const file = await torrentFile("file-a", data);

    const prepared = await prepareCourierFiles([file], { postId: "post-1", creatorId: "user-alice" });
    // Nothing destructive until the post is saved.
    expect(deleted).toEqual([]);
    expect(localStorage.getItem("media-coin-pending-launches-v2")).toBeNull();
    expect(coinAt("hollow-1")).toMatchObject({ kind: "media", mediaRole: "courier" }); // reserved
    await prepared.commit();
    const refs = prepared.refs;

    expect(refs).toHaveLength(1);
    const rec = await getMediaCoinContent(refs[0].merkleRoot);
    expect(rec?.complete).toBe(true);
    expect(rec?.postId).toBe("post-1");
    expect(rec?.coinIds).toEqual(["hollow-1"]);
    expect(rec?.createdBySelf).toBe(true);
    expect(deleted).toEqual(["file-a"]);
    expect(coinAt("hollow-1")).toMatchObject({ kind: "media", mediaRole: "courier", mediaContentRoot: refs[0].merkleRoot, fillState: "sealed" });
    expect(lockRuns.length).toBeGreaterThan(0);

    // Queued until the mesh is up, then offered (never as a torrent).
    expect(localStorage.getItem("media-coin-pending-launches-v2")).toContain("hollow-1");
    const sent: Array<{ type: string; coinId: string }> = [];
    startMediaCoinRuntime(transport(sent));
    await vi.waitFor(() => expect(sent.some((m) => m.type === "coin-pass-offer" && m.coinId === "hollow-1")).toBe(true));
    expect(sent.some((m) => m.type === "coin-pass")).toBe(false);
  });

  it("support coin uses a different coinId than the original and records the supporter", async () => {
    coin("hollow-1");
    const file = await torrentFile("file-b", new Uint8Array(5000).fill(7));
    const prepared = await prepareCourierFiles([file], { postId: "post-2", creatorId: "user-alice" });
    await prepared.commit();
    const [ref] = prepared.refs;
    coin("hollow-2");

    const { coinId } = await supportMediaCoin(ref.merkleRoot);

    expect(coinId).toBe("hollow-2");
    const rec = await getMediaCoinContent(ref.merkleRoot);
    expect(rec?.coinIds).toEqual(["hollow-1", "hollow-2"]);
    expect(rec?.supporters).toEqual([expect.objectContaining({ coinId: "hollow-2", supporterId: "user-alice", name: "Alice" })]);
    expect(coinAt("hollow-2")).toMatchObject({ kind: "media", mediaRole: "support", mediaContentRoot: ref.merkleRoot });
  });

  it("support coin is refused without a hollow coin", async () => {
    const file = await torrentFile("file-c", new Uint8Array(100).fill(1));
    const prepared = await prepareCourierFiles([file], { postId: "post-3", creatorId: "user-alice" });
    await prepared.commit();
    // The content packer loaded this coin after the snapshot was taken.
    coin("busy", { payloadEntries: [{ hash: "h" }] });
    await expect(supportMediaCoin(prepared.refs[0].merkleRoot)).rejects.toThrow(/hollow coin/);
    expect(coinAt("busy").kind).toBeUndefined();
  });

  it("Delete Sync removes the local copy and refuses the content", async () => {
    const file = await torrentFile("file-d", new Uint8Array(100).fill(2));
    const prepared = await prepareCourierFiles([file], { postId: "post-4", creatorId: "user-alice" });
    await prepared.commit();
    const [ref] = prepared.refs;
    await deleteMediaCoinSync(ref.merkleRoot);
    expect(await getMediaCoinContent(ref.merkleRoot)).toBeNull();
    expect(isMediaCoinRefused(ref.merkleRoot)).toBe(true);
    expect(localStorage.getItem("media-coin-pending-launches-v2")).toBeNull();
  });

  it("a failed file keeps every torrent copy and gives the coins back, so the post can be retried", async () => {
    coin("hollow-1");
    coin("hollow-2");
    const good = await torrentFile("file-e", new Uint8Array(4000).fill(3));
    const bad = await torrentFile("file-f", new Uint8Array(4000).fill(4));
    s("chunks").delete(bad.chunks[1]);

    await expect(prepareCourierFiles([good, bad], { postId: "post-5", creatorId: "user-alice" })).rejects.toThrow(/missing/);

    expect(deleted).toEqual([]);
    expect(s("manifests").has("file-e")).toBe(true);
    expect(coinAt("hollow-1").kind).toBeUndefined();
    expect(coinAt("hollow-2").kind).toBeUndefined();
    expect(localStorage.getItem("media-coin-pending-launches-v2")).toBeNull();

    // Retry with the same attachments once the chunk is back.
    const fixed = await torrentFile("file-f", new Uint8Array(4000).fill(4));
    const prepared = await prepareCourierFiles([good, fixed], { postId: "post-5", creatorId: "user-alice" });
    expect(prepared.refs).toHaveLength(2);
  });

  it("abort before the post is saved releases the reserved coin and drops the packed content", async () => {
    coin("hollow-1");
    const file = await torrentFile("file-g", new Uint8Array(1000).fill(5));
    const prepared = await prepareCourierFiles([file], { postId: "post-6", creatorId: "user-alice" });
    await prepared.abort();
    expect(coinAt("hollow-1").kind).toBeUndefined();
    expect(await getMediaCoinContent(prepared.refs[0].merkleRoot)).toBeNull();
    expect(deleted).toEqual([]);
  });

  it("clears the retired whole-coin launch queue at start", () => {
    localStorage.setItem("media-coin-pending-launches", JSON.stringify([{ walletCoinId: "x", file: { contentHash: "x" } }]));
    startMediaCoinRuntime(transport([]));
    expect(localStorage.getItem("media-coin-pending-launches")).toBeNull();
  });
});
