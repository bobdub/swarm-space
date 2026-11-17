import { describe, it, expect, vi, beforeEach } from "vitest";
const db: Record<string, Map<string, any>> = { posts: new Map(), comments: new Map(), swarmCoins: new Map(), manifests: new Map() };
vi.mock("../../store", () => ({
  get: async (s: string, k: string) => db[s].get(k),
  getAll: async (s: string) => [...db[s].values()],
  put: async (s: string, v: any) => { db[s].set(v.id ?? v.coinId ?? v.fileId, v); },
}));
import { packLocalContent, COIN_PAYLOAD_SEAL_BYTES, measureContentBytes, sealLocalContent } from "../contentPayload";
import { isWeightedCoin } from "../weightedCoin";
import { isSpendable as canSpendCoin } from "../coinSpend";

const coin = (id: string) => ({ coinId: id, ownerId: "u", status: "wallet", weight: 0, maxWeight: 100, wrappedTokens: [] });
beforeEach(() => Object.values(db).forEach((m) => m.clear()));

describe("content payload flip", () => {
  it("leaves content unflipped when no hollow coin exists, then loads it once mined", async () => {
    db.posts.set("p1", { id: "p1", author: "u", content: "hi", createdAt: "1" });
    expect(await packLocalContent("u")).toBe(0);
    expect(db.posts.get("p1")._coinId).toBeUndefined();
    db.swarmCoins.set("c1", coin("c1"));
    expect(await packLocalContent("u")).toBe(1);
    expect(db.posts.get("p1")._coinId).toBe("c1");
    expect(db.swarmCoins.get("c1").fillState).toBe("filling");
    expect(await packLocalContent("u")).toBe(0);
  });
  it("payloading coins cannot be sent; others' content is not loaded", async () => {
    db.posts.set("p1", { id: "p1", author: "u", content: "x" });
    db.comments.set("k1", { id: "k1", author: "other", text: "y" });
    db.swarmCoins.set("c1", coin("c1"));
    await packLocalContent("u");
    expect(db.comments.get("k1")._coinId).toBeUndefined();
    expect(canSpendCoin(db.swarmCoins.get("c1"))).toBe(false);
  });
  it("seals with Creator Proof exactly at the 1 GiB hard ceiling", async () => {
    const post = { id: "p1", author: "u", content: "payload" };
    db.swarmCoins.set("c1", { ...coin("c1"), fillState: "filling", sealBytes: COIN_PAYLOAD_SEAL_BYTES - measureContentBytes(post) });
    db.posts.set("p1", post);
    await packLocalContent("u");
    const c = db.swarmCoins.get("c1");
    expect(COIN_PAYLOAD_SEAL_BYTES).toBe(1024 ** 3);
    expect(c.sealBytes).toBe(1024 ** 3);
    expect(c.creatorProof.tier).toBe("legendary");
    expect(isWeightedCoin(c)).toBe(true);
    expect(c.creatorProof.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
  });
  it("rolls to another coin rather than overflowing", async () => {
    db.swarmCoins.set("c1", { ...coin("c1"), fillState: "filling", sealBytes: 1024 ** 3 - 1 });
    db.swarmCoins.set("c2", coin("c2"));
    db.posts.set("p1", { id: "p1", author: "u", content: "payload" });
    await packLocalContent("u");
    expect(db.swarmCoins.get("c1").sealBytes).toBe(1024 ** 3 - 1);
    expect(db.posts.get("p1")._coinId).toBe("c2");
  });
  const loaded = (bytes: number) => ({ ...coin("c1"), fillState: "filling", sealBytes: bytes,
    lastPayloadLoadAt: "2026-11-12T00:00:00Z",
    payloadEntries: [{ id: "p0", type: "post", hash: "a", sizeBytes: bytes }] });
  it("manually seals 1 MB once with actual load preserved and spendability", async () => {
    db.swarmCoins.set("c1", loaded(1_000_000));
    expect(await sealLocalContent("u", "manual", "c1")).toBe(1);
    const sealed = db.swarmCoins.get("c1");
    expect(sealed.creatorProof.tier).toBe("basic");
    expect(sealed.fill).toBe(1_000_000 / 1024 ** 3);
    expect(canSpendCoin(sealed)).toBe(true);
    expect(await sealLocalContent("u", "manual", "c1")).toBe(0);
    expect(db.swarmCoins.get("c1")).toEqual(sealed);
  });
  it("rejects manual seals below 1 MB or by another owner", async () => {
    db.swarmCoins.set("c1", loaded(999_999));
    expect(await sealLocalContent("u", "manual", "c1")).toBe(0);
    db.swarmCoins.set("c1", loaded(1_000_000));
    expect(await sealLocalContent("other", "manual", "c1")).toBe(0);
  });
  it.each([[5_000_000, "basic"], [10_000_000, "rare"], [50_000_000, "legendary"]])(
    "idle-seals %i bytes as %s after 60 seconds", async (bytes, tier) => {
      db.swarmCoins.set("c1", loaded(Number(bytes)));
      const now = Date.parse("2026-11-12T00:00:00Z");
      expect(await sealLocalContent("u", "idle", undefined, now + 59_999)).toBe(0);
      expect(await sealLocalContent("u", "idle", undefined, now + 60_000)).toBe(1);
      expect(db.swarmCoins.get("c1").creatorProof.tier).toBe(tier);
    });
  it("resets the idle clock only on a new load", async () => {
    db.swarmCoins.set("c1", loaded(5_000_000));
    db.posts.set("p1", { id: "p1", author: "u", content: "new" });
    await packLocalContent("u");
    const at = db.swarmCoins.get("c1").lastPayloadLoadAt;
    expect(Date.parse(at)).toBeGreaterThan(Date.parse("2026-11-12T00:00:00Z"));
    await packLocalContent("u");
    expect(db.swarmCoins.get("c1").lastPayloadLoadAt).toBe(at);
    expect(await sealLocalContent("u", "idle", undefined, Date.parse(at) + 59_999)).toBe(0);
    expect(await sealLocalContent("u", "idle", undefined, Date.parse(at) + 60_000)).toBe(1);
  });
  it("serializes manual sealing and packing onto separate coins", async () => {
    db.swarmCoins.set("c1", loaded(1_000_000));
    db.swarmCoins.set("c2", coin("c2"));
    db.posts.set("p1", { id: "p1", author: "u", content: "new" });
    expect(await Promise.all([sealLocalContent("u", "manual", "c1"), packLocalContent("u")])).toEqual([1, 1]);
    expect(db.posts.get("p1")._coinId).toBe("c2");
    expect(db.swarmCoins.get("c1").sealBytes).toBe(1_000_000);
  });
  it("engraves an uploaded image NFT-style and counts its full size", async () => {
    const size = 2_500_000;
    db.manifests.set("file-1", { fileId: "file-1", chunks: ["chunk-a", "chunk-b", "chunk-c"], mime: "image/png",
      size, originalName: "sunset.png", fileKey: "secret", fileKeyRaw: "secret-raw" });
    db.posts.set("p1", { id: "p1", author: "u", type: "image", content: "Sunset over the swarm", manifestIds: ["file-1"], createdAt: "1" });
    db.swarmCoins.set("c1", coin("c1"));
    expect(await packLocalContent("u")).toBe(1);
    const c = db.swarmCoins.get("c1");
    const [entry] = c.payloadEntries;
    expect(c.sealBytes).toBeGreaterThan(size);
    expect(entry.v).toBe(2);
    expect(entry.metadata).toMatchObject({ name: "Sunset over the swarm", postType: "image" });
    expect(entry.media).toEqual([expect.objectContaining({ fileId: "file-1", mime: "image/png", name: "sunset.png",
      sizeBytes: size, chunks: ["chunk-a", "chunk-b", "chunk-c"], contentHash: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
    expect(JSON.stringify(c)).not.toContain("secret");
    expect(await sealLocalContent("u", "manual", "c1")).toBe(1);
    expect(db.swarmCoins.get("c1").creatorProof.tier).toBe("basic");
  });
  it("re-engraves legacy text-only entries in an open coin so earlier uploads count", async () => {
    db.manifests.set("file-1", { fileId: "file-1", chunks: ["chunk-a"], mime: "image/jpeg", size: 2_500_000 });
    db.posts.set("p0", { id: "p0", author: "u", content: "old", manifestIds: ["file-1"], _coinId: "c1" });
    db.swarmCoins.set("c1", loaded(900));
    await packLocalContent("u");
    const c = db.swarmCoins.get("c1");
    expect(c.sealBytes).toBeGreaterThan(2_500_000);
    expect(c.payloadEntries[0].media[0].sizeBytes).toBe(2_500_000);
    expect(await sealLocalContent("u", "manual", "c1")).toBe(1);
  });
  it("never re-engraves sealed coins", async () => {
    db.manifests.set("file-1", { fileId: "file-1", chunks: ["chunk-a"], mime: "image/jpeg", size: 2_500_000 });
    db.posts.set("p0", { id: "p0", author: "u", content: "old", manifestIds: ["file-1"], _coinId: "c1" });
    db.swarmCoins.set("c1", { ...loaded(900), fillState: "sealed" });
    await packLocalContent("u");
    expect(db.swarmCoins.get("c1").sealBytes).toBe(900);
  });
  it("relocates engraved files to the coin by reference, without copying bytes", async () => {
    db.manifests.set("file-1", { fileId: "file-1", chunks: ["chunk-a"], mime: "image/png", size: 2_500_000 });
    db.posts.set("p1", { id: "p1", author: "u", content: "pic", manifestIds: ["file-1"] });
    db.swarmCoins.set("c1", coin("c1"));
    await packLocalContent("u");
    expect(db.manifests.get("file-1")).toMatchObject({ _coinId: "c1", chunks: ["chunk-a"], size: 2_500_000 });
    expect(JSON.stringify(db.swarmCoins.get("c1")).length).toBeLessThan(2_000);
  });
  it("retries files that were not on this device when first engraved", async () => {
    db.posts.set("p1", { id: "p1", author: "u", content: "pic", manifestIds: ["file-1"] });
    db.swarmCoins.set("c1", coin("c1"));
    await packLocalContent("u");
    expect(db.swarmCoins.get("c1").payloadEntries[0].pendingMediaIds).toEqual(["file-1"]);
    db.manifests.set("file-1", { fileId: "file-1", chunks: ["chunk-a"], mime: "image/png", size: 2_500_000 });
    await packLocalContent("u");
    const c = db.swarmCoins.get("c1");
    expect(c.payloadEntries[0].pendingMediaIds).toBeUndefined();
    expect(c.sealBytes).toBeGreaterThan(2_500_000);
    expect(db.manifests.get("file-1")._coinId).toBe("c1");
  });
  it("releases a legacy entry that no longer fits so another coin takes it", async () => {
    db.manifests.set("file-1", { fileId: "file-1", chunks: ["chunk-a"], mime: "image/png", size: 2_000 });
    db.posts.set("p0", { id: "p0", author: "u", content: "old", manifestIds: ["file-1"], _coinId: "c1" });
    db.swarmCoins.set("c1", { ...loaded(1024 ** 3 - 100), payloadEntries: [
      { id: "x", type: "post", hash: "h", sizeBytes: 1024 ** 3 - 200, v: 2 },
      { id: "p0", type: "post", hash: "a", sizeBytes: 100 }] });
    db.swarmCoins.set("c2", coin("c2"));
    await packLocalContent("u");
    expect(db.swarmCoins.get("c1").payloadEntries.map((e: { id: string }) => e.id)).toEqual(["x"]);
    expect(db.swarmCoins.get("c1").sealBytes).toBe(1024 ** 3 - 200);
    expect(db.posts.get("p0")._coinId).toBe("c2");
    expect(db.manifests.get("file-1")._coinId).toBe("c2");
  });
});
