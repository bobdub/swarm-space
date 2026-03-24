import {
  DEFAULT_NETWORK_ENTITY_CONFIG,
  type NetworkEntityCoinMemoryWrite,
  type NetworkEntityMemoryCheckpoint,
  type NetworkEntityMemoryCoin,
  type NetworkEntityMemorySource,
  type NetworkEntityMeshEvent,
  type NetworkEntityModerationProposal,
  type NetworkEntityPeerCandidate,
  type NetworkEntityReplyDraft,
  type NetworkEntityAutoConnectPlan,
  type NetworkEntityAutoConnectResult,
  type NetworkEntityScaffoldConfig,
  type UqrcCurvatureSample,
  type UqrcDebugReport,
  type UqrcDirectionalMetric,
} from "./types";

const NETWORK_QUESTION_MARKERS = [
  "mesh",
  "peer",
  "node",
  "sync",
  "swarm",
  "network",
];

const SAFETY_QUESTION_MARKERS = ["tos", "abuse", "harm", "unsafe", "report"];

const nowIso = (): string => new Date().toISOString();

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);

export class NetworkEntityLiveScaffold {
  private readonly config: NetworkEntityScaffoldConfig;
  private readonly backlog: NetworkEntityMeshEvent[] = [];

  constructor(config?: Partial<NetworkEntityScaffoldConfig>) {
    this.config = {
      ...DEFAULT_NETWORK_ENTITY_CONFIG,
      ...config,
    };
  }

  ingestEvent(event: NetworkEntityMeshEvent): void {
    this.backlog.push(event);
    if (this.backlog.length > this.config.maxEventBacklog) {
      this.backlog.splice(0, this.backlog.length - this.config.maxEventBacklog);
    }
  }

  getBacklog(): NetworkEntityMeshEvent[] {
    return [...this.backlog];
  }

  draftReply(event: NetworkEntityMeshEvent): NetworkEntityReplyDraft {
    const tokens = tokenize(event.payload);
    const hasNetworkCue = NETWORK_QUESTION_MARKERS.some((word) => tokens.includes(word));
    const hasSafetyCue = SAFETY_QUESTION_MARKERS.some((word) => tokens.includes(word));

    if (hasSafetyCue) {
      return {
        eventId: event.id,
        roomId: event.roomId,
        priority: "safety",
        response:
          "Scaffold response: I can draft a moderation proposal and queue it for human approval before any isolation is applied.",
        source: "inks",
        createdAt: nowIso(),
      };
    }

    if (hasNetworkCue) {
      return {
        eventId: event.id,
        roomId: event.roomId,
        priority: "network",
        response:
          "Scaffold response: I can inspect mesh state, peer health, and sync transitions. Share your node symptom and I will run a UQRC-path diagnosis.",
        source: "uqrc",
        createdAt: nowIso(),
      };
    }

    return {
      eventId: event.id,
      roomId: event.roomId,
      priority: "general",
      response:
        "Scaffold response: I am currently in framework mode. I can answer network and safety questions first, then expand into general knowledge workflows.",
      source: "fallback",
      createdAt: nowIso(),
    };
  }

  evaluateModeration(event: NetworkEntityMeshEvent): NetworkEntityModerationProposal | null {
    const tokens = tokenize(event.payload);
    const normalizedKeywords = this.config.moderationKeywords.map((word) =>
      word.trim().toLowerCase(),
    );
    const matches = normalizedKeywords.filter((word) => word.length > 0 && tokens.includes(word));

    if (matches.length === 0) {
      return null;
    }

    const confidence = Math.min(0.99, 0.5 + matches.length * 0.15);
    return {
      eventId: event.id,
      peerId: event.authorPeerId,
      reason: `Matched moderation keywords: ${matches.join(", ")}`,
      confidence,
      action: confidence >= 0.75 ? "isolate_temporarily" : "escalate_for_review",
      requiresHumanApproval: true,
      createdAt: nowIso(),
    };
  }

  buildCoinMemoryBootstrap(coin: NetworkEntityMemoryCoin): NetworkEntityCoinMemoryWrite {
    const prioritizedEntries = this.prioritizeInitialMemories(this.config.initialMemorySources);

    return {
      coinId: coin.coinId,
      entries: prioritizedEntries,
      createdAt: nowIso(),
    };
  }

