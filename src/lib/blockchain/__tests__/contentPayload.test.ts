import { describe, it, expect, vi, beforeEach } from "vitest";
const db: Record<string, Map<string, any>> = { posts: new Map(), comments: new Map(), swarmCoins: new Map() };
vi.mock("../../store", () => ({
  getAll: async (s: string) => [...db[s].values()],
  put: async (s: string, v: any) => { db[s].set(v.id ?? v.coinId, v); },
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
});
