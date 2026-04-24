/**
 * probeLedger — round-trip records for the lightspeed neural probe.
 *
 * The lightspeed operator fires from a *neural layer* on the brain
 * surface, traverses the operator field down to the planet core, and
 * returns. Each leg is timestamped and tagged with the layers it crossed
 * so the network can learn the layer→organ mapping by minimising the
 * curvature of the per-layer Δt distributions.
 *
 * Pure data + throttled IndexedDB persistence per the
 * `browser-performance` constraint.
 */

export type BrainOrgan = 'surface' | 'mantle' | 'core';

export interface ProbeRecord {
  id: string;
  /** Originating neural layer index (1-9 per InstinctHierarchy). */
  originLayer: number;
  targetOrgan: BrainOrgan;
  /** Wall-clock emission time (ms since epoch). */
  tEmit: number;
  /** Wall-clock arrival at the deepest organ (ms). */
  tCore: number;
  /** Wall-clock arrival back at the originating layer (ms). */
  tReturn: number;
  /** Ordered list of neural layers the probe crossed on the way down. */
  layersTraversed: number[];
  /** Causal delay vs. flat baseline (ms) — i.e. field curvature integral. */
  delayMs: number;
  /** Q_Score sample at emission — useful for correlating with stability. */
  qScore: number;
}

const RING_CAP = 256;
const _ring: ProbeRecord[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_THROTTLE_MS = 2500;

export function recordProbe(rec: ProbeRecord): void {
  _ring.push(rec);
  if (_ring.length > RING_CAP) _ring.shift();
  scheduleFlush();
}

export function listProbes(): ReadonlyArray<ProbeRecord> {
  return _ring;
}

export function clearProbes(): void {
  _ring.length = 0;
}

/**
 * Per-layer round-trip statistics — used by Phase 2 self-localization
 * learning to determine which neural layer "sees" which organ first.
 */
export function probeStatsByLayer(): Map<number, { count: number; meanRoundTripMs: number; meanDelayMs: number }> {
  const out = new Map<number, { count: number; sumRt: number; sumDelay: number }>();
  for (const r of _ring) {
    const e = out.get(r.originLayer) ?? { count: 0, sumRt: 0, sumDelay: 0 };
    e.count += 1;
    e.sumRt += r.tReturn - r.tEmit;
    e.sumDelay += r.delayMs;
    out.set(r.originLayer, e);
  }
  const result = new Map<number, { count: number; meanRoundTripMs: number; meanDelayMs: number }>();
  for (const [layer, e] of out) {
    result.set(layer, {
      count: e.count,
      meanRoundTripMs: e.sumRt / Math.max(1, e.count),
      meanDelayMs: e.sumDelay / Math.max(1, e.count),
    });
  }
  return result;
}

function scheduleFlush(): void {
  if (_flushTimer || typeof window === 'undefined') return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    void flushToIndexedDB();
  }, FLUSH_THROTTLE_MS);
}

const DB_NAME = 'brain-probe-ledger';
const STORE = 'records';

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function flushToIndexedDB(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const rec of _ring) store.put(rec);
  } catch {
    /* non-destructive — silently skip on failure */
  } finally {
    db.close();
  }
}