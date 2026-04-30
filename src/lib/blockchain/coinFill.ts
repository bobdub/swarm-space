/**
 * coinFill — pure helpers for the Weighted-Coin UQRC lifecycle.
 *
 * SCAFFOLD STAGE — defines the deterministic math the future 4 Hz
 * scheduler will call. No side effects, no I/O, no Field access:
 * the scheduler module is the only place that samples the live UQRC
 * field and feeds `stress` into these helpers.
 *
 * Lifecycle (see docs/WEIGHTED_COINS_UQRC.md):
 *   pool → bound → filling → sealed → spent
 *
 * Invariants:
 *   - Fill is monotonically non-decreasing and clamped to [0, 1].
 *   - Accrual asymptotes near the 80% stabilization knee so coins
 *     don't snap to sealed under brief stress spikes.
 *   - Only `sealed` coins may transition to `spent` (enforced in coinSpend).
 */
import type { SwarmCoin } from "./types";

/** Stabilization knee — fill rate softens past this fraction. */
export const COIN_FILL_KNEE = 0.8;

/** Default base accrual constant (per unit stress · second). */
export const COIN_FILL_BASE_K = 0.015;

/** Width of the soft-saturation band above the knee. */
const KNEE_BAND = 0.25;

/**
 * Compute the next fill value given current fill, sampled UQRC stress,
 * and elapsed seconds. Pure function — safe to unit-test.
 */
export function nextFill(
  fill: number,
  stress: number,
  dtSeconds: number,
  k: number = COIN_FILL_BASE_K,
): number {
  const f = Math.max(0, Math.min(1, fill));
  const s = Math.max(0, stress);
  const dt = Math.max(0, dtSeconds);
  if (f >= 1 || s === 0 || dt === 0) return f;

  const kEff = f < COIN_FILL_KNEE
    ? k
    : k * Math.max(0, 1 - (f - COIN_FILL_KNEE) / KNEE_BAND);
  const df = (1 - f) * (1 - Math.exp(-kEff * s * dt));
  return Math.min(1, f + df);
}

/** True once a coin's fill has reached the seal threshold. */
export function isSealable(coin: Pick<SwarmCoin, "fill" | "fillState">): boolean {
  return (coin.fill ?? 0) >= 1 && coin.fillState !== "sealed" && coin.fillState !== "spent";
}

/** Apply seal — pure transform; persistence is the scheduler's job. */
export function applySeal<T extends Partial<SwarmCoin>>(coin: T, now: string = new Date().toISOString()): T {
  return { ...coin, fillState: "sealed", fill: 1, sealedAt: now };
}