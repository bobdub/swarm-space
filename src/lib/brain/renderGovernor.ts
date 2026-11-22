/**
 * Render Governor — the 3D world's neural dispatch bus.
 *
 * Like the P2P neural state engine, it learns online (Welford mean/variance
 * per subsystem plus an EWMA frame predictor) and gates work by instinct tier:
 *   critical  — player physics, camera: every frame, never throttled.
 *   proximity — nearby interactive motion: every frame while calm, paced when stressed.
 *   ambiance  — background effects (ash, distant life): paced always, slower under stress.
 * The governor only decides cadence; callers receive the accumulated delta so
 * motion stays time-correct whatever rate they run at.
 */
export type RenderTier = 'critical' | 'proximity' | 'ambiance';
export type RenderPressure = 'calm' | 'stressed' | 'strained';

export interface WelfordStat { n: number; mean: number; m2: number }

export function welfordPush(s: WelfordStat, x: number): WelfordStat {
  const n = s.n + 1;
  const d = x - s.mean;
  const mean = s.mean + d / n;
  return { n, mean, m2: s.m2 + d * (x - mean) };
}
export function welfordStd(s: WelfordStat): number {
  return s.n > 1 ? Math.sqrt(s.m2 / (s.n - 1)) : 0;
}

export const FRAME_BUDGET_MS = 16.7;
export const EWMA_ALPHA = 0.1;
/**
 * Seconds between runs, per tier and pressure (0 = every frame).
 *
 * Pacing is switched off: every tier runs every frame, as it did before the
 * governor. Profiling the Brain showed main-thread JS is under 5% of frame
 * time; frames are bound by GPU drawing. Skipping JS frames therefore made
 * sea life, hens, ash and remote avatars visibly choppy without making
 * frames any faster. The governor still measures pressure, which now drives
 * the render resolution instead (see AdaptiveDpr). To bring pacing back,
 * restore non-zero intervals here.
 */
export const TIER_INTERVAL_S: Record<RenderTier, Record<RenderPressure, number>> = {
  critical: { calm: 0, stressed: 0, strained: 0 },
  proximity: { calm: 0, stressed: 0, strained: 0 },
  ambiance: { calm: 0, stressed: 0, strained: 0 },
};

export function pressureFor(predictedMs: number): RenderPressure {
  if (!Number.isFinite(predictedMs)) return 'calm';
  if (predictedMs > FRAME_BUDGET_MS * 1.6) return 'strained';
  if (predictedMs > FRAME_BUDGET_MS * 1.15) return 'stressed';
  return 'calm';
}

export class RenderGovernor {
  predictedMs = FRAME_BUDGET_MS;
  frame: WelfordStat = { n: 0, mean: 0, m2: 0 };
  readonly subsystems = new Map<string, WelfordStat>();
  private listeners = new Set<(p: RenderPressure) => void>();
  private last: RenderPressure = 'calm';

  /** Train on one rendered frame's wall delta (ms). */
  observeFrame(ms: number): void {
    // Ignore tab-suspension gaps and garbage so one hitch can't poison training.
    if (!Number.isFinite(ms) || ms <= 0 || ms > 250) return;
    this.frame = welfordPush(this.frame, ms);
    this.predictedMs = EWMA_ALPHA * ms + (1 - EWMA_ALPHA) * this.predictedMs;
    const p = this.pressure();
    if (p !== this.last) {
      this.last = p;
      this.listeners.forEach((fn) => { try { fn(p); } catch { /* listener */ } });
    }
  }

  /** Train on one subsystem's measured cost (ms). */
  observeSubsystem(name: string, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    const s = this.subsystems.get(name) ?? { n: 0, mean: 0, m2: 0 };
    this.subsystems.set(name, welfordPush(s, ms));
  }

  pressure(): RenderPressure { return pressureFor(this.predictedMs); }
  intervalFor(tier: RenderTier): number { return TIER_INTERVAL_S[tier][this.pressure()]; }
  /** Level changes only (mirrors the guardrails bus). */
  onPressure(fn: (p: RenderPressure) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}

export const renderGovernor = new RenderGovernor();

/**
 * Per-caller gate: accumulate delta, release it when the tier's interval has
 * elapsed. Returns the delta to apply, or null to skip this frame.
 */
export function createTierGate(tier: RenderTier, governor: RenderGovernor = renderGovernor) {
  let acc = 0;
  return (delta: number): number | null => {
    acc += Number.isFinite(delta) && delta > 0 ? delta : 0;
    if (acc < governor.intervalFor(tier)) return null;
    const out = acc;
    acc = 0;
    return out;
  };
}
