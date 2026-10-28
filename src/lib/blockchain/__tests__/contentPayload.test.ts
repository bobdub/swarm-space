import { describe, it, expect, vi, beforeEach } from "vitest";
const db: Record<string, Map<string, any>> = { posts: new Map(), comments: new Map(), swarmCoins: new Map() };
vi.mock("../../store", () => ({
  getAll: async (s: string) => [...db[s].values()],
  put: async (s: string, v: any) => { db[s].set(v.id ?? v.coinId, v); },
}));
import { packLocalContent, COIN_PAYLOAD_SEAL_BYTES } from "../contentPayload";
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
  it("seals with Creator Proof at 89% of 1 GiB", async () => {
    db.swarmCoins.set("c1", { ...coin("c1"), fillState: "filling", sealBytes: COIN_PAYLOAD_SEAL_BYTES - 5 });
    db.posts.set("p1", { id: "p1", author: "u", content: "payload" });
    await packLocalContent("u");
    const c = db.swarmCoins.get("c1");
    expect(COIN_PAYLOAD_SEAL_BYTES).toBe(Math.ceil(1024 ** 3 * 0.89));
    expect(isWeightedCoin(c)).toBe(true);
    expect(c.creatorProof.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
  });
});