  buildAutoConnectPlan(
    candidates: NetworkEntityPeerCandidate[],
    connectedPeerIds: string[],
  ): NetworkEntityAutoConnectPlan {
    const connectedSet = new Set(connectedPeerIds);
    const generatedAt = nowIso();

    if (!this.config.autoConnectEnabled) {
      return {
        requestedByPeerId: this.config.peerId,
        desiredPeerCount: this.config.desiredPeerCount,
        connectedPeerIds: [...connectedPeerIds],
        targetPeerIds: [],
        deferredPeerIds: [],
        generatedAt,
        reason: "Auto-connect is disabled in scaffold config.",
      };
    }

    const neededConnections = Math.max(0, this.config.desiredPeerCount - connectedPeerIds.length);
    if (neededConnections === 0) {
      return {
        requestedByPeerId: this.config.peerId,
        desiredPeerCount: this.config.desiredPeerCount,
        connectedPeerIds: [...connectedPeerIds],
        targetPeerIds: [],
        deferredPeerIds: [],
        generatedAt,
        reason: "Desired peer floor already met.",
      };
    }

    const eligible = [...candidates]
      .filter((candidate) => !connectedSet.has(candidate.peerId))
      .filter((candidate) => candidate.status !== "connected")
      .filter((candidate) => candidate.trustTier !== "blocked" && candidate.trustTier !== "restricted")
      .sort((left, right) => {
        const leftScore = this.getCandidateScore(left);
        const rightScore = this.getCandidateScore(right);
        if (leftScore !== rightScore) {
          return rightScore - leftScore;
        }
        return left.peerId.localeCompare(right.peerId);
      });

    const targetLimit = Math.min(this.config.maxAutoConnectBatch, neededConnections);
    const targetPeerIds = eligible.slice(0, targetLimit).map((candidate) => candidate.peerId);
    const deferredPeerIds = eligible.slice(targetLimit).map((candidate) => candidate.peerId);

    return {
      requestedByPeerId: this.config.peerId,
      desiredPeerCount: this.config.desiredPeerCount,
      connectedPeerIds: [...connectedPeerIds],
      targetPeerIds,
      deferredPeerIds,
      generatedAt,
      reason:
        targetPeerIds.length > 0
          ? "Prepared verified/trusted peers for outbound mesh dialing."
          : "No eligible verified/trusted peers available for auto-connect.",
    };
  }

  async autoConnectPeers(
    candidates: NetworkEntityPeerCandidate[],
    connectedPeerIds: string[],
    connector: (peerId: string) => boolean | Promise<boolean>,
  ): Promise<NetworkEntityAutoConnectResult> {
    const plan = this.buildAutoConnectPlan(candidates, connectedPeerIds);
    const attempts = await Promise.all(
      plan.targetPeerIds.map(async (peerId) => {
        const accepted = await connector(peerId);
        return {
          peerId,
          accepted,
          reason: accepted ? "queued" : "connector-rejected",
        } as const;
      }),
    );

    return {
      plan,
      attempts,
      acceptedCount: attempts.filter((attempt) => attempt.accepted).length,
      attemptedAt: nowIso(),
    };
  }

  private prioritizeInitialMemories(entries: NetworkEntityMemorySource[]): NetworkEntityMemorySource[] {
    const priority = ["memorygarden.md", "networkentity.md"];
    const score = (entry: NetworkEntityMemorySource): number => {
      const normalizedPath = entry.path.toLowerCase();
      const directMatchIndex = priority.findIndex((needle) => normalizedPath.endsWith(needle));
      return directMatchIndex === -1 ? priority.length : directMatchIndex;
    };

    return [...entries].sort((left, right) => {
      const scoreDelta = score(left) - score(right);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return left.path.localeCompare(right.path);
    });
  }

  memoryCheckpoint(coin: NetworkEntityMemoryCoin): NetworkEntityMemoryCheckpoint {
    const fillRatio = coin.capacityBytes === 0 ? 1 : coin.usedBytes / coin.capacityBytes;
    const shouldRotateCoin = fillRatio >= this.config.memoryRotationThreshold;

    return {
      coinId: coin.coinId,
      fillRatio,
      shouldRotateCoin,
      reason: shouldRotateCoin
        ? `Coin reached ${Math.round(fillRatio * 100)}% capacity (threshold ${Math.round(
            this.config.memoryRotationThreshold * 100,
          )}%).`
        : "Coin capacity is within active write range.",
      createdAt: nowIso(),
    };
  }

  buildUqrcDebugReport(
    eventId: string,
    directionalMetrics: UqrcDirectionalMetric[],
    curvatureSamples: UqrcCurvatureSample[],
  ): UqrcDebugReport {
    const curvatureNorm = Math.sqrt(
      curvatureSamples.reduce((sum, sample) => sum + sample.curvature ** 2, 0),
    );

    const directionalVolatility = directionalMetrics.reduce(
      (sum, metric) => sum + Math.abs(metric.delta),
      0,
    );

    const qScore = curvatureNorm + directionalVolatility * 0.05 + Number.EPSILON * 1e5;

    return {
      eventId,
      directionalMetrics,
      curvatureSamples,
      curvatureNorm,
      qScore,
      converged: curvatureNorm < 0.0005,
      generatedAt: nowIso(),
    };
  }

  private getCandidateScore(candidate: NetworkEntityPeerCandidate): number {
    const trustBase =
      candidate.trustTier === "trusted"
        ? 200
        : candidate.trustTier === "unknown"
          ? 100
          : 0;

    const verifiedBoost = candidate.verifiedPeer ? 300 : 0;
    const qualityBoost = candidate.status === "disconnected" ? 80 : 20;
    const latencyBoost =
      typeof candidate.latencyMs === "number" && Number.isFinite(candidate.latencyMs)
        ? Math.max(0, 60 - Math.min(60, candidate.latencyMs / 10))
        : 10;
    const seenAtMs = Date.parse(candidate.lastSeenAt);
    const recencyBoost = Number.isFinite(seenAtMs) ? Math.max(0, Math.min(120, seenAtMs / 1e12)) : 0;

    return trustBase + verifiedBoost + qualityBoost + latencyBoost + recencyBoost;
  }
}
