/**
 * Shared beat: fixed-rate heartbeats numbered from the Cadence Clock.
 *
 * Every device that has calibrated `networkNow()` against the site or the
 * mesh agrees on the same instant, so `beatAt(period)` gives every peer the
 * same beat number at the same moment. A loop started with `startBeatLoop`
 * wakes on the beat boundary itself (not wherever its own setInterval
 * happened to start), so two devices running the same loop step together
 * instead of up to one period apart, and the timer never drifts because
 * each wait is measured to the next boundary.
 *
 * A device with no calibration falls back to its own clock, exactly as
 * `networkNow()` does, so solo play is unchanged.
 */
import { networkNow } from './networkClock';

/** The shared beat number for `periodMs` at time `nowMs` (default: now). */
export function beatAt(periodMs: number, nowMs: number = networkNow()): number {
  return Math.floor(nowMs / periodMs);
}

/** Milliseconds until the next shared beat boundary. Always > 0. */
export function msUntilNextBeat(periodMs: number, nowMs: number = networkNow()): number {
  const into = ((nowMs % periodMs) + periodMs) % periodMs;
  return periodMs - into;
}

export interface BeatLoop {
  stop(): void;
}

/**
 * Call `onBeat(beat, elapsedBeats)` on every shared beat of `periodMs`.
 * `elapsedBeats` is how many beats passed since the last call (1 normally,
 * more after a throttled background tab, 0 never). The first call reports 1.
 */
export function startBeatLoop(
  periodMs: number,
  onBeat: (beat: number, elapsedBeats: number) => void,
): BeatLoop {
  let lastBeat: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const arm = () => {
    if (stopped) return;
    // +1 ms so the wake lands just past the boundary, not just before it.
    timer = setTimeout(fire, msUntilNextBeat(periodMs) + 1);
  };

  const fire = () => {
    timer = null;
    if (stopped) return;
    const beat = beatAt(periodMs);
    const elapsed = lastBeat === null ? 1 : beat - lastBeat;
    // A clock correction can step backwards; wait for the beat to catch up.
    if (elapsed > 0) {
      lastBeat = beat;
      try { onBeat(beat, elapsed); } catch (err) {
        console.warn('[sharedBeat] beat handler failed', err);
      }
    }
    arm();
  };

  arm();
  return {
    stop() {
      stopped = true;
      if (timer !== null) { clearTimeout(timer); timer = null; }
    },
  };
}
