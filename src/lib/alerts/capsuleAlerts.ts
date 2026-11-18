/**
 * Consecutive-failure tracking for the rendezvous capsule publisher
 * (`ops/scripts/publish-capsule.ts`). See `ops/capsules/README.md`.
 *
 * Each failed publish extends a streak. Once the streak reaches the
 * threshold a failure alert fires (again on every later failure while the
 * streak continues). The first success after an alert fires a recovery
 * notice and resets the streak. State is kept through injected persistence
 * so the module stays free of Node and browser APIs.
 */

export interface CapsuleAlertState {
  consecutiveFailures: number;
  alerting: boolean;
  lastFailureAt: number | null;
  lastFailureMessage: string | null;
  lastSuccessAt: number | null;
}

export interface CapsuleAlertPersistence {
  read(): Promise<CapsuleAlertState | null>;
  write(state: CapsuleAlertState): Promise<void>;
}

export interface CapsuleAlertEvent {
  type: 'failure' | 'recovery';
  message: string;
  streak: number;
  details?: Record<string, unknown>;
}

export interface CapsuleAlertServiceOptions {
  threshold?: number;
  persistence: CapsuleAlertPersistence;
  notify: (event: CapsuleAlertEvent) => void;
  now?: () => number;
}

export interface CapsuleAlertService {
  recordFailure(message: string): Promise<CapsuleAlertState>;
  recordSuccess(details?: Record<string, unknown>): Promise<CapsuleAlertState>;
  getState(): Promise<CapsuleAlertState>;
}

export const DEFAULT_CAPSULE_ALERT_THRESHOLD = 3;

export function emptyCapsuleAlertState(): CapsuleAlertState {
  return {
    consecutiveFailures: 0,
    alerting: false,
    lastFailureAt: null,
    lastFailureMessage: null,
    lastSuccessAt: null,
  };
}

function normalizeState(raw: CapsuleAlertState | null): CapsuleAlertState {
  const base = emptyCapsuleAlertState();
  if (!raw || typeof raw !== 'object') return base;
  const failures = Number(raw.consecutiveFailures);
  return {
    consecutiveFailures: Number.isInteger(failures) && failures > 0 ? failures : 0,
    alerting: raw.alerting === true,
    lastFailureAt: typeof raw.lastFailureAt === 'number' ? raw.lastFailureAt : null,
    lastFailureMessage: typeof raw.lastFailureMessage === 'string' ? raw.lastFailureMessage : null,
    lastSuccessAt: typeof raw.lastSuccessAt === 'number' ? raw.lastSuccessAt : null,
  };
}

export function createCapsuleAlertService(options: CapsuleAlertServiceOptions): CapsuleAlertService {
  const threshold =
    Number.isInteger(options.threshold) && (options.threshold as number) > 0
      ? (options.threshold as number)
      : DEFAULT_CAPSULE_ALERT_THRESHOLD;
  const now = options.now ?? (() => Date.now());

  async function load(): Promise<CapsuleAlertState> {
    try {
      return normalizeState(await options.persistence.read());
    } catch {
      return emptyCapsuleAlertState();
    }
  }

  return {
    getState: load,

    async recordFailure(message) {
      const prev = await load();
      const next: CapsuleAlertState = {
        ...prev,
        consecutiveFailures: prev.consecutiveFailures + 1,
        lastFailureAt: now(),
        lastFailureMessage: message,
      };
      if (next.consecutiveFailures >= threshold) {
        next.alerting = true;
        options.notify({
          type: 'failure',
          message: `Capsule publish failed ${next.consecutiveFailures} times in a row: ${message}`,
          streak: next.consecutiveFailures,
        });
      }
      await options.persistence.write(next);
      return next;
    },

    async recordSuccess(details) {
      const prev = await load();
      const next: CapsuleAlertState = {
        ...prev,
        consecutiveFailures: 0,
        alerting: false,
        lastSuccessAt: now(),
      };
      if (prev.alerting) {
        options.notify({
          type: 'recovery',
          message: `Capsule publish recovered after ${prev.consecutiveFailures} consecutive failures`,
          streak: prev.consecutiveFailures,
          details,
        });
      }
      await options.persistence.write(next);
      return next;
    },
  };
}
