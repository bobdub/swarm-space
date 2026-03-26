const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

export type UqrcIntent = 'stabilize' | 'explore' | 'recover' | 'scale';
export type UqrcEngagementMode = 'passive' | 'interactive' | 'orchestrating';
export type UqrcInterventionBias = 'observe' | 'assist' | 'protect';

export interface UqrcPersonalityState {
  intent: UqrcIntent;
  engagementMode: UqrcEngagementMode;
  interventionBias: UqrcInterventionBias;
  cooperationScore: number;
  adaptationScore: number;
  stabilityScore: number;
}

export interface UqrcPersonalityTelemetry {
  sessionActive: boolean;
  uptimeMs: number;
  connectionAttempts: number;
  successfulConnections: number;
  failedConnectionAttempts: number;
  rendezvousAttempts: number;
  rendezvousSuccesses: number;
  relayCount: number;
  pingCount: number;
  accountId?: string | null;
}

export const DEFAULT_UQRC_PERSONALITY_STATE: UqrcPersonalityState = {
  intent: 'stabilize',
  engagementMode: 'passive',
  interventionBias: 'observe',
  cooperationScore: 0.5,
  adaptationScore: 0.5,
  stabilityScore: 0.5,
};

const smooth = (next: number, previous?: number): number => {
  if (typeof previous !== 'number') {
    return clamp(next);
  }
  return clamp((previous * 0.4) + (next * 0.6));
};

export function deriveUqrcPersonalityState(
  telemetry: UqrcPersonalityTelemetry,
  previous: UqrcPersonalityState = DEFAULT_UQRC_PERSONALITY_STATE,
): UqrcPersonalityState {
  const successRate = telemetry.connectionAttempts > 0
    ? telemetry.successfulConnections / telemetry.connectionAttempts
    : 0;
  const failureRate = telemetry.connectionAttempts > 0
    ? telemetry.failedConnectionAttempts / telemetry.connectionAttempts
    : 0;
  const rendezvousRate = telemetry.rendezvousAttempts > 0
    ? telemetry.rendezvousSuccesses / telemetry.rendezvousAttempts
    : 0;

  const activityDensity = clamp((telemetry.pingCount + telemetry.relayCount) / 500);
  const uptimeConfidence = clamp(telemetry.uptimeMs / (1000 * 60 * 20));

  const cooperationScore = smooth(
    (successRate * 0.5)
      + (rendezvousRate * 0.3)
      + (clamp(activityDensity + (telemetry.sessionActive ? 0.1 : 0)) * 0.2),
    previous.cooperationScore,
  );

  const adaptationScore = smooth(
    (clamp(telemetry.connectionAttempts / 100) * 0.4)
      + (activityDensity * 0.4)
      + ((telemetry.accountId ? 1 : 0) * 0.2),
    previous.adaptationScore,
  );

  const stabilityScore = smooth(
    (clamp(1 - failureRate) * 0.5)
      + (rendezvousRate * 0.3)
      + (uptimeConfidence * 0.2),
    previous.stabilityScore,
  );

  const intent: UqrcIntent = failureRate > 0.35
    ? 'recover'
    : adaptationScore > 0.7 && cooperationScore > 0.6
      ? 'scale'
      : activityDensity > 0.45
        ? 'explore'
        : 'stabilize';

  const engagementMode: UqrcEngagementMode = activityDensity > 0.6
    ? 'orchestrating'
    : activityDensity > 0.2 || telemetry.sessionActive
      ? 'interactive'
      : 'passive';

  const interventionBias: UqrcInterventionBias = failureRate > 0.4
    ? 'protect'
    : failureRate > 0.2 || rendezvousRate < 0.5
      ? 'assist'
      : 'observe';

  return {
    intent,
    engagementMode,
    interventionBias,
    cooperationScore,
    adaptationScore,
    stabilityScore,
  };
}

export function computeUqrcPersonalityHealth(state: UqrcPersonalityState): number {
  const intentBonus: Record<UqrcIntent, number> = {
    recover: 0.55,
    stabilize: 0.75,
    explore: 0.8,
    scale: 0.9,
  };

  return clamp(
    (state.cooperationScore * 0.4)
      + (state.adaptationScore * 0.25)
      + (state.stabilityScore * 0.25)
      + (intentBonus[state.intent] * 0.1),
  );
}
