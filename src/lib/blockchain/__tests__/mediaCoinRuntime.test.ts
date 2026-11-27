import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";

const stores = new Map<string, Map<string, unknown>>();
const s = (n: string) => {
  if (!stores.has(n)) stores.set(n, new Map());
  return stores.get(n)!;
};
const keyOf = (n: string, v: Record<string, unknown>) => (n === "swarmCoins" ? v.coinId : v.id) as string;

vi.mock("@/lib/store", () => ({
  put: async (n: string, v: Record<string, unknown>) => { s(n).set(keyOf(n, v), v); },
  get: async (n: string, k: string) => s(n).get(k),
  getAll: async (n: string) => Array.from(s(n).values()),
  remove: async (n: string, k: string) => { s(n).delete(k); },
}));

// Media Coin posting must never reach the torrent store.
const torrentCalls: string[] = [];
vi.mock("@/lib/fileEncryption", () => ({
  importFileKey: async () => { torrentCalls.push("importFileKey"); throw new Error("torrent store touched"); },
  deleteManifest: async () => { torrentCalls.push("deleteManifest"); },
  chunkAndEncryptFile: async () => { torrentCalls.push("chunkAndEncryptFile"); throw new Error("torrent store touched"); },
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
  recoverInterruptedReservations,
  MEDIA_COIN_RESERVATION_STALE_MS,
} from "../mediaCoinRuntime";
import { getMediaCoinContent, _resetMediaCoinContentStoreForTest } from "../mediaCoinContentStore";
import { isMediaCoinRefused, _resetRefusedMediaCoinsForTest } from "../refusedMediaCoinsStore";

/** A file the user attached, held raw (never written to the torrent store). */
function attached(name: string, data: Uint8Array) {
  return { file: new File([data], `${name}.mp4`, { type: "video/mp4" }) };
}

/** A file whose bytes can no longer be read (e.g. it was moved on disk). */
function unreadable(name: string, size: number) {
  const blob = new Blob([new Uint8Array(size)], { type: "video/mp4" });
  blob.slice = () => ({ arrayBuffer: () => Promise.reject(new Error(`${name} missing`)) }) as unknown as Blob;
  return { file: blob, name: `${name}.mp4` };
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
  torrentCalls.length = 0;
  localStorage.clear();
  lockRuns.length = 0;
  await _resetMediaCoinContentStoreForTest();
  _resetRefusedMediaCoinsForTest();
});

describe("mediaCoinRuntime courier mode", () => {
  it("publishes a post's files as Media Coins straight from the file, never through the torrent store", async () => {
    coin("hollow-1");
    const data = new Uint8Array(300_000).map((_, i) => i % 199);
    const file = attached("file-a", data);

    const prepared = await prepareCourierFiles([file], { postId: "post-1", creatorId: "user-alice" });
    // Nothing launched until the post is saved.
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
    expect(rec?.name ?? refs[0].name).toBe("file-a.mp4");
    expect(torrentCalls).toEqual([]);
    expect(s("manifests").size).toBe(0);
    expect(s("chunks").size).toBe(0);
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
    const file = attached("file-b", new Uint8Array(5000).fill(7));
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
    const file = attached("file-c", new Uint8Array(100).fill(1));
    const prepared = await prepareCourierFiles([file], { postId: "post-3", creatorId: "user-alice" });
    await prepared.commit();
    // The content packer loaded this coin after the snapshot was taken.
    coin("busy", { payloadEntries: [{ hash: "h" }] });
    await expect(supportMediaCoin(prepared.refs[0].merkleRoot)).rejects.toThrow(/hollow coin/);
    expect(coinAt("busy").kind).toBeUndefined();
  });

  it("Delete Sync removes the local copy and refuses the content", async () => {
    const file = attached("file-d", new Uint8Array(100).fill(2));
    const prepared = await prepareCourierFiles([file], { postId: "post-4", creatorId: "user-alice" });
    await prepared.commit();
    const [ref] = prepared.refs;
    await deleteMediaCoinSync(ref.merkleRoot);
    expect(await getMediaCoinContent(ref.merkleRoot)).toBeNull();
    expect(isMediaCoinRefused(ref.merkleRoot)).toBe(true);
    expect(localStorage.getItem("media-coin-pending-launches-v2")).toBeNull();
  });

  it("a failed file gives the coins back and drops packed content, so the post can be retried", async () => {
    coin("hollow-1");
    coin("hollow-2");
    const good = attached("file-e", new Uint8Array(4000).fill(3));
    const bad = unreadable("file-f", 4000);

    await expect(prepareCourierFiles([good, bad], { postId: "post-5", creatorId: "user-alice" })).rejects.toThrow(/missing/);

    expect(torrentCalls).toEqual([]);
    expect(coinAt("hollow-1").kind).toBeUndefined();
    expect(coinAt("hollow-2").kind).toBeUndefined();
    expect(localStorage.getItem("media-coin-pending-launches-v2")).toBeNull();

    // Retry once the file can be read again.
    const fixed = attached("file-f", new Uint8Array(4000).fill(4));
    const prepared = await prepareCourierFiles([good, fixed], { postId: "post-5", creatorId: "user-alice" });
    expect(prepared.refs).toHaveLength(2);
  });

  it("abort before the post is saved releases the reserved coin and drops the packed content", async () => {
    coin("hollow-1");
    const file = attached("file-g", new Uint8Array(1000).fill(5));
    const prepared = await prepareCourierFiles([file], { postId: "post-6", creatorId: "user-alice" });
    await prepared.abort();
    expect(coinAt("hollow-1").kind).toBeUndefined();
    expect(await getMediaCoinContent(prepared.refs[0].merkleRoot)).toBeNull();
    expect(torrentCalls).toEqual([]);
  });

  it("gives back a coin whose reservation was interrupted, and leaves a fresh one alone", async () => {
    const now = Date.now();
    coin("stale", { kind: "media", mediaRole: "courier", mediaReservation: { at: now - MEDIA_COIN_RESERVATION_STALE_MS - 1, prev: { kind: undefined, fillState: undefined } } });
    coin("fresh", { kind: "media", mediaRole: "courier", mediaReservation: { at: now, prev: {} } });
    coin("engraved", { kind: "media", mediaRole: "courier", mediaContentRoot: "root-x" });

    expect(await recoverInterruptedReservations(now)).toBe(1);
    expect(coinAt("stale").kind).toBeUndefined();
    expect(coinAt("stale").mediaReservation).toBeUndefined();
    expect(coinAt("fresh").kind).toBe("media");
    expect(coinAt("engraved").mediaContentRoot).toBe("root-x");
  });

  it("never releases a reservation a running pack still holds", async () => {
    coin("hollow-1");
    const file = attached("file-h", new Uint8Array(1000).fill(6));
    const prepared = await prepareCourierFiles([file], { postId: "post-7", creatorId: "user-alice" });
    expect(await recoverInterruptedReservations(Date.now() + MEDIA_COIN_RESERVATION_STALE_MS * 2)).toBe(0);
    await prepared.commit();
    expect(coinAt("hollow-1")).toMatchObject({ kind: "media", mediaContentRoot: prepared.refs[0].merkleRoot });
    expect(coinAt("hollow-1").mediaReservation).toBeUndefined();
  });

  it("clears the retired whole-coin launch queue at start", () => {
    localStorage.setItem("media-coin-pending-launches", JSON.stringify([{ walletCoinId: "x", file: { contentHash: "x" } }]));
    startMediaCoinRuntime(transport([]));
    expect(localStorage.getItem("media-coin-pending-launches")).toBeNull();
  });
});
