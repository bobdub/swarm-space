/**
 * UQRC Health Bridge
 * ──────────────────
 * Closes the observer loop between content-delivery layers and the UQRC
 * field. All additive; raw `u` is never broadcast — only derived qScore
 * is read back through fieldEngine.getStatus().
 *
 * Signals IN  (raise curvature when content can't reach users):
 *   - StressMonitor snapshots → fieldEngine.inject('stress', ...)
 *   - DeliveryTelemetry        → fieldEngine.inject('content', ...)
 *
 * Signals IN  (anchor the lattice when delivery infrastructure is healthy):
 *   - mineHealthValidator + custody depth → fieldEngine.pin('mine.health')
 *
 * Signal OUT  (consumers throttle/accelerate based on derived qScore):
 *   - getFieldHealthMultiplier()  → torrent producer back-off, mining defer
 *   - shouldAccelerateRedundancy() → speed up sweep for stuck manifests
 */

import { getSharedFieldEngine } from './fieldEngine';
import { getStressMonitor, type StressSnapshot } from '../torrent/stressMonitor';
import { subscribeDelivery, getDeliverySnapshot, type DeliverySnapshot } from '../pipeline/deliveryTelemetry';

const MINE_HEALTH_POLL_MS = 30_000;
const HIGH_Q_THRESHOLD = 1.5;
const SEVERE_Q_THRESHOLD = 2.0;

let started = false;
let mineHealthTimer: ReturnType<typeof setInterval> | null = null;
let stressUnsub: (() => void) | null = null;
let deliveryUnsub: (() => void) | null = null;
let lastSevereSince: number | null = null;
let mineHealthPinned = false;

/**
 * Map StressSnapshot → field injection. High score = negative reward bump.
 */
function injectStress(snap: StressSnapshot): void {
  const engine = getSharedFieldEngine();
  // Negative reward bump scales with score. Trust drops as load rises.
  engine.inject('stress', {
    reward: -Math.min(1, snap.score),
    trust: Math.max(0, 1 - snap.score),
    amplitude: 0.15 + 0.25 * snap.score,
  });
}

function injectDelivery(snap: DeliverySnapshot): void {
  const engine = getSharedFieldEngine();
  const pendingCount = snap.pendingManifestIds.size;
  // Aggregate severity 0..1 from pending + failures
  const severity = Math.min(
    1,
    pendingCount / 8 +
      snap.chunkFailures / 20 +
      snap.decryptRetries / 10 +
      snap.decryptFailures / 5,
  );
  if (severity <= 0) return;
  engine.inject('content', {
    reward: -severity,
    trust: 1 - severity,
    amplitude: 0.1 + 0.3 * severity,
    axis: 1, // context axis — distinct from raw stress on axis 0
  });
}

/**
 * Read the runtime mesh-mine-health hint exposed on window by the swarm
 * runtime. Avoids importing the standalone module to keep this bridge
 * dependency-free for tests.
 */
function readMeshHealthHint(): { miningActive: boolean; peerCount: number; meshHealth?: number; weightedCoinBonus?: number } {
  if (typeof window === 'undefined') {
    return { miningActive: false, peerCount: 0 };
  }
  const w = window as Window & {
    __swarmMeshState?: { miningActive?: boolean; peerCount?: number; connectedPeers?: number; meshHealth?: number; weightedCoinBonus?: number; updatedAt?: number };
  };
  const meta = w.__swarmMeshState;
  if (!meta) return { miningActive: false, peerCount: 0 };
  const fresh = typeof meta.updatedAt === 'number' && Date.now() - meta.updatedAt <= 90_000;
  if (!fresh) return { miningActive: false, peerCount: 0 };
  return {
    miningActive: !!meta.miningActive,
    peerCount: typeof meta.peerCount === 'number' ? meta.peerCount : meta.connectedPeers ?? 0,
    meshHealth: meta.meshHealth,
    weightedCoinBonus: meta.weightedCoinBonus,
  };
}

