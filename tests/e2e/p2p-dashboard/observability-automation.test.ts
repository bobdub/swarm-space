import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { installMemoryStorage } from './testUtils';
import {
  __resetObservabilityAutomationForTests,
  getObservabilityAutomationState,
  initializeObservabilityAutomation,
  setObservabilitySuiteRunner,
  triggerObservabilitySuite,
} from '@/lib/alerts/automation';
import { getAlertHistory } from '@/lib/alerts/history';

let cleanupStorage: (() => void) | null = null;
let cleanupAutomation: (() => void) | null = null;

describe('observability automation', () => {
  beforeEach(() => {
    cleanupStorage = installMemoryStorage();
    __resetObservabilityAutomationForTests();
  });

  afterEach(() => {
    cleanupAutomation?.();
    cleanupAutomation = null;
    cleanupStorage?.();
    cleanupStorage = null;
  });

  it('records successful suite runs and appends info alerts', async () => {
    cleanupAutomation = initializeObservabilityAutomation({ intervalMs: 50 });
    setObservabilitySuiteRunner(async () => ({
      success: true,
      failures: 0,
      message: 'Suite succeeded',
      metadata: { example: true },
    }));

    await triggerObservabilitySuite();

    const state = getObservabilityAutomationState();
    expect(state.lastRunLevel).toBe('success');
    expect(state.lastRunMessage).toBe('Suite succeeded');
    expect(state.nextRunAt).not.toBeNull();

    const history = getAlertHistory();
    expect(history[0]?.type).toBe('miniflare');
    expect(history[0]?.level).toBe('info');
    expect(history[0]?.metadata?.trigger).toBe('manual');
  });

  it('flags failures and emits error events', async () => {
    cleanupAutomation = initializeObservabilityAutomation({ intervalMs: 50 });
    setObservabilitySuiteRunner(async () => ({ success: false, message: 'execution halted' }));

    await triggerObservabilitySuite();

    const state = getObservabilityAutomationState();
    expect(state.lastRunLevel).toBe('error');
    expect(state.error).toContain('execution halted');

    const history = getAlertHistory();
    expect(history[0]?.level).toBe('error');
    expect(history[0]?.message).toContain('execution halted');
  });
});
