import { appendAlertEvent, type AlertEventLevel } from './history';
import type { AlertEvent } from './history';

export type ObservabilityAutomationPhase = 'idle' | 'scheduled' | 'running' | 'error';

export type ObservabilityAutomationResult = 'success' | 'warning' | 'error' | null;

export interface ObservabilityAutomationState {
  status: ObservabilityAutomationPhase;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastRunDurationMs: number | null;
  lastRunLevel: ObservabilityAutomationResult;
  lastRunMessage: string | null;
  error: string | null;
  scheduleIntervalMs: number;
  isInitialized: boolean;
}

export interface ObservabilitySuiteResult {
  success: boolean;
  failures?: number;
  message?: string;
  metadata?: Record<string, unknown>;
}

type ObservabilityAutomationListener = (state: ObservabilityAutomationState) => void;

type ObservabilitySuiteRunner = () => Promise<ObservabilitySuiteResult>;

type AutomationTrigger = 'manual' | 'auto';

const STORAGE_KEY = 'alerts:automation-state:v1';
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

const listeners = new Set<ObservabilityAutomationListener>();

const defaultState: ObservabilityAutomationState = {
  status: 'idle',
  lastRunAt: null,
  nextRunAt: null,
  lastRunDurationMs: null,
  lastRunLevel: null,
  lastRunMessage: null,
  error: null,
  scheduleIntervalMs: DEFAULT_INTERVAL_MS,
  isInitialized: false,
};

let state: ObservabilityAutomationState = loadStateFromStorage();
let runner: ObservabilitySuiteRunner = async () => ({
  success: true,
  failures: 0,
  message: 'Miniflare suite completed without failures.',
});
let timerId: number | null = null;
let initializationCount = 0;

function isBrowserEnvironment(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function loadStateFromStorage(): ObservabilityAutomationState {
  if (!isBrowserEnvironment()) {
    return { ...defaultState };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...defaultState };
    }
    const parsed = JSON.parse(raw) as Partial<ObservabilityAutomationState> | null;
    if (!parsed || typeof parsed !== 'object') {
      return { ...defaultState };
    }
    return {
      ...defaultState,
      lastRunAt: typeof parsed.lastRunAt === 'number' ? parsed.lastRunAt : null,
      nextRunAt: null,
      lastRunDurationMs: typeof parsed.lastRunDurationMs === 'number' ? parsed.lastRunDurationMs : null,
      lastRunLevel:
        parsed.lastRunLevel === 'success' || parsed.lastRunLevel === 'warning' || parsed.lastRunLevel === 'error'
          ? parsed.lastRunLevel
          : null,
      lastRunMessage: typeof parsed.lastRunMessage === 'string' ? parsed.lastRunMessage : null,
      error: null,
      scheduleIntervalMs:
        typeof parsed.scheduleIntervalMs === 'number' && Number.isFinite(parsed.scheduleIntervalMs)
          ? Math.max(10_000, parsed.scheduleIntervalMs)
          : DEFAULT_INTERVAL_MS,
      isInitialized: false,
    } satisfies ObservabilityAutomationState;
  } catch (error) {
    console.warn('[alerts] Failed to load automation state from storage', error);
    return { ...defaultState };
  }
}

function persistState(current: ObservabilityAutomationState): void {
  if (!isBrowserEnvironment()) {
    return;
  }
  try {
    const serialized = JSON.stringify({
      lastRunAt: current.lastRunAt,
      lastRunDurationMs: current.lastRunDurationMs,
      lastRunLevel: current.lastRunLevel,
      lastRunMessage: current.lastRunMessage,
      scheduleIntervalMs: current.scheduleIntervalMs,
    });
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    console.warn('[alerts] Failed to persist automation state', error);
  }
}

function emit(partial: Partial<ObservabilityAutomationState>): void {
  state = {
    ...state,
    ...partial,
  };
  persistState(state);
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (error) {
      console.warn('[alerts] Automation listener threw', error);
    }
  }
}

function clearTimer(): void {
  if (timerId != null && typeof window !== 'undefined') {
    window.clearTimeout(timerId);
    timerId = null;
  }
}

