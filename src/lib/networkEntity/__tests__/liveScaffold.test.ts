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

  it("prioritizes safety responses when safety and network cues are both present", () => {
    const scaffold = new NetworkEntityLiveScaffold();

    const reply = scaffold.draftReply({
      id: "mixed-cues",
      roomId: "room-1",
      type: "comment",
      authorPeerId: "peer-risk",
      payload: "Unsafe mesh node behavior should be reported",
      createdAt: new Date().toISOString(),
    });

    expect(reply.priority).toBe("safety");
    expect(reply.source).toBe("inks");
  });

  it("matches moderation keywords regardless of keyword casing", () => {
    const scaffold = new NetworkEntityLiveScaffold({
      moderationKeywords: ["MalWare", "EXTORTION"],
    });

    const proposal = scaffold.evaluateModeration({
      id: "moderation-case",
      type: "comment",
      authorPeerId: "peer-risk",
      payload: "possible malware + extortion in this payload",
      createdAt: new Date().toISOString(),
    });

    expect(proposal).not.toBeNull();
    expect(proposal?.reason).toContain("malware");
    expect(proposal?.reason).toContain("extortion");
  });

  it("prioritizes MemoryGarden and NetworkEntity docs as first coin memories", () => {
    const scaffold = new NetworkEntityLiveScaffold({
      initialMemorySources: [
        {
          path: "docs/anything-else.md",
          title: "Anything",
          summary: "Other notes",
        },
        {
          path: "docs/NetworkEntity.md",
          title: "Network Entity Spec",
          summary: "Spec",
        },
        {
          path: "MemoryGarden.md",
          title: "Memory Garden",
          summary: "Journal",
        },
      ],
    });

    const bootstrap = scaffold.buildCoinMemoryBootstrap({
      coinId: "coin-memory-1",
      usedBytes: 10,
      capacityBytes: 100,
      isReservedForEntity: true,
    });

    expect(bootstrap.entries.map((entry) => entry.path)).toEqual([
      "MemoryGarden.md",
      "docs/NetworkEntity.md",
      "docs/anything-else.md",
    ]);
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

  it("builds auto-connect plan with verified/trusted peers first", () => {
    const scaffold = new NetworkEntityLiveScaffold({
      desiredPeerCount: 3,
      maxAutoConnectBatch: 2,
    });

    const plan = scaffold.buildAutoConnectPlan(
      [
        {
          peerId: "peer-verified",
          verifiedPeer: true,
          trustTier: "trusted",
          status: "disconnected",
          latencyMs: 20,
          lastSeenAt: "2026-03-24T10:00:00.000Z",
        },
        {
          peerId: "peer-unknown",
          verifiedPeer: false,
          trustTier: "unknown",
          status: "disconnected",
          latencyMs: 10,
          lastSeenAt: "2026-03-24T10:00:00.000Z",
        },
        {
          peerId: "peer-degraded",
          verifiedPeer: false,
          trustTier: "trusted",
          status: "degraded",
          latencyMs: 60,
          lastSeenAt: "2026-03-24T10:00:00.000Z",
        },
        {
          peerId: "peer-blocked",
          verifiedPeer: true,
          trustTier: "blocked",
          status: "disconnected",
          latencyMs: 10,
          lastSeenAt: "2026-03-24T10:00:00.000Z",
        },
      ],
      ["peer-already-connected"],
    );

    expect(plan.targetPeerIds).toEqual(["peer-verified", "peer-degraded"]);
    expect(plan.deferredPeerIds).toEqual(["peer-unknown"]);
  });

  it("auto-connects planned peers through connector callback", async () => {
    const scaffold = new NetworkEntityLiveScaffold({
      desiredPeerCount: 2,
      maxAutoConnectBatch: 2,
    });

    const result = await scaffold.autoConnectPeers(
      [
        {
          peerId: "peer-a",
          verifiedPeer: true,
          trustTier: "trusted",
          status: "disconnected",
          latencyMs: 15,
          lastSeenAt: "2026-03-24T10:00:00.000Z",
        },
        {
          peerId: "peer-b",
          verifiedPeer: true,
          trustTier: "trusted",
          status: "disconnected",
          latencyMs: 25,
          lastSeenAt: "2026-03-24T09:59:00.000Z",
        },
      ],
      [],
      async (peerId) => peerId === "peer-a",
    );

    expect(result.plan.targetPeerIds).toEqual(["peer-a", "peer-b"]);
    expect(result.acceptedCount).toBe(1);
    expect(result.attempts).toEqual([
      { peerId: "peer-a", accepted: true, reason: "queued" },
      { peerId: "peer-b", accepted: false, reason: "connector-rejected" },
    ]);
  });
});
