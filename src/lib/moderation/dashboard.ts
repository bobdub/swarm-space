import type { AlertRecord, AlertType } from '../../../services/moderation/types';

type DashboardTotals = Record<AlertType, number>;

export interface ModeratorDashboardData {
  totals: DashboardTotals;
  recentAlerts: AlertRecord[];
  highRiskAlerts: AlertRecord[];
  lastUpdated: number;
  trend: Array<{ label: string; count: number; type: AlertType }>;
}

interface RawDashboardResponse {
  totals?: Partial<DashboardTotals>;
  recentAlerts?: AlertRecord[];
  highRiskAlerts?: AlertRecord[];
  trend?: Array<{ label: string; count: number; type: AlertType }>;
  lastUpdated?: number;
}

const SAMPLE_ALERTS: AlertRecord[] = [
  {
    id: 'sample-1',
    type: 'content-flag',
    createdAt: Date.now() - 1000 * 60 * 2,
    userId: 'user-demo-13',
    description: 'Content flagged with risk score 0.84',
    score: 0.84,
    metadata: {
      triggers: [
        { type: 'keyword', description: 'Mentions "free money"', weight: 0.3 },
        { type: 'link-density', description: 'Contains 4 external links', weight: 0.3 }
      ]
    }
  },
  {
    id: 'sample-2',
    type: 'sylabis-limit',
    createdAt: Date.now() - 1000 * 60 * 20,
    originToken: '3af2d-demo',
    description: 'Sylabis limit exceeded: 11 signups in rolling 24h window',
    metadata: { limit: 10 }
  },
  {
    id: 'sample-3',
    type: 'post-interval',
    createdAt: Date.now() - 1000 * 60 * 25,
    userId: 'user-demo-4',
    description: 'Post attempted 150ms after previous submission',
    metadata: { minIntervalMs: 300 }
  }
];

const DEFAULT_TOTALS: DashboardTotals = {
  'sylabis-limit': 0,
  'post-interval': 0,
  'post-volume': 0,
  'content-flag': 0
};

function coerceTotals(partial?: Partial<DashboardTotals>): DashboardTotals {
  return {
    'sylabis-limit': partial?.['sylabis-limit'] ?? 0,
    'post-interval': partial?.['post-interval'] ?? 0,
    'post-volume': partial?.['post-volume'] ?? 0,
    'content-flag': partial?.['content-flag'] ?? 0
  };
}

function fallbackFromLocalStorage(): ModeratorDashboardData {
  const alerts = loadAlertsFromStorage();
  const totals = { ...DEFAULT_TOTALS };
  for (const alert of alerts) {
    totals[alert.type] += 1;
  }

  const recentAlerts = alerts
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 25);
  const highRiskAlerts = recentAlerts
    .filter(alert => alert.type === 'content-flag' && (alert.score ?? 0) >= 0.6)
    .sort((a, b) => {
      const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return b.createdAt - a.createdAt;
    });

  const trend = buildTrend(alerts);

  return {
    totals,
    recentAlerts: recentAlerts.length > 0 ? recentAlerts : SAMPLE_ALERTS,
    highRiskAlerts: highRiskAlerts.length > 0 ? highRiskAlerts : SAMPLE_ALERTS.filter(alert => alert.type === 'content-flag'),
    lastUpdated: Date.now(),
    trend
  };
}

function loadAlertsFromStorage(): AlertRecord[] {
  if (typeof window === 'undefined') {
    return SAMPLE_ALERTS;
  }

  try {
    const raw = window.localStorage.getItem('moderation.alerts');
    if (!raw) {
      return SAMPLE_ALERTS;
    }
    const parsed = JSON.parse(raw) as AlertRecord[];
    if (!Array.isArray(parsed)) {
      return SAMPLE_ALERTS;
    }
    return parsed;
  } catch (error) {
    console.warn('[moderation] Failed to parse alert cache', error);
    return SAMPLE_ALERTS;
  }
}

function buildTrend(alerts: AlertRecord[]): Array<{ label: string; count: number; type: AlertType }> {
  const buckets = new Map<string, { label: string; counts: DashboardTotals; bucket: number }>();
  const bucketSizeMs = 60 * 60 * 1000;

  for (const alert of alerts) {
    const bucket = Math.floor(alert.createdAt / bucketSizeMs);
    const key = bucket.toString();
    if (!buckets.has(key)) {
      buckets.set(key, {
        bucket,
        label: new Date(bucket * bucketSizeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        counts: { ...DEFAULT_TOTALS }
      });
    }
    buckets.get(key)!.counts[alert.type] += 1;
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.bucket - b.bucket)
    .flatMap(item =>
      (Object.keys(item.counts) as AlertType[]).map(type => ({
        label: item.label,
        count: item.counts[type],
        type
      })),
    )
    .filter(entry => entry.count > 0)
    .slice(-40);
}

function coerceDashboard(raw: RawDashboardResponse | undefined): ModeratorDashboardData | undefined {
  if (!raw) {
    return undefined;
  }

  const totals = coerceTotals(raw.totals);
  const recentAlerts = (raw.recentAlerts ?? []).slice(0, 50);
  const highRiskAlerts = (raw.highRiskAlerts ?? [])
    .slice()
    .sort((a, b) => {
      const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return b.createdAt - a.createdAt;
    })
    .slice(0, 20);
  const trend = (raw.trend ?? []).slice(-40);

  return {
    totals,
    recentAlerts,
    highRiskAlerts,
    lastUpdated: raw.lastUpdated ?? Date.now(),
    trend
  };
}

export async function fetchModeratorDashboard(signal?: AbortSignal): Promise<ModeratorDashboardData> {
  try {
    const response = await fetch('/api/moderation/dashboard', { signal });
    if (!response.ok) {
      throw new Error(`Dashboard request failed with status ${response.status}`);
    }
    const raw = (await response.json()) as RawDashboardResponse;
    const coerced = coerceDashboard(raw);
    if (coerced) {
      return coerced;
    }
    return fallbackFromLocalStorage();
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      console.warn('[moderation] Falling back to local dashboard data', error);
    }
    return fallbackFromLocalStorage();
  }
}