function appendAutomationEvent(level: AlertEventLevel, message: string, metadata?: AlertEvent['metadata']): void {
  appendAlertEvent({
    type: 'miniflare',
    level,
    message,
    metadata,
    createdAt: Date.now(),
  });
}

function scheduleNextRun(intervalOverride?: number): void {
  if (!isBrowserEnvironment()) {
    emit({ nextRunAt: null, status: state.status === 'running' ? 'running' : 'idle' });
    return;
  }
  const interval = intervalOverride ?? state.scheduleIntervalMs ?? DEFAULT_INTERVAL_MS;
  clearTimer();
  const targetTimestamp = Date.now() + interval;
  timerId = window.setTimeout(() => {
    timerId = null;
    void runSuite('auto');
  }, interval);
  emit({ status: state.status === 'running' ? 'running' : 'scheduled', nextRunAt: targetTimestamp });
}

function determineResultLevel(result: ObservabilitySuiteResult): ObservabilityAutomationResult {
  if (!result.success) {
    return 'error';
  }
  const failures = result.failures ?? 0;
  return failures > 0 ? 'warning' : 'success';
}

async function runSuite(trigger: AutomationTrigger): Promise<void> {
  if (state.status === 'running') {
    return;
  }
  clearTimer();
  emit({ status: 'running', error: null, nextRunAt: null });
  const startedAt = Date.now();
  try {
    const result = await runner();
    const finishedAt = Date.now();
    const duration = finishedAt - startedAt;
    const level = determineResultLevel(result);
    const message =
      result.message ??
      (level === 'success'
        ? 'Miniflare suite completed successfully.'
        : level === 'warning'
          ? 'Miniflare suite completed with warnings.'
          : 'Miniflare suite failed.');

    appendAutomationEvent(level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info', message, {
      trigger,
      durationMs: duration,
      failures: result.failures ?? 0,
      ...result.metadata,
    });

    emit({
      status: 'idle',
      lastRunAt: finishedAt,
      lastRunDurationMs: duration,
      lastRunLevel: level,
      lastRunMessage: message,
      error: level === 'error' ? message : null,
    });
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : 'Unknown automation failure';
    appendAutomationEvent('error', `Miniflare suite failed to execute: ${failureMessage}`, { trigger });
    emit({
      status: 'error',
      lastRunAt: Date.now(),
      lastRunDurationMs: null,
      lastRunLevel: 'error',
      lastRunMessage: failureMessage,
      error: failureMessage,
    });
  } finally {
    scheduleNextRun();
  }
}

export function initializeObservabilityAutomation(options: { intervalMs?: number; runImmediately?: boolean } = {}): () => void {
  const interval = options.intervalMs ?? state.scheduleIntervalMs ?? DEFAULT_INTERVAL_MS;
  emit({
    scheduleIntervalMs: interval,
    isInitialized: true,
  });

  if (initializationCount === 0) {
    if (options.runImmediately) {
      void runSuite('auto');
    } else {
      scheduleNextRun(interval);
    }
  } else if (options.intervalMs && options.intervalMs !== state.scheduleIntervalMs) {
    scheduleNextRun(interval);
  }

  initializationCount += 1;

  return () => {
    initializationCount = Math.max(0, initializationCount - 1);
    if (initializationCount === 0) {
      clearTimer();
      emit({ status: 'idle', nextRunAt: null, isInitialized: false });
    }
  };
}

export function setObservabilitySuiteRunner(nextRunner: ObservabilitySuiteRunner): void {
  runner = nextRunner;
}

export async function triggerObservabilitySuite(): Promise<void> {
  await runSuite('manual');
}

export function getObservabilityAutomationState(): ObservabilityAutomationState {
  return state;
}

export function subscribeToObservabilityAutomation(
  listener: ObservabilityAutomationListener,
): () => void {
  listeners.add(listener);
  try {
    listener(state);
  } catch (error) {
    console.warn('[alerts] Automation listener threw during subscribe', error);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function __resetObservabilityAutomationForTests(): void {
  clearTimer();
  initializationCount = 0;
  state = { ...defaultState };
  persistState(state);
  listeners.clear();
  runner = async () => ({
    success: true,
    failures: 0,
    message: 'Miniflare suite completed without failures.',
  });
}
