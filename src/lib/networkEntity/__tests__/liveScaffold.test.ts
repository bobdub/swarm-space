import { describe, expect, it } from "bun:test";
import { NetworkEntityLiveScaffold } from "../liveScaffold";

describe("NetworkEntityLiveScaffold", () => {
  it("trims backlog when maxEventBacklog is exceeded", () => {
    const scaffold = new NetworkEntityLiveScaffold({ maxEventBacklog: 2 });

    scaffold.ingestEvent({
      id: "1",
      type: "comment",
      authorPeerId: "peer-a",
      payload: "first",
      createdAt: new Date().toISOString(),
    });

    scaffold.ingestEvent({
      id: "2",
      type: "comment",
      authorPeerId: "peer-b",
      payload: "second",
      createdAt: new Date().toISOString(),
    });

    scaffold.ingestEvent({
      id: "3",
      type: "comment",
      authorPeerId: "peer-c",
      payload: "third",
      createdAt: new Date().toISOString(),
    });

    expect(scaffold.getBacklog().map((event) => event.id)).toEqual(["2", "3"]);
  });

  it("returns moderation proposal with human approval boundary", () => {
    const scaffold = new NetworkEntityLiveScaffold();

    const proposal = scaffold.evaluateModeration({
      id: "moderation-event",
      type: "comment",
      authorPeerId: "peer-risk",
      payload: "This looks like malware and extortion",
      createdAt: new Date().toISOString(),
    });

    expect(proposal).not.toBeNull();
    expect(proposal?.requiresHumanApproval).toBe(true);
  });

  it("rotates memory coin at 85% threshold", () => {
    const scaffold = new NetworkEntityLiveScaffold();

    const checkpoint = scaffold.memoryCheckpoint({
      coinId: "coin-1",
      usedBytes: 85,
      capacityBytes: 100,
      isReservedForEntity: true,
    });

    expect(checkpoint.shouldRotateCoin).toBe(true);
  });
});
