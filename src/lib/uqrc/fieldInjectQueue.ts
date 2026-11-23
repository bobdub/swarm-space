/**
 * Deferred field-inject queue — the bus's transit layer.
 *
 * Every `FieldEngine.inject()` drops the engine's read caches (Q-score,
 * curvature map, basins, wavelength). When bus events, app-health events
 * and peer packets each called `inject()` synchronously, a connected peer
 * walking around (presence + 2-hop relays every ~333 ms, signaling, pings)
 * kept those caches cold and did lattice work on the main thread for every
 * message.
 *
 * Instead, producers call `queueFieldInject()`. Consecutive same-sign
 * nudges for one (text, axis) are summed — the lattice write is linear and
 * clamps to ±4 after each write, so a same-sign sum lands exactly what the
 * separate writes would. A sign change starts a new entry, kept in order,
 * so a penalty that follows a reward still lands on a saturated site.
 * Everything is applied in
 * one `injectBatch()` (one cache invalidation) on a relaxed cadence: a
 * timer of FLUSH_INTERVAL_MS, then the next idle slot (bounded by
 * IDLE_TIMEOUT_MS). Between flushes the field only changes on its own
 * 4 Hz tick, so cached reads stay valid through real-time movement.
 *
 * Kill-switch: `featureFlags.deferredFieldInjects`. When off, each call is
 * a direct synchronous `inject()`, exactly like before.
 */

import {
  getSharedFieldEngine,
  resolveInjectAmplitudes,
  type InjectOpts,
  type ResolvedInject,
} from './fieldEngine';
import { getFeatureFlags } from '@/config/featureFlags';

/** Time between the first queued nudge and its flush being scheduled. */
export const FLUSH_INTERVAL_MS = 1000;
/** Upper bound on waiting for an idle slot after the interval elapses. */
export const IDLE_TIMEOUT_MS = 1000;
/** Queued lattice writes held before an early flush. */
const MAX_PENDING = 512;

/** Ordered lattice writes waiting for the next flush. */
const queue: ResolvedInject[] = [];
/** (text, axis) → the queue entry its latest nudge was added to. */
const lastEntry = new Map<string, ResolvedInject>();
let timer: ReturnType<typeof setTimeout> | null = null;
let idleHandle: number | null = null;

export interface FieldInjectQueueStats {
  /** inject requests received since load. */
  received: number;
  /** lattice writes actually applied (after summing per text/axis). */
  applied: number;
  /** batches flushed (each = one cache invalidation). */
  flushes: number;
  /** requests that bypassed the queue (flag off). */
  direct: number;
  /** entries waiting for the next flush. */
  pending: number;
}

const stats = { received: 0, applied: 0, flushes: 0, direct: 0 };

function deferEnabled(): boolean {
  try { return getFeatureFlags().deferredFieldInjects === true; } catch { return false; }
}

/**
 * Queue a field perturbation. Same options as `FieldEngine.inject()`.
 * Never throws — a field outage must not break the calling subsystem.
 */
export function queueFieldInject(text: string, opts: InjectOpts = {}): void {
  stats.received++;
  if (!deferEnabled()) {
    stats.direct++;
    try { getSharedFieldEngine().inject(text, opts); } catch (err) {
      console.warn('[fieldInjectQueue] inject failed', err);
    }
    return;
  }
  for (const c of resolveInjectAmplitudes(opts)) {
    if (!Number.isFinite(c.amplitude) || c.amplitude === 0) continue;
    const k = `${c.axis}\u0000${text}`;
    const prev = lastEntry.get(k);
    if (prev && (prev.amplitude > 0) === (c.amplitude > 0)) {
      prev.amplitude += c.amplitude;
    } else {
      const entry = { text, axis: c.axis, amplitude: c.amplitude };
      queue.push(entry);
      lastEntry.set(k, entry);
    }
  }
  if (queue.length >= MAX_PENDING) {
    flushFieldInjects();
    return;
  }
  schedule();
}

function schedule(): void {
  if (timer !== null || idleHandle !== null || queue.length === 0) return;
  timer = setTimeout(() => {
    timer = null;
    const ric = typeof window !== 'undefined'
      ? (window as Window & { requestIdleCallback?: Window['requestIdleCallback'] }).requestIdleCallback
      : undefined;
    if (typeof ric === 'function') {
      idleHandle = ric.call(window, () => {
        idleHandle = null;
        flushFieldInjects();
      }, { timeout: IDLE_TIMEOUT_MS });
    } else {
      flushFieldInjects();
    }
  }, FLUSH_INTERVAL_MS);
}

function cancelScheduled(): void {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (idleHandle !== null) {
    try {
      (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(idleHandle);
    } catch { /* ignore */ }
    idleHandle = null;
  }
}

/** Apply everything queued now (one cache invalidation). */
export function flushFieldInjects(): void {
  cancelScheduled();
  if (queue.length === 0) return;
  const entries = queue.splice(0, queue.length);
  lastEntry.clear();
  try {
    getSharedFieldEngine().injectBatch(entries);
    stats.applied += entries.length;
    stats.flushes++;
  } catch (err) {
    console.warn('[fieldInjectQueue] flush failed', err);
  }
}

export function getFieldInjectQueueStats(): FieldInjectQueueStats {
  return { ...stats, pending: queue.length };
}

// Devtools handle for A/B runs: `__swarmFieldInjects()` in the console.
if (typeof window !== 'undefined') {
  try {
    (window as unknown as { __swarmFieldInjects?: () => FieldInjectQueueStats })
      .__swarmFieldInjects = getFieldInjectQueueStats;
  } catch { /* ignore */ }
}

/** Test helper. */
export function __resetFieldInjectQueueForTests(): void {
  cancelScheduled();
  queue.length = 0;
  lastEntry.clear();
  stats.received = 0;
  stats.applied = 0;
  stats.flushes = 0;
  stats.direct = 0;
}
