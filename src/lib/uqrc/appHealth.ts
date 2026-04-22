/**
 * App Health Bus — single source of truth for whole-application health.
 *
 * Routes p2p / storage / stream / mining / route events into the shared
 * UQRC field engine using namespaced keys (e.g. "p2p:peer-abc12345").
 * Subscribers see one Q_Score, hotspots, and a λ-derived trend instead of
 * five independent dashboards.
 *
 * Cost-bounded:
 *   • Per-key 250 ms debounce inside `recordAppEvent` so chatty subsystems
 *     can't saturate the lattice.
 *   • UI subscriptions throttled to 1 Hz.
 *   • Console log throttled to once per 5 s.
 *
 * Reads only via FieldEngine public API (inject / curvature / basins / λ),
 * so `uqrcConformance.test.ts` keeps passing.
 */

import { getSharedFieldEngine, type FieldEngine } from './fieldEngine';

export type HealthDomain = 'p2p' | 'storage' | 'stream' | 'mining' | 'route';

export interface RecordEventOpts {
  reward?: number;
  trust?: number;
  amplitude?: number;
}

export interface HotKey {
  key: string;
  curvature: number;
}

export interface ColdKey {
  key: string;
}

export interface AppHealth {
  qScore: number;
  basins: number;
  lambda: number;
  hotspots: HotKey[];
  coldspots: ColdKey[];
  trend: 'cooling' | 'stable' | 'heating';
  pinCount: number;
}

export interface DomainHealth {
  domain: HealthDomain;
  qScore: number;
  hotspots: HotKey[];
  coldspots: ColdKey[];
  keyCount: number;
}

const DEBOUNCE_MS = 250;
const UI_THROTTLE_MS = 1000;
const LOG_THROTTLE_MS = 5000;
const TREND_WINDOW = 8;

const lastInjectAt = new Map<string, number>();
const knownKeys = new Map<string, HealthDomain>();
const qHistory: number[] = [];

let lastUiNotifyAt = 0;
let lastLogAt = 0;
let unsubscribeField: (() => void) | null = null;

const uiListeners = new Set<(h: AppHealth) => void>();

function namespace(domain: HealthDomain, key: string): string {
  // Cap key length so debounce map can't grow unbounded with full peer ids etc.
  const safe = (key || '').toString().slice(0, 64);
  return `${domain}:${safe}`;
}

/**
 * Record an application event. Internally injects into the shared field with
 * key `${domain}:${key}`. Per-key 250 ms debounce.
 */
export function recordAppEvent(
  domain: HealthDomain,
  key: string,
  opts: RecordEventOpts = {},
): void {
  const ns = namespace(domain, key);
  const now = Date.now();
  const last = lastInjectAt.get(ns) ?? 0;
  if (now - last < DEBOUNCE_MS) return;
  lastInjectAt.set(ns, now);
  knownKeys.set(ns, domain);

  try {
    const fe: FieldEngine = getSharedFieldEngine();
    fe.inject(ns, {
      amplitude: opts.amplitude,
      reward: opts.reward,
      trust: opts.trust,
    });
  } catch (err) {
    // Field outage must never break the calling subsystem.
    if (typeof console !== 'undefined') {
      console.warn('[AppHealth] inject failed:', err);
    }
  }
}

function computeTrend(): AppHealth['trend'] {
  if (qHistory.length < 4) return 'stable';
  const half = Math.floor(qHistory.length / 2);
  let earlier = 0;
  let later = 0;
  for (let i = 0; i < half; i++) earlier += qHistory[i];
  for (let i = half; i < qHistory.length; i++) later += qHistory[i];
  earlier /= half;
  later /= qHistory.length - half;
  const delta = later - earlier;
  if (delta > 0.005) return 'heating';
  if (delta < -0.005) return 'cooling';
  return 'stable';
}

