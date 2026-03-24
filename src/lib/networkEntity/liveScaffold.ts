import {
  DEFAULT_NETWORK_ENTITY_CONFIG,
  type NetworkEntityCoinMemoryWrite,
  type NetworkEntityMemoryCheckpoint,
  type NetworkEntityMemoryCoin,
  type NetworkEntityMemorySource,
  type NetworkEntityMeshEvent,
  type NetworkEntityModerationProposal,
  type NetworkEntityReplyDraft,
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
}
