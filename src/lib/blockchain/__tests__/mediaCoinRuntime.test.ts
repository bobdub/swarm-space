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
  encryptCourierFile,
  discardCourierFile,
  prepareCourierFiles,
  supportMediaCoin,
  deleteMediaCoinSync,
  recoverInterruptedReservations,
  MEDIA_COIN_RESERVATION_STALE_MS,
  MEDIA_COIN_DRAFT_STALE_MS,
} from "../mediaCoinRuntime";
import {
  getMediaCoinContent,
  mediaCoinContentStore,
  sweepMediaCoinDrafts,
  refreshMediaCoinContents,
  listMediaCoinContents,
  _resetMediaCoinContentStoreForTest,
} from "../mediaCoinContentStore";
import { mintMediaCoinContent, mediaCoinSourceOf } from "../mediaCoin.standalone";
import { isMediaCoinRefused, _resetRefusedMediaCoinsForTest } from "../refusedMediaCoinsStore";

/** A file the user just attached. */
const attachedFile = (name: string, data: Uint8Array) => new File([data], `${name}.mp4`, { type: "video/mp4" });

/** Attach: encrypted into the Media Coin store as it uploads. */
const attach = (name: string, data: Uint8Array) => encryptCourierFile(attachedFile(name, data), { creatorId: "user-alice" });

