import { computeUqrcConsciousHealth, type UqrcConsciousState } from './conscious';
import { type UqrcEthicsAxiomVector, type UqrcEthicsEmberVector, type UqrcMeaningManifoldState } from './ethics';
import { computeUqrcPersonalityHealth, type UqrcPersonalityState } from './personality';

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
  meaningManifold?: UqrcMeaningManifoldState;
  axioms?: UqrcEthicsAxiomVector;
  embers?: UqrcEthicsEmberVector;
}

export interface UqrcStateSnapshot {
  timestamp: number;
  cortex: UqrcCortexState;
  limbic: UqrcLimbicState;
  brainstem: UqrcBrainstemState;
  memory: UqrcMemoryState;
  heartbeat: UqrcHeartbeatState;
  ethics: UqrcEthicsState;
  personality: UqrcPersonalityState;
  conscious: UqrcConsciousState;
  healthScore: number;
  trace?: string;
}

const HEALTH_WEIGHTS = {
  cortex: 0.16,
  limbic: 0.09,
  brainstem: 0.16,
  memory: 0.12,
  heartbeat: 0.16,
  ethics: 0.11,
  personality: 0.1,
  conscious: 0.1,
} as const;

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

const invert = (value: number): number => clamp(1 - value);

export function computeUqrcHealthScore(snapshot: Omit<UqrcStateSnapshot, 'healthScore'>): number {
  const cortex = (snapshot.cortex.noveltyScore + snapshot.cortex.semanticDensity + snapshot.cortex.interactionVelocity + snapshot.cortex.reflectionDepth + invert(snapshot.cortex.rollingEntropy)) / 5;

  const limbic = (snapshot.limbic.rewardFlux + snapshot.limbic.influenceWeight + snapshot.limbic.energyBudget + invert(snapshot.limbic.burnPressure)) / 4;

  const brainstem = (snapshot.brainstem.peerLiveness + invert(snapshot.brainstem.heartbeatIntervalMs) + snapshot.brainstem.messageRedundancy + snapshot.brainstem.survivalConfidence) / 4;

  const memory = (snapshot.memory.chunkRedundancy + snapshot.memory.manifestIntegrity + invert(snapshot.memory.recallLatencyMs) + snapshot.memory.reconstructionSuccess) / 4;

  const heartbeat = (invert(snapshot.heartbeat.qScoreTotal) + invert(snapshot.heartbeat.propagationCurvature) + invert(snapshot.heartbeat.timestampCurvature) + snapshot.heartbeat.hashRateEffective) / 4;

  const ethics = (invert(snapshot.ethics.harmRisk) + snapshot.ethics.confidence + invert(snapshot.ethics.interventionLevel)) / 3;

  const personality = computeUqrcPersonalityHealth(snapshot.personality);
  const conscious = computeUqrcConsciousHealth(snapshot.conscious);

  const weighted =
    (cortex * HEALTH_WEIGHTS.cortex)
    + (limbic * HEALTH_WEIGHTS.limbic)
    + (brainstem * HEALTH_WEIGHTS.brainstem)
    + (memory * HEALTH_WEIGHTS.memory)
    + (heartbeat * HEALTH_WEIGHTS.heartbeat)
    + (ethics * HEALTH_WEIGHTS.ethics)
    + (personality * HEALTH_WEIGHTS.personality)
    + (conscious * HEALTH_WEIGHTS.conscious);

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
