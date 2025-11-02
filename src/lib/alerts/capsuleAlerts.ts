export interface CapsuleAlertEvent {
  type: 'failure' | 'recovery';
  timestamp: string;
  streak: number;
  message: string;
  details?: Record<string, unknown>;
}

export interface CapsuleAlertState {
  failureStreak: number;
  lastFailureAt?: string;
  lastFailureMessage?: string;
  lastSuccessAt?: string;
  alertActive?: boolean;
}

export interface CapsuleAlertPersistence {
  read(): Promise<CapsuleAlertState | null>;
  write(state: CapsuleAlertState): Promise<void>;
}

export interface CapsuleAlertOptions {
  threshold: number;
  persistence: CapsuleAlertPersistence;
  notify: (event: CapsuleAlertEvent) => Promise<void> | void;
  now?: () => Date;
}

export interface CapsuleAlertService {
  recordFailure(message: string, details?: Record<string, unknown>): Promise<void>;
  recordSuccess(details?: Record<string, unknown>): Promise<void>;
  getState(): CapsuleAlertState;
}

export async function createCapsuleAlertService(options: CapsuleAlertOptions): Promise<CapsuleAlertService> {
  const threshold = Math.max(1, options.threshold);
  const now = options.now ?? (() => new Date());
  let state = (await options.persistence.read()) ?? { failureStreak: 0 };

  const persist = async () => {
    await options.persistence.write(state);
  };

  const service: CapsuleAlertService = {
    async recordFailure(message, details) {
      const timestamp = now().toISOString();
      const nextStreak = (state.failureStreak ?? 0) + 1;
      const previouslyAlerting = Boolean(state.alertActive);
      state = {
        ...state,
        failureStreak: nextStreak,
        lastFailureAt: timestamp,
        lastFailureMessage: message,
        alertActive: previouslyAlerting || nextStreak >= threshold
      };
      await persist();

      if (!previouslyAlerting && state.alertActive) {
        await options.notify({
          type: 'failure',
          timestamp,
          streak: state.failureStreak,
          message,
          details
        });
      }
    },

    async recordSuccess(details) {
      const timestamp = now().toISOString();
      const wasAlerting = Boolean(state.alertActive);
      const streakBefore = state.failureStreak ?? 0;
      state = {
        failureStreak: 0,
        alertActive: false,
        lastFailureAt: state.lastFailureAt,
        lastFailureMessage: state.lastFailureMessage,
        lastSuccessAt: timestamp
      };
      await persist();

      if (wasAlerting) {
        await options.notify({
          type: 'recovery',
          timestamp,
          streak: streakBefore,
          message: 'Capsule publishing recovered after consecutive failures.',
          details
        });
      }
    },

    getState() {
      return { ...state };
    }
  };

  return service;
}
