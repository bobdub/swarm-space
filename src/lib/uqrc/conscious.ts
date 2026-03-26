const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

export type UqrcConsciousIntent = 'restore' | 'observe' | 'attune' | 'synchronize';
export type UqrcConsciousPhase = 'dormant' | 'present' | 'adaptive' | 'guardian';

export interface UqrcConsciousSubconsciousState {
  sessionContinuity: number;
  accountResonance: number;
  telemetryHarmony: number;
  overloadRisk: number;
}

export interface UqrcConsciousState {
  intent: UqrcConsciousIntent;
  phase: UqrcConsciousPhase;
  awarenessScore: number;
  empathyScore: number;
  coherenceScore: number;
  subconscious: UqrcConsciousSubconsciousState;
}

export interface UqrcConsciousTelemetry {
  sessionActive: boolean;
  uptimeMs: number;
  connectionAttempts: number;
  successfulConnections: number;
  failedConnectionAttempts: number;
  rendezvousAttempts: number;
  rendezvousSuccesses: number;
  relayCount: number;
  pingCount: number;
  bytesUploaded: number;
  bytesDownloaded: number;
  accountId?: string | null;
}

export const DEFAULT_UQRC_CONSCIOUS_STATE: UqrcConsciousState = {
  intent: 'observe',
  phase: 'dormant',
  awarenessScore: 0.5,
  empathyScore: 0.5,
  coherenceScore: 0.5,
  subconscious: {
    sessionContinuity: 0.4,
    accountResonance: 0.5,
    telemetryHarmony: 0.5,
    overloadRisk: 0.4,
  },
};

const smooth = (next: number, previous?: number): number => {
  if (typeof previous !== 'number') {
    return clamp(next);
  }
  return clamp((previous * 0.35) + (next * 0.65));
};

export function deriveUqrcConsciousState(
  telemetry: UqrcConsciousTelemetry,
  previous: UqrcConsciousState = DEFAULT_UQRC_CONSCIOUS_STATE,
): UqrcConsciousState {
  const successRate = telemetry.connectionAttempts > 0
    ? telemetry.successfulConnections / telemetry.connectionAttempts
    : 0;
  const failureRate = telemetry.connectionAttempts > 0
    ? telemetry.failedConnectionAttempts / telemetry.connectionAttempts
    : 0;
  const rendezvousRate = telemetry.rendezvousAttempts > 0
    ? telemetry.rendezvousSuccesses / telemetry.rendezvousAttempts
    : 0;

  const activityDensity = clamp((telemetry.pingCount + telemetry.relayCount) / 700);
  const throughputBalance = clamp(
    Math.min(telemetry.bytesUploaded, telemetry.bytesDownloaded + 1) / Math.max(1, telemetry.bytesUploaded + 1),
  );

  const sessionContinuity = smooth(
    (clamp(telemetry.uptimeMs / (1000 * 60 * 30)) * 0.7) + ((telemetry.sessionActive ? 1 : 0) * 0.3),
    previous.subconscious.sessionContinuity,
  );

  const accountResonance = smooth(
    (telemetry.accountId ? 0.9 : 0.35) + (telemetry.sessionActive ? 0.1 : 0),
    previous.subconscious.accountResonance,
  );

  const telemetryHarmony = smooth(
    (successRate * 0.45) + (rendezvousRate * 0.35) + (throughputBalance * 0.2),
    previous.subconscious.telemetryHarmony,
  );

  const overloadRisk = smooth(
    (failureRate * 0.55) + (clamp(activityDensity - successRate) * 0.25) + ((1 - throughputBalance) * 0.2),
    previous.subconscious.overloadRisk,
  );

  const awarenessScore = smooth(
    (sessionContinuity * 0.4) + (activityDensity * 0.3) + (telemetryHarmony * 0.3),
    previous.awarenessScore,
  );

  const empathyScore = smooth(
    (successRate * 0.5) + (rendezvousRate * 0.2) + ((1 - overloadRisk) * 0.3),
    previous.empathyScore,
  );

  const coherenceScore = smooth(
    (telemetryHarmony * 0.45) + ((1 - overloadRisk) * 0.35) + (accountResonance * 0.2),
    previous.coherenceScore,
  );

  const intent: UqrcConsciousIntent = overloadRisk > 0.45
    ? 'restore'
    : coherenceScore > 0.75 && awarenessScore > 0.7
      ? 'synchronize'
      : activityDensity > 0.35
        ? 'attune'
        : 'observe';

  const phase: UqrcConsciousPhase = overloadRisk > 0.5
    ? 'guardian'
    : awarenessScore > 0.7
      ? 'adaptive'
      : awarenessScore > 0.35 || telemetry.sessionActive
        ? 'present'
        : 'dormant';

  return {
    intent,
    phase,
    awarenessScore,
    empathyScore,
    coherenceScore,
    subconscious: {
      sessionContinuity,
      accountResonance,
      telemetryHarmony,
      overloadRisk,
    },
  };
}

export function computeUqrcConsciousHealth(state: UqrcConsciousState): number {
  const intentBonus: Record<UqrcConsciousIntent, number> = {
    restore: 0.62,
    observe: 0.75,
    attune: 0.82,
    synchronize: 0.9,
  };

  return clamp(
    (state.awarenessScore * 0.3)
      + (state.empathyScore * 0.25)
      + (state.coherenceScore * 0.25)
      + ((1 - state.subconscious.overloadRisk) * 0.1)
      + (intentBonus[state.intent] * 0.1),
  );
}
