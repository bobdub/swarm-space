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
 *   • Hotspot / coldspot / domain curvature scans memoised for 1 s and
 *     only recomputed on demand, over at most MAX_KNOWN_KEYS keys.
 *   • Console log throttled to once per 5 s.
 *
 * Reads only via FieldEngine public API (inject / curvature / basins / λ),
 * so `uqrcConformance.test.ts` keeps passing.
 */

import { getSharedFieldEngine } from './fieldEngine';
import { queueFieldInject } from './fieldInjectQueue';

export type HealthDomain = 'p2p' | 'storage' | 'stream' | 'mining' | 'route' | 'browser';

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
/** Curvature scans over the known keys are reused for this long. */
const SCAN_TTL_MS = 1000;
/** Least-recently-recorded keys beyond this are forgotten (peer ids etc.). */
const MAX_KNOWN_KEYS = 256;

const lastInjectAt = new Map<string, number>();
const knownKeys = new Map<string, HealthDomain>();
const qHistory: number[] = [];
/** Bumped whenever the key set changes, so a cached scan never hides a key. */
let keysVersion = 0;

interface ScanEntry { key: string; domain: HealthDomain; curvature: number }
interface ScanCache {
  at: number;
  version: number;
  entries: ScanEntry[];
  cold: Map<string, ColdKey[]>;
}
let scanCache: ScanCache | null = null;

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
 * Record an application event. Queues a field perturbation with key
 * `${domain}:${key}` (applied in the next batched flush). Per-key 250 ms
 * debounce.
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
  rememberKey(ns, domain);

  // Queued, not applied inline: the nudge lands with the next batched
  // flush instead of dropping the field caches on every event. Never throws.
  queueFieldInject(ns, {
    amplitude: opts.amplitude,
    reward: opts.reward,
    trust: opts.trust,
  });
}

/** Keep `knownKeys` in least-recently-recorded order and bounded. */
function rememberKey(ns: string, domain: HealthDomain): void {
  if (knownKeys.has(ns)) {
    knownKeys.delete(ns);
    knownKeys.set(ns, domain);
    return;
  }
  knownKeys.set(ns, domain);
  keysVersion++;
  while (knownKeys.size > MAX_KNOWN_KEYS) {
    const oldest = knownKeys.keys().next().value as string;
    knownKeys.delete(oldest);
    lastInjectAt.delete(oldest);
  }
}

/**
 * Curvature of every known key, computed at most once per SCAN_TTL_MS (or
 * when the key set changes) and only when someone actually reads health.
 * Every hotspot, coldspot and domain view shares this one scan instead of
 * re-hashing every key through the field per call.
 */
function scanKeys(): ScanCache {
  const now = Date.now();
  if (scanCache && scanCache.version === keysVersion && now - scanCache.at < SCAN_TTL_MS) {
    return scanCache;
  }
  const fe = getSharedFieldEngine();
  const entries: ScanEntry[] = [];
  for (const [ns, dom] of knownKeys.entries()) {
    let c = 0;
    try { c = fe.getCurvatureForText(ns); } catch { c = 0; }
    entries.push({ key: ns, domain: dom, curvature: c });
  }
  scanCache = { at: now, version: keysVersion, entries, cold: new Map() };
  return scanCache;
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
  const out: HotKey[] = [];
  for (const e of scanKeys().entries) {
    if (domain && e.domain !== domain) continue;
    out.push({ key: e.key, curvature: e.curvature });
  }
  out.sort((a, b) => b.curvature - a.curvature);
  return out.slice(0, limit);
}

function topColdKeys(domain?: HealthDomain, limit = 3): ColdKey[] {
  const scan = scanKeys();
  const memoKey = `${domain ?? '*'}:${limit}`;
  const memo = scan.cold.get(memoKey);
  if (memo) return memo;
  const fe = getSharedFieldEngine();
  const cold: ColdKey[] = [];
  for (const e of scan.entries) {
    if (domain && e.domain !== domain) continue;
    try {
      if (fe.isTextInBasin(e.key)) cold.push({ key: e.key });
    } catch { /* ignore */ }
    if (cold.length >= limit) break;
  }
  scan.cold.set(memoKey, cold);
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
  let total = 0;
  let count = 0;
  for (const e of scanKeys().entries) {
    if (e.domain !== domain) continue;
    count++;
    total += e.curvature;
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
  keysVersion = 0;
  scanCache = null;
  qHistory.length = 0;
  lastUiNotifyAt = 0;
  lastLogAt = 0;
  if (unsubscribeField) {
    unsubscribeField();
    unsubscribeField = null;
  }
  uiListeners.clear();
}