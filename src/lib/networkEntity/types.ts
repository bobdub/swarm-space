export type NetworkEntityPriority = "network" | "safety" | "general";

export type NetworkEntityEventType =
  | "comment"
  | "post"
  | "moderation_signal"
  | "peer_status"
  | "system_alert";

export interface NetworkEntityMeshEvent {
  id: string;
  type: NetworkEntityEventType;
  roomId?: string;
  authorPeerId: string;
  payload: string;
  createdAt: string;
}

export interface NetworkEntityMemoryCoin {
  coinId: string;
  usedBytes: number;
  capacityBytes: number;
  isReservedForEntity: boolean;
}

export interface NetworkEntityMemoryCheckpoint {
  coinId: string;
  fillRatio: number;
  shouldRotateCoin: boolean;
  reason: string;
  createdAt: string;
}

export interface NetworkEntityMemorySource {
  path: string;
  title: string;
  summary: string;
}

export interface NetworkEntityCoinMemoryWrite {
  coinId: string;
  entries: NetworkEntityMemorySource[];
  createdAt: string;
}

export interface NetworkEntityModerationProposal {
  eventId: string;
  peerId: string;
  reason: string;
  confidence: number;
  action: "isolate_temporarily" | "escalate_for_review";
  requiresHumanApproval: true;
  createdAt: string;
}

export interface NetworkEntityReplyDraft {
  eventId: string;
  roomId?: string;
  priority: NetworkEntityPriority;
  response: string;
  source: "inks" | "uqrc" | "fallback";
  createdAt: string;
}

export interface UqrcDirectionalMetric {
  direction: string;
  delta: number;
}

export interface UqrcCurvatureSample {
  pair: [string, string];
  curvature: number;
}

export interface UqrcDebugReport {
  eventId: string;
  directionalMetrics: UqrcDirectionalMetric[];
  curvatureSamples: UqrcCurvatureSample[];
  curvatureNorm: number;
  qScore: number;
  converged: boolean;
  generatedAt: string;
}

export interface NetworkEntityScaffoldConfig {
  peerId: string;
  memoryRotationThreshold: number;
  moderationKeywords: string[];
  maxEventBacklog: number;
  initialMemorySources: NetworkEntityMemorySource[];
  autoConnectEnabled: boolean;
  desiredPeerCount: number;
  maxAutoConnectBatch: number;
}

export type NetworkEntityTrustTier = "unknown" | "trusted" | "restricted" | "blocked";

export interface NetworkEntityPeerCandidate {
  peerId: string;
  verifiedPeer: boolean;
  trustTier: NetworkEntityTrustTier;
  status: "connected" | "disconnected" | "degraded";
  lastSeenAt: string;
  latencyMs?: number | null;
}

export interface NetworkEntityAutoConnectPlan {
  requestedByPeerId: string;
  desiredPeerCount: number;
  connectedPeerIds: string[];
  targetPeerIds: string[];
  deferredPeerIds: string[];
  generatedAt: string;
  reason: string;
}

export interface NetworkEntityAutoConnectAttempt {
  peerId: string;
  accepted: boolean;
  reason: "queued" | "connector-rejected";
}

export interface NetworkEntityAutoConnectResult {
  plan: NetworkEntityAutoConnectPlan;
  attempts: NetworkEntityAutoConnectAttempt[];
  acceptedCount: number;
  attemptedAt: string;
}

export const DEFAULT_NETWORK_ENTITY_CONFIG: NetworkEntityScaffoldConfig = {
  peerId: "network-entity",
  memoryRotationThreshold: 0.85,
  moderationKeywords: ["exploit", "dox", "malware", "extortion"],
  maxEventBacklog: 500,
  autoConnectEnabled: true,
  desiredPeerCount: 4,
  maxAutoConnectBatch: 3,
  initialMemorySources: [
    {
      path: "MemoryGarden.md",
      title: "Memory Garden",
      summary: "Caretaker journal for goals, duties, and continuity anchors.",
    },
    {
      path: "docs/NetworkEntity.md",
      title: "Network Entity Spec",
      summary: "Primary concept and behavioral contract for the entity scaffold.",
    },
  ],
};
