import { beforeEach, describe, expect, it } from "vitest";
import { clearPeerGiftLog, peerGiftSummary, recordPeerGift } from "../peerGiftLog";

describe("peer gift log", () => {
  beforeEach(() => clearPeerGiftLog());

  it("counts gifts taken and refused, and keeps the newest refusal", () => {
    expect(peerGiftSummary()).toEqual({ heard: 0, taken: 0, refused: 0, lastRefusal: null });
    recordPeerGift({ txId: "a", from: "peer", what: "5 SWARM", refused: null });
    recordPeerGift({ txId: "b", from: "peer", what: "1,700 SWARM", refused: "too poor" });
    recordPeerGift({ txId: "c", from: "peer", what: "250 Credits", refused: "unsigned" });
    const s = peerGiftSummary();
    expect([s.heard, s.taken, s.refused]).toEqual([3, 1, 2]);
    expect(s.lastRefusal?.what).toBe("250 Credits");
  });

  it("keeps one entry per donation, updated when it is offered again", () => {
    recordPeerGift({ txId: "a", from: "peer", what: "5 SWARM", refused: "too poor" });
    recordPeerGift({ txId: "a", from: "peer", what: "5 SWARM", refused: null });
    expect(peerGiftSummary()).toMatchObject({ heard: 1, taken: 1, refused: 0, lastRefusal: null });
  });
});
