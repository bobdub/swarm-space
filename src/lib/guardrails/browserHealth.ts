/**
 * Browser Health monitor — samples cheap performance signals and
 * combines them into a Browser QScore in [0..1] (1 = healthy).
 *
 * Pure observer. Never mutates subsystem state. Emits transitions on
 * the guardrails bus and mirrors samples into the App Health bus under
 * the `browser` domain so the existing badge picks them up.
 *
 * All observers degrade gracefully when the browser lacks the API.
 */

import { emitGuardrails, type GuardrailsLevel } from './bus';
import { recordAppEvent } from '@/lib/uqrc/appHealth';

const SAMPLE_MS = 1000;
const HYSTERESIS_MS = 3000;

const THRESHOLDS: Record<Exclude<GuardrailsLevel, 'healthy'>, number> = {
  warn: 0.55,
  degrade: 0.35,
  critical: 0.20,
};

interface Metrics {
  fps: number;             // last-second frames per second
  longTaskMs: number;      // total long-task time in the last second
  loopLagMs: number;       // setTimeout(0) drift
  heapPressure: number;    // usedJSHeap / heapLimit (0..1)
}

let started = false;
let rafFrames = 0;
let lastFpsMark = 0;
let longTaskAccum = 0;
let longTaskObs: PerformanceObserver | null = null;
let lastLoopMark = 0;
let lastLoopLagMs = 0;
let currentScore = 1;
let currentLevel: GuardrailsLevel = 'healthy';
let pendingLevel: GuardrailsLevel = 'healthy';
let pendingSince = 0;
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let loopTimer: ReturnType<typeof setInterval> | null = null;

function classify(score: number): GuardrailsLevel {
  if (score < THRESHOLDS.critical) return 'critical';
  if (score < THRESHOLDS.degrade) return 'degrade';
  if (score < THRESHOLDS.warn) return 'warn';
  return 'healthy';
}

function readHeapPressure(): number {
  try {
    const p = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    if (!p || !p.jsHeapSizeLimit) return 0;
    return Math.min(1, p.usedJSHeapSize / p.jsHeapSizeLimit);
  } catch { return 0; }
}

function combine(m: Metrics): number {
  // FPS band: 60 → 1.0, 30 → 0.5, 10 → 0.0
  const fpsScore = Math.max(0, Math.min(1, (m.fps - 10) / 50));
  // Long task budget: <50ms/s ≈ healthy, 500ms/s ≈ dead
  const ltScore = Math.max(0, 1 - m.longTaskMs / 500);
  // Loop lag budget: <20ms healthy, >250ms critical
  const lagScore = Math.max(0, 1 - Math.max(0, m.loopLagMs - 20) / 230);
  // Heap: <0.75 fine, 0.95+ critical
  const heapScore = m.heapPressure > 0 ? Math.max(0, 1 - Math.max(0, m.heapPressure - 0.75) / 0.20) : 1;
  // Weighted average — lag dominates because it directly maps to stall risk.
  return 0.30 * fpsScore + 0.30 * ltScore + 0.30 * lagScore + 0.10 * heapScore;
}

function rafLoop(ts: number) {
  if (!started) return;
  if (lastFpsMark === 0) lastFpsMark = ts;
  rafFrames++;
  requestAnimationFrame(rafLoop);
}

function tickSample() {
  const now = performance.now();
  const elapsed = Math.max(1, now - lastFpsMark);
  const fps = (rafFrames * 1000) / elapsed;
  rafFrames = 0;
  lastFpsMark = now;

  const ltMs = longTaskAccum;
  longTaskAccum = 0;

  const metrics: Metrics = {
    fps,
    longTaskMs: ltMs,
    loopLagMs: lastLoopLagMs,
    heapPressure: readHeapPressure(),
  };

  const score = combine(metrics);
  // Smooth with EMA to reduce flapping.
  currentScore = 0.6 * currentScore + 0.4 * score;

  const nextLevel = classify(currentScore);
  if (nextLevel !== currentLevel) {
    if (nextLevel !== pendingLevel) {
      pendingLevel = nextLevel;
      pendingSince = Date.now();
    } else if (Date.now() - pendingSince >= HYSTERESIS_MS) {
      currentLevel = nextLevel;
      emitGuardrails({ type: 'qscore', score: currentScore, level: currentLevel, at: Date.now() });
    }
  } else {
    pendingLevel = nextLevel;
  }

  // Mirror into App Health as `browser:qscore`. Reward = qscore, trust = qscore.
  try {
    recordAppEvent('browser' as never, 'qscore', {
      reward: currentScore,
      trust: currentScore,
      amplitude: 0.1,
    });
  } catch { /* ignore */ }
}

function loopProbe() {
  const now = performance.now();
  if (lastLoopMark > 0) {
    lastLoopLagMs = Math.max(0, now - lastLoopMark - 250);
  }
  lastLoopMark = now;
}

export function startBrowserHealth(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  requestAnimationFrame(rafLoop);
  sampleTimer = setInterval(tickSample, SAMPLE_MS);
  loopTimer = setInterval(loopProbe, 250);
  try {
    if ('PerformanceObserver' in window) {
      longTaskObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTaskAccum += entry.duration;
      });
      longTaskObs.observe({ type: 'longtask', buffered: false } as PerformanceObserverInit);
    }
  } catch { /* longtask unsupported (Safari) */ }
}

export function stopBrowserHealth(): void {
  started = false;
  if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
  if (longTaskObs) { try { longTaskObs.disconnect(); } catch { /* ignore */ } longTaskObs = null; }
}

export function getBrowserQScore(): number { return currentScore; }
export function getBrowserLevel(): GuardrailsLevel { return currentLevel; }

/**
 * Multiplier ready to plug into throttled subsystems.
 * healthy → 1, warn → 2, degrade → 4, critical → 8.
 */
export function getGuardrailsMultiplier(): number {
  switch (currentLevel) {
    case 'critical': return 8;
    case 'degrade': return 4;
    case 'warn': return 2;
    default: return 1;
  }
}