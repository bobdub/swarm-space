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
}

export const DEFAULT_NETWORK_ENTITY_CONFIG: NetworkEntityScaffoldConfig = {
  peerId: "network-entity",
  memoryRotationThreshold: 0.85,
  moderationKeywords: ["exploit", "dox", "malware", "extortion"],
  maxEventBacklog: 500,
};