function tickMineHealthPin(): void {
  const engine = getSharedFieldEngine();
  const hint = readMeshHealthHint();
  // Healthy iff mining active AND ≥ 1 peer (custody depth proxy).
  const isHealthy = hint.miningActive && hint.peerCount >= 1;
  if (isHealthy) {
    const meshScore01 = typeof hint.meshHealth === 'number'
      ? Math.max(0, Math.min(1, hint.meshHealth / 100))
      : 0.6;
    // Stiffness scales with weighted coin bonus (matches MineHealth thresholds).
    const weight = typeof hint.weightedCoinBonus === 'number' ? hint.weightedCoinBonus : 0;
    const target = meshScore01 + (weight >= 50 ? 0.3 : weight >= 20 ? 0.15 : 0);
    engine.pin('mine.health', Math.min(1.5, target));
    mineHealthPinned = true;
  } else if (mineHealthPinned) {
    // Release by pinning to neutral 0 — fieldPin overwrites prior pin.
    engine.pin('mine.health', 0);
    mineHealthPinned = false;
  }
}

/**
 * Multiplier in [0.25, 1.0] derived from current Q_Score.
 * Q ≤ 0.5  → 1.0  (no throttle)
 * Q ≥ 2.5  → 0.25 (heavy throttle)
 */
export function getFieldHealthMultiplier(): number {
  try {
    const q = getSharedFieldEngine().getQScore();
    if (!Number.isFinite(q) || q <= 0.5) return 1.0;
    if (q >= 2.5) return 0.25;
    // Linear interpolation between (0.5,1.0) and (2.5,0.25)
    const t = (q - 0.5) / 2.0;
    return Math.max(0.25, Math.min(1.0, 1.0 - 0.75 * t));
  } catch {
    return 1.0;
  }
}

/**
 * True when the field is stressed AND there are pending manifests.
 * Replication sweep uses this to raise its cadence for the exact stuck IDs.
 */
export function shouldAccelerateRedundancy(): { accelerate: boolean; targets: string[] } {
  try {
    const q = getSharedFieldEngine().getQScore();
    const snap = getDeliverySnapshot();
    if (q >= HIGH_Q_THRESHOLD && snap.pendingManifestIds.size > 0) {
      return { accelerate: true, targets: Array.from(snap.pendingManifestIds) };
    }
    return { accelerate: false, targets: [] };
  } catch {
    return { accelerate: false, targets: [] };
  }
}

/**
 * True if Q_Score has been > SEVERE_Q_THRESHOLD for ≥ sustainedMs.
 * Mining loop calls this to defer one block cycle under cognitive load.
 */
export function shouldDeferMining(sustainedMs = 10_000): boolean {
  try {
    const q = getSharedFieldEngine().getQScore();
    const now = Date.now();
    if (q > SEVERE_Q_THRESHOLD) {
      if (lastSevereSince === null) lastSevereSince = now;
      return now - lastSevereSince >= sustainedMs;
    }
    lastSevereSince = null;
    return false;
  } catch {
    return false;
  }
}

export function startHealthBridge(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  try {
    const monitor = getStressMonitor();
    stressUnsub = monitor.subscribe(injectStress);
  } catch (err) {
    console.warn('[HealthBridge] stress subscribe failed:', err);
  }

  try {
    deliveryUnsub = subscribeDelivery(injectDelivery);
  } catch (err) {
    console.warn('[HealthBridge] delivery subscribe failed:', err);
  }

  // Prime + interval poll for mine health pin.
  try { tickMineHealthPin(); } catch { /* ignore */ }
  mineHealthTimer = setInterval(tickMineHealthPin, MINE_HEALTH_POLL_MS);

  console.log('[HealthBridge] ✅ stress + delivery + mineHealth bridged into UQRC field');
}

export function stopHealthBridge(): void {
  if (mineHealthTimer) clearInterval(mineHealthTimer);
  mineHealthTimer = null;
  stressUnsub?.(); stressUnsub = null;
  deliveryUnsub?.(); deliveryUnsub = null;
  started = false;
  lastSevereSince = null;
  mineHealthPinned = false;
}

/** Test helper. */
export function __resetHealthBridgeForTests(): void {
  stopHealthBridge();
}