/** Attach, then publish as `postId`. */
async function publish(name: string, data: Uint8Array, postId: string) {
  const ref = await attach(name, data);
  const prepared = await prepareCourierFiles([ref], { postId, creatorId: "user-alice" });
  await prepared.commit();
  return ref;
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
  it("encrypts a file into the Media Coin store as it is attached, never through the torrent store", async () => {
    const data = new Uint8Array(300_000).map((_, i) => i % 199);
    const ref = await attach("file-a", data);

    const rec = await getMediaCoinContent(ref.merkleRoot);
    expect(rec?.complete).toBe(true);
    expect(rec?.draft).toBe(true);
    expect(rec?.manifest.encryptionKey).toBeTruthy();
    // Ciphertext at rest, not the plaintext.
    const first = await mediaCoinContentStore.getChunk(ref.merkleRoot, 0);
    expect(atob(first!).slice(0, 32)).not.toBe(String.fromCharCode(...data.subarray(0, 32)));
    // A draft is not offered, launched or listed before Publish.
    expect(await mediaCoinContentStore.isComplete(ref.merkleRoot)).toBe(false);
    await refreshMediaCoinContents();
    expect(listMediaCoinContents()).toEqual([]);
    expect(localStorage.getItem("media-coin-pending-launches-v2")).toBeNull();
    expect(torrentCalls).toEqual([]);
    expect(s("manifests").size + s("chunks").size).toBe(0);
  });

  it("publishes the encrypted draft on a hollow coin and launches it as a Media Coin", async () => {
    coin("hollow-1");
    const ref = await attach("file-a", new Uint8Array(300_000).map((_, i) => i % 199));

    const prepared = await prepareCourierFiles([ref], { postId: "post-1", creatorId: "user-alice" });
    // Reserved, and the reservation is persisted on the coin so a reload can give it back.
    expect(coinAt("hollow-1")).toMatchObject({ kind: "media", mediaRole: "courier", mediaReservation: expect.objectContaining({ prev: expect.any(Object) }) });
    expect(localStorage.getItem("media-coin-pending-launches-v2")).toBeNull();
    await prepared.commit();

    const rec = await getMediaCoinContent(ref.merkleRoot);
    expect(rec?.draft).toBeUndefined();
    expect(rec?.postId).toBe("post-1");
    expect(rec?.coinIds).toEqual(["hollow-1"]);
    expect(rec?.manifest.coinId).toBe("hollow-1");
    expect(rec?.createdBySelf).toBe(true);
    expect(coinAt("hollow-1")).toMatchObject({ kind: "media", mediaRole: "courier", mediaContentRoot: ref.merkleRoot, fillState: "sealed" });
    expect(lockRuns.length).toBeGreaterThan(0);
    expect(torrentCalls).toEqual([]);

    // Queued until the mesh is up, then offered (never as a torrent).
    expect(localStorage.getItem("media-coin-pending-launches-v2")).toContain("hollow-1");
    const sent: Array<{ type: string; coinId: string }> = [];
    startMediaCoinRuntime(transport(sent));
    await vi.waitFor(() => expect(sent.some((m) => m.type === "coin-pass-offer" && m.coinId === "hollow-1")).toBe(true));
    expect(sent.some((m) => m.type === "coin-pass")).toBe(false);
  });

  it("the publisher refuses content that is not encrypted or not held", async () => {
    const plain = await mintMediaCoinContent(mediaCoinSourceOf(attachedFile("plain", new Uint8Array(500).fill(9))), "user-alice", mediaCoinContentStore, { encrypt: false });
    const plainRef = { merkleRoot: plain.merkleRoot, name: "plain.mp4", mime: "video/mp4", size: 500 };
    await expect(prepareCourierFiles([plainRef], { postId: "p", creatorId: "user-alice" })).rejects.toThrow(/not encrypted/);
    const missing = { merkleRoot: "nope", name: "gone.mp4", mime: "video/mp4", size: 10 };
    await expect(prepareCourierFiles([missing], { postId: "p", creatorId: "user-alice" })).rejects.toThrow(/not encrypted/);
  });

  it("support coin uses a different coinId than the original and records the supporter", async () => {
    coin("hollow-1");
    const ref = await publish("file-b", new Uint8Array(5000).fill(7), "post-2");
    coin("hollow-2");

    const { coinId } = await supportMediaCoin(ref.merkleRoot);

    expect(coinId).toBe("hollow-2");
    const rec = await getMediaCoinContent(ref.merkleRoot);
    expect(rec?.coinIds).toEqual(["hollow-1", "hollow-2"]);
    expect(rec?.supporters).toEqual([expect.objectContaining({ coinId: "hollow-2", supporterId: "user-alice", name: "Alice" })]);
    expect(coinAt("hollow-2")).toMatchObject({ kind: "media", mediaRole: "support", mediaContentRoot: ref.merkleRoot });
  });

  it("support coin is refused without a hollow coin", async () => {
    const ref = await publish("file-c", new Uint8Array(100).fill(1), "post-3");
    // The content packer loaded this coin after the snapshot was taken.
    coin("busy", { payloadEntries: [{ hash: "h" }] });
    await expect(supportMediaCoin(ref.merkleRoot)).rejects.toThrow(/hollow coin/);
    expect(coinAt("busy").kind).toBeUndefined();
  });

  it("Delete Sync removes the local copy and refuses the content", async () => {
    const ref = await publish("file-d", new Uint8Array(100).fill(2), "post-4");
    await deleteMediaCoinSync(ref.merkleRoot);
    expect(await getMediaCoinContent(ref.merkleRoot)).toBeNull();
    expect(isMediaCoinRefused(ref.merkleRoot)).toBe(true);
    expect(localStorage.getItem("media-coin-pending-launches-v2")).toBeNull();
  });

  it("a file that can't be read fails at attach time and leaves nothing behind", async () => {
    const blob = new Blob([new Uint8Array(4000)], { type: "video/mp4" });
    blob.slice = () => ({ arrayBuffer: () => Promise.reject(new Error("file-f missing")) }) as unknown as Blob;
    await expect(encryptCourierFile(blob, { creatorId: "user-alice", name: "file-f.mp4" })).rejects.toThrow(/missing/);
    await refreshMediaCoinContents();
    expect(listMediaCoinContents()).toEqual([]);
    expect(torrentCalls).toEqual([]);
  });

  it("abort gives the coins back and keeps the encrypted drafts for a retry", async () => {
    coin("hollow-1");
    const ref = await attach("file-g", new Uint8Array(1000).fill(5));
    const prepared = await prepareCourierFiles([ref], { postId: "post-6", creatorId: "user-alice" });
    await prepared.abort();
    expect(coinAt("hollow-1").kind).toBeUndefined();
    expect((await getMediaCoinContent(ref.merkleRoot))?.draft).toBe(true);

    const retry = await prepareCourierFiles([ref], { postId: "post-6", creatorId: "user-alice" });
    await retry.commit();
    expect((await getMediaCoinContent(ref.merkleRoot))?.coinIds).toEqual(["hollow-1"]);
  });

  it("removing an attachment drops its draft but never published content", async () => {
    const draft = await attach("file-x", new Uint8Array(800).fill(8));
    await discardCourierFile(draft.merkleRoot);
    expect(await getMediaCoinContent(draft.merkleRoot)).toBeNull();

    const posted = await publish("file-y", new Uint8Array(800).fill(9), "post-y");
    await discardCourierFile(posted.merkleRoot);
    expect(await getMediaCoinContent(posted.merkleRoot)).not.toBeNull();
  });

  it("sweeps drafts left by a composer that was closed without posting", async () => {
    const old = await attach("file-old", new Uint8Array(300).fill(1));
    const posted = await publish("file-posted", new Uint8Array(300).fill(2), "post-z");
    const later = Date.now() + MEDIA_COIN_DRAFT_STALE_MS + 1;
    expect(await sweepMediaCoinDrafts(MEDIA_COIN_DRAFT_STALE_MS, later)).toBe(1);
    expect(await getMediaCoinContent(old.merkleRoot)).toBeNull();
    expect(await getMediaCoinContent(posted.merkleRoot)).not.toBeNull();
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
    const ref = await attach("file-h", new Uint8Array(1000).fill(6));
    const prepared = await prepareCourierFiles([ref], { postId: "post-7", creatorId: "user-alice" });
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
