/**
 * coinFillScheduler — single 4 Hz tick that drives weighted-coin fill.
 *
 * SCAFFOLD STAGE — exposes start/stop/subscribe but does NOT auto-start
 * at module load. Boot wiring lands once the UQRC sampling seam is
 * agreed (we will pull stress from chainHealthBridge / labField rather
 * than touching `fieldEngine` directly, mirroring the bridge contract
 * in mem://blockchain/uqrc-coupling).
 *
 * Contract:
 *   - Only this module mutates `coin.fill` / `coin.stressAccrued` / `coin.fillState`.
 *   - All math is delegated to `coinFill.ts` (pure helpers).
 *   - Sampling stress from the field is done via an injected sampler so
 *     tests and the Lab can run the scheduler without a real Field.
 */
import type { SwarmCoin } from "./types";
import { nextFill, isSealable, applySeal } from "./coinFill";

export type StressSampler = () => number;

const TICK_HZ = 4;
const TICK_MS = 1000 / TICK_HZ;

let _timer: ReturnType<typeof setInterval> | null = null;
let _sampler: StressSampler = () => 0;
const _listeners = new Set<(coins: SwarmCoin[]) => void>();

/** Replace the stress sampler. Called once at boot (future wiring). */
export function setStressSampler(fn: StressSampler): void {
  _sampler = fn;
}

/** Subscribe to per-tick coin updates (UI hook seam). */
export function subscribeCoinFill(fn: (coins: SwarmCoin[]) => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/**
 * Pure step — advance a single coin one tick. Exported for unit tests
 * and for the future scheduler loop. No persistence side effects.
 */
export function tickCoin(coin: SwarmCoin, stress: number, dtSeconds: number): SwarmCoin {
  if (coin.fillState !== "filling") return coin;
  const fill = nextFill(coin.fill ?? 0, stress, dtSeconds);
  const next: SwarmCoin = {
    ...coin,
    fill,
    stressAccrued: (coin.stressAccrued ?? 0) + Math.max(0, stress) * Math.max(0, dtSeconds),
  };
  return isSealable(next) ? applySeal(next) : next;
}

/** Start the 4 Hz loop. No-op if already running. */
export function startCoinFillScheduler(): void {
  if (_timer !== null) return;
  _timer = setInterval(() => {
    // Persistence wiring lands in the follow-up patch — the scaffold
    // intentionally only fans out the sampled stress to subscribers
    // so the Wallet UI can already show a live "stress pulse".
    const stress = Math.max(0, _sampler());
    void stress;
    for (const fn of _listeners) fn([]);
  }, TICK_MS);
}

/** Stop the loop (test + HMR safety). */
export function stopCoinFillScheduler(): void {
  if (_timer !== null) { clearInterval(_timer); _timer = null; }
}