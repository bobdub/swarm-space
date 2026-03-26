export interface UqrcCortexState {
  noveltyScore: number;
  semanticDensity: number;
  interactionVelocity: number;
  reflectionDepth: number;
  rollingEntropy: number;
}

export interface UqrcLimbicState {
  rewardFlux: number;
  influenceWeight: number;
  energyBudget: number;
  burnPressure: number;
}

export interface UqrcBrainstemState {
  peerLiveness: number;
  heartbeatIntervalMs: number;
  messageRedundancy: number;
  survivalConfidence: number;
}

export interface UqrcMemoryState {
  chunkRedundancy: number;
  manifestIntegrity: number;
  recallLatencyMs: number;
  reconstructionSuccess: number;
}

export interface UqrcHeartbeatState {
  hashRateEffective: number;
  qScoreTotal: number;
  propagationCurvature: number;
  timestampCurvature: number;
}

export interface UqrcEthicsState {
  harmRisk: number;
  confidence: number;
  interventionLevel: number;
}

export interface UqrcStateSnapshot {
  timestamp: number;
  cortex: UqrcCortexState;
  limbic: UqrcLimbicState;
  brainstem: UqrcBrainstemState;
  memory: UqrcMemoryState;
  heartbeat: UqrcHeartbeatState;
  ethics: UqrcEthicsState;
  healthScore: number;
  trace?: string;
}

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

const invert = (value: number): number => clamp(1 - value);

export function computeUqrcHealthScore(snapshot: Omit<UqrcStateSnapshot, 'healthScore'>): number {
  const cortex = (snapshot.cortex.noveltyScore + snapshot.cortex.semanticDensity + snapshot.cortex.interactionVelocity + snapshot.cortex.reflectionDepth + invert(snapshot.cortex.rollingEntropy)) / 5;

  const limbic = (snapshot.limbic.rewardFlux + snapshot.limbic.influenceWeight + snapshot.limbic.energyBudget + invert(snapshot.limbic.burnPressure)) / 4;

  const brainstem = (snapshot.brainstem.peerLiveness + invert(snapshot.brainstem.heartbeatIntervalMs) + snapshot.brainstem.messageRedundancy + snapshot.brainstem.survivalConfidence) / 4;

  const memory = (snapshot.memory.chunkRedundancy + snapshot.memory.manifestIntegrity + invert(snapshot.memory.recallLatencyMs) + snapshot.memory.reconstructionSuccess) / 4;

  const heartbeat = (invert(snapshot.heartbeat.qScoreTotal) + invert(snapshot.heartbeat.propagationCurvature) + invert(snapshot.heartbeat.timestampCurvature) + snapshot.heartbeat.hashRateEffective) / 4;

  const ethics = (invert(snapshot.ethics.harmRisk) + snapshot.ethics.confidence + invert(snapshot.ethics.interventionLevel)) / 3;

  const weighted = cortex * 0.2 + limbic * 0.1 + brainstem * 0.2 + memory * 0.15 + heartbeat * 0.2 + ethics * 0.15;

  return Math.round(clamp(weighted) * 100);
}

export function serializeUqrcStateSnapshot(snapshot: UqrcStateSnapshot): string {
  return JSON.stringify(snapshot);
}

export function buildUqrcStateSnapshot(snapshot: Omit<UqrcStateSnapshot, 'healthScore'>): UqrcStateSnapshot {
  return {
    ...snapshot,
    healthScore: computeUqrcHealthScore(snapshot),
  };
}
