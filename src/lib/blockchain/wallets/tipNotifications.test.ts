import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SwarmTransaction } from "../types";

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/store", () => ({
  get: async (table: string, id: string) => store.get(`${table}:${id}`),
  put: async (table: string, value: { id: string }) => { store.set(`${table}:${value.id}`, value); },
}));

const { notifyReceivedTips, notifyTipReceived, tipNoticeId } = await import("./tipNotifications");
const contract = "0x634340447220bcaaa09a5505d71ca62b644a1a82";

function tip(id: string, at: number, meta: Record<string, unknown>, extra: Partial<SwarmTransaction> = {}): SwarmTransaction {
  return { id, type: "wallet_tip", from: "1111222233334444", to: "aabbccddeeff0011", amount: 5, fee: 0, nonce: at,
    publicKey: "", signature: "", timestamp: new Date(at).toISOString(), meta, ...extra };
}
const dreams = (id: string, at: number) => tip(id, at, { assetId: `custom:${contract}`, ticker: "DREAMS", currency: `MINTME:${contract}`,
  decimals: 12, amountUnits: "5000000000000", intent: "tip", message: "thanks!" });

describe("bell notifications for received tips", () => {
  beforeEach(() => { store.clear(); localStorage.clear(); });

  it("adds one inbox entry per received Dreams tip, naming the sender", async () => {
    store.set("users:1111222233334444", { displayName: "Ada" });
    expect(await notifyTipReceived(dreams("t1", 1000), "aabbccddeeff0011")).toBe(true);
    expect(await notifyTipReceived(dreams("t1", 1000), "aabbccddeeff0011")).toBe(false);
    expect(store.get(`notifications:${tipNoticeId("t1")}`)).toMatchObject({
      userId: "aabbccddeeff0011", type: "wallet_deposit", title: "+5 DREAMS", content: 'Tip from Ada · "thanks!"', link: "/wallet", read: false,
    });
  });

  it("labels SWARM transfers and ignores tips the member sent", async () => {
    const swarm = tip("t2", 1000, { assetId: "chain:SWARM", intent: "transfer" });
    expect(await notifyTipReceived(swarm, "aabbccddeeff0011")).toBe(true);
    expect(store.get(`notifications:${tipNoticeId("t2")}`)).toMatchObject({ title: "+5 SWARM", content: "Transfer from User 11112222" });
    expect(await notifyTipReceived(swarm, "1111222233334444")).toBe(false);
  });

  it("stays quiet about history from before notices began, then reports new tips", async () => {
    expect(await notifyReceivedTips([dreams("old", 1000)], "aabbccddeeff0011", 5000)).toBe(0);
    expect(await notifyReceivedTips([dreams("old", 1000), dreams("new", 6000)], "aabbccddeeff0011", 7000)).toBe(1);
    expect(await notifyReceivedTips([dreams("old", 1000), dreams("new", 6000)], "aabbccddeeff0011", 8000)).toBe(0);
  });
});