function topHotKeys(domain?: HealthDomain, limit = 3): HotKey[] {
  const fe = getSharedFieldEngine();
  const out: HotKey[] = [];
  for (const [ns, dom] of knownKeys.entries()) {
    if (domain && dom !== domain) continue;
    let c = 0;
    try { c = fe.getCurvatureForText(ns); } catch { c = 0; }
    out.push({ key: ns, curvature: c });
  }
  out.sort((a, b) => b.curvature - a.curvature);
  return out.slice(0, limit);
}

function topColdKeys(domain?: HealthDomain, limit = 3): ColdKey[] {
  const fe = getSharedFieldEngine();
  const cold: ColdKey[] = [];
  for (const [ns, dom] of knownKeys.entries()) {
    if (domain && dom !== domain) continue;
    try {
      if (fe.isTextInBasin(ns)) cold.push({ key: ns });
    } catch { /* ignore */ }
    if (cold.length >= limit) break;
  }
  return cold;
}

/** Read whole-app health right now. */
export function getAppHealth(): AppHealth {
  const fe = getSharedFieldEngine();
  let qScore = 0;
  let basins = 0;
  let lambda = 0;
  let pinCount = 0;
  try {
    qScore = fe.getQScore();
    basins = fe.getBasins().length;
    lambda = fe.getDominantWavelength();
    pinCount = fe.getPinCount();
  } catch { /* leave zeroes */ }

  return {
    qScore,
    basins,
    lambda,
    hotspots: topHotKeys(undefined, 3),
    coldspots: topColdKeys(undefined, 3),
    trend: computeTrend(),
    pinCount,
  };
}

/** Read health for a single domain only. */
export function getDomainHealth(domain: HealthDomain): DomainHealth {
  const fe = getSharedFieldEngine();
  let total = 0;
  let count = 0;
  for (const [ns, dom] of knownKeys.entries()) {
    if (dom !== domain) continue;
    count++;
    try { total += fe.getCurvatureForText(ns); } catch { /* ignore */ }
  }
  const qScore = count > 0 ? total / count : 0;
  return {
    domain,
    qScore,
    hotspots: topHotKeys(domain, 3),
    coldspots: topColdKeys(domain, 3),
    keyCount: count,
  };
}

function notifyUiListeners(): void {
  if (uiListeners.size === 0) return;
  const now = Date.now();
  if (now - lastUiNotifyAt < UI_THROTTLE_MS) return;
  lastUiNotifyAt = now;

  const health = getAppHealth();
  qHistory.push(health.qScore);
  if (qHistory.length > TREND_WINDOW) qHistory.shift();

  if (now - lastLogAt >= LOG_THROTTLE_MS) {
    lastLogAt = now;
    const hot = health.hotspots.map((h) => h.key).slice(0, 2).join(',') || 'none';
    console.log(
      `[AppHealth] Q=${health.qScore.toFixed(4)} trend=${health.trend} hotspots=${hot}`,
    );
  }

  for (const fn of uiListeners) {
    try { fn(health); } catch { /* ignore listener errors */ }
  }
}

function ensureSubscribed(): void {
  if (unsubscribeField) return;
  try {
    const fe = getSharedFieldEngine();
    unsubscribeField = fe.subscribe(() => notifyUiListeners());
  } catch {
    // Field engine unavailable; subscribers will see stable zeroes.
  }
}

/**
 * Subscribe to whole-app health. Throttled to ≤ 1 Hz.
 * Returns an unsubscribe function.
 */
export function subscribeAppHealth(fn: (h: AppHealth) => void): () => void {
  uiListeners.add(fn);
  ensureSubscribed();
  // Fire once with current state for immediate UI hydration.
  try { fn(getAppHealth()); } catch { /* ignore */ }
  return () => {
    uiListeners.delete(fn);
  };
}

/** Test helper — clears bus state without touching the shared field engine. */
export function __resetAppHealthForTests(): void {
  lastInjectAt.clear();
  knownKeys.clear();
  qHistory.length = 0;
  lastUiNotifyAt = 0;
  lastLogAt = 0;
  if (unsubscribeField) {
    unsubscribeField();
    unsubscribeField = null;
  }
  uiListeners.clear();
}