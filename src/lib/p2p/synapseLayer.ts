/**
 * ═══════════════════════════════════════════════════════════════════════
 * SYNAPSE LAYER — Per-Peer Smoothness Memory for the Bus Cycle
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Tiny, deterministic memory of past handshake outcomes per peer. The
 * Global Cell Bus uses this as one input to its smoothness score so that
 * historically reliable peers naturally rise to the top of the candidate
 * list — without any external coordination.
 *
 *   S_smooth(peer, t) = exp(-Δt / τ) · successRate
 *
 * Δt is the age of the most recent handshake, τ = 5 minutes.
 * Stored locally only. Bounded LRU (256 entries).
 * ═══════════════════════════════════════════════════════════════════════
 */

const STORAGE_KEY = 'swarm-bus-synapse';
const TAU_MS = 5 * 60_000;          // half-life ~ 3.5 min, useful window ~10 min
const MAX_ENTRIES = 256;

interface SynapseEntry {
  /** number of successful handshakes observed */
  s: number;
  /** total handshakes observed (success + failure) */
  n: number;
  /** last update timestamp (ms) */
  t: number;
  /** smoothed RTT (ms) — null until measured */
  r: number | null;
}

let cache: Map<string, SynapseEntry> | null = null;

function load(): Map<string, SynapseEntry> {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, SynapseEntry>;
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v.s === 'number' && typeof v.n === 'number' && typeof v.t === 'number') {
          cache.set(k, { s: v.s, n: v.n, t: v.t, r: typeof v.r === 'number' ? v.r : null });
        }
      }
    }
  } catch { /* ignore */ }
  return cache;
}

function persist(): void {
  if (!cache) return;
  try {
    // LRU: evict oldest entries past MAX_ENTRIES
    if (cache.size > MAX_ENTRIES) {
      const sorted = Array.from(cache.entries()).sort((a, b) => a[1].t - b[1].t);
      const drop = sorted.slice(0, cache.size - MAX_ENTRIES);
      for (const [k] of drop) cache.delete(k);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(cache)));
    }
  } catch { /* ignore */ }
}

/**
 * Record a handshake outcome.
 * Called from swarmMesh open/close/error lifecycle.
 */
export function recordHandshake(peerId: string, success: boolean, rttMs?: number): void {
  if (!peerId) return;
  const m = load();
  const e = m.get(peerId) ?? { s: 0, n: 0, t: 0, r: null };
  e.n += 1;
  if (success) e.s += 1;
  e.t = Date.now();
  if (typeof rttMs === 'number' && rttMs >= 0 && rttMs < 60_000) {
    e.r = e.r === null ? rttMs : e.r * 0.7 + rttMs * 0.3;
  }
  m.set(peerId, e);
  persist();
}

/**
 * Smoothness ∈ [0, 1] — combines success rate and recency.
 * Returns 0 for unknown peers (neutral newcomer).
 */
export function getSmoothness(peerId: string, now = Date.now()): number {
  const e = load().get(peerId);
  if (!e || e.n === 0) return 0;
  const successRate = e.s / e.n;
  const recency = Math.exp(-Math.max(0, now - e.t) / TAU_MS);
  return Math.max(0, Math.min(1, successRate * recency));
}

/**
 * Smoothed RTT in ms, or null if unmeasured.
 */
export function getSmoothedRtt(peerId: string): number | null {
  return load().get(peerId)?.r ?? null;
}

/** Test/debug only — clear in-memory cache. */
export function _resetSynapseForTests(): void {
  cache = null;
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}