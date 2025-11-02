import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getAlertWebhookConfig,
  subscribeToAlertWebhookConfig,
  updateAlertWebhookConfig,
  type AlertWebhookConfig,
} from '@/lib/alerts/webhookConfig';
import {
  getAlertHistory,
  subscribeToAlertHistory,
  type AlertEvent,
  type AlertEventLevel,
} from '@/lib/alerts/history';
import {
  getObservabilityAutomationState,
  initializeObservabilityAutomation,
  subscribeToObservabilityAutomation,
  triggerObservabilitySuite,
  type ObservabilityAutomationState,
  type ObservabilityAutomationResult,
} from '@/lib/alerts/automation';

function formatRelativeTime(timestamp: number | null, now: number): string | null {
  if (!timestamp) {
    return null;
  }
  const delta = now - timestamp;
  if (delta < 0) {
    return 'in the future';
  }
  if (delta < 1_000) {
    return 'just now';
  }
  if (delta < 60_000) {
    const seconds = Math.floor(delta / 1_000);
    return `${seconds}s ago`;
  }
  if (delta < 3_600_000) {
    const minutes = Math.floor(delta / 60_000);
    return `${minutes}m ago`;
  }
  const hours = Math.floor(delta / 3_600_000);
  return `${hours}h ago`;
}

function formatFutureTime(target: number | null, now: number): string | null {
  if (!target) {
    return null;
  }
  const delta = target - now;
  if (delta <= 0) {
    return 'any moment';
  }
  if (delta < 60_000) {
    const seconds = Math.max(1, Math.round(delta / 1_000));
    return `in ${seconds}s`;
  }
  if (delta < 3_600_000) {
    const minutes = Math.max(1, Math.round(delta / 60_000));
    return `in ${minutes}m`;
  }
  const hours = Math.max(1, Math.round(delta / 3_600_000));
  return `in ${hours}h`;
}

function levelToBadgeVariant(level: AlertEventLevel): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (level) {
    case 'warning':
      return 'secondary';
    case 'error':
      return 'destructive';
    default:
      return 'outline';
  }
}

function resultToBadgeVariant(result: ObservabilityAutomationResult): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (result) {
    case 'success':
      return 'default';
    case 'warning':
      return 'secondary';
    case 'error':
      return 'destructive';
    default:
      return 'outline';
  }
}

function resultToBadgeText(result: ObservabilityAutomationResult): string {
  switch (result) {
    case 'success':
      return 'Suite healthy';
    case 'warning':
      return 'Suite warnings';
    case 'error':
      return 'Suite failed';
    default:
      return 'Awaiting suite';
  }
}

function computeStatusLabel(status: ObservabilityAutomationState['status'], error: string | null, nextLabel: string | null): string {
  if (status === 'running') {
    return 'Suite running';
  }
  if (status === 'scheduled') {
    return nextLabel ? `Next run ${nextLabel}` : 'Next run scheduled';
  }
  if (status === 'error') {
    return error ? `Automation error: ${error}` : 'Automation error';
  }
  return 'Automation idle';
}

export interface AlertEventView extends AlertEvent {
  timeLabel: string;
  levelVariant: 'default' | 'secondary' | 'outline' | 'destructive';
}

export interface ObservabilityAutomationView extends ObservabilityAutomationState {
  nextRunLabel: string | null;
  lastRunLabel: string | null;
  statusLabel: string;
  badgeVariant: 'default' | 'secondary' | 'outline' | 'destructive';
  badgeText: string;
}

export interface AlertingStatusView {
  config: AlertWebhookConfig;
  isWebhookEnabled: boolean;
  events: AlertEventView[];
  recentEvents: AlertEventView[];
  latestEvent: AlertEventView | null;
  hasRecentAlerts: boolean;
  automation: ObservabilityAutomationView;
  actions: {
    updateWebhook: (update: Partial<AlertWebhookConfig>) => AlertWebhookConfig;
    toggleWebhook: (enabled: boolean) => AlertWebhookConfig;
    triggerAutomation: () => Promise<void>;
  };
}

export function useAlertingStatus(): AlertingStatusView {
  const [config, setConfig] = useState<AlertWebhookConfig>(() => getAlertWebhookConfig());
  const [history, setHistory] = useState<AlertEvent[]>(() => getAlertHistory());
  const [automation, setAutomation] = useState<ObservabilityAutomationState>(() => getObservabilityAutomationState());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const unsubscribe = subscribeToAlertWebhookConfig(setConfig);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToAlertHistory(setHistory);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToObservabilityAutomation(setAutomation);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const dispose = initializeObservabilityAutomation();
    return dispose;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const updateWebhook = useCallback((update: Partial<AlertWebhookConfig>) => {
    const next = updateAlertWebhookConfig(update);
    setConfig(next);
    return next;
  }, []);

  const toggleWebhook = useCallback(
    (enabled: boolean) => updateWebhook({ enabled }),
    [updateWebhook],
  );

  const triggerAutomation = useCallback(async () => {
    await triggerObservabilitySuite();
  }, []);

  const eventViews = useMemo<AlertEventView[]>(
    () =>
      history.map((event) => ({
        ...event,
        timeLabel: formatRelativeTime(event.createdAt, now) ?? 'just now',
        levelVariant: levelToBadgeVariant(event.level),
      })),
    [history, now],
  );

  const automationView = useMemo<ObservabilityAutomationView>(() => {
    const nextRunLabel = automation.status === 'running' ? 'running now' : formatFutureTime(automation.nextRunAt, now);
    const lastRunLabel = formatRelativeTime(automation.lastRunAt, now);
    const badgeVariant = resultToBadgeVariant(automation.lastRunLevel);
    const badgeText = resultToBadgeText(automation.lastRunLevel);
    const statusLabel = computeStatusLabel(automation.status, automation.error, nextRunLabel);

    return {
      ...automation,
      nextRunLabel,
      lastRunLabel,
      statusLabel,
      badgeVariant,
      badgeText,
    } satisfies ObservabilityAutomationView;
  }, [automation, now]);

  const recentEvents = useMemo(() => eventViews.slice(0, 4), [eventViews]);
  const latestEvent = recentEvents.length > 0 ? recentEvents[0] : null;

  return {
    config,
    isWebhookEnabled: Boolean(config.enabled && config.endpointUrl.length > 0),
    events: eventViews,
    recentEvents,
    latestEvent,
    hasRecentAlerts: eventViews.length > 0,
    automation: automationView,
    actions: {
      updateWebhook,
      toggleWebhook,
      triggerAutomation,
    },
  } satisfies AlertingStatusView;
}
