/**
 * Chain runner — walks the user's loading chain, pausing before any step
 * whose minQScore isn't currently met. Resumes automatically when the
 * browser QScore recovers.
 */

import { emitGuardrails, subscribeGuardrails } from './bus';
import { getBrowserQScore, startBrowserHealth } from './browserHealth';
import { getLoadingPoint, listLoadingPoints, registerDefaultPoints } from './loadingChain';
import { getLoadingChainConfig } from './config';
import { recordChainSample } from './deviceProfile';

const RESUME_STABLE_MS = 2500;

let running = false;
let paused = false;
let cursor = 0;
let pauseGate: { resolve: () => void } | null = null;
let lastPauseAt = 0;
let unsubQ: (() => void) | null = null;

function scheduleIdle(fn: () => void): void {
  const g = globalThis as typeof globalThis & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (typeof g.requestIdleCallback === 'function') {
    g.requestIdleCallback(fn, { timeout: 1500 });
  } else {
    setTimeout(fn, 200);
  }
}

function releasePause(): void {
  if (pauseGate) {
    const p = pauseGate;
    pauseGate = null;
    paused = false;
    emitGuardrails({ type: 'chain-resumed', at: Date.now() });
    p.resolve();
  }
}

function watchForRecovery(minQScore: number): void {
  if (unsubQ) return;
  let stableSince = 0;
  unsubQ = subscribeGuardrails((evt) => {
    if (evt.type !== 'qscore') return;
    if (evt.score >= minQScore) {
      if (stableSince === 0) stableSince = Date.now();
      if (Date.now() - stableSince >= RESUME_STABLE_MS) {
        unsubQ?.(); unsubQ = null;
        releasePause();
      }
    } else {
      stableSince = 0;
    }
  });
}

export async function startChain(): Promise<void> {
  if (running) return;
  running = true;
  startBrowserHealth();

  // Register defaults once. Idempotent.
  registerDefaultPoints();

  const cfg = getLoadingChainConfig();
  const known = new Set(listLoadingPoints().map((p) => p.id));
  const order = [...cfg.order.filter((id) => known.has(id))];
  // Append any registered points the config forgot, keeps forward-compat.
  for (const p of listLoadingPoints()) if (!order.includes(p.id)) order.push(p.id);

  for (cursor = 0; cursor < order.length; cursor++) {
    const point = getLoadingPoint(order[cursor]);
    if (!point) continue;

    if (cfg.adaptive && !point.essential) {
      const q = getBrowserQScore();
      if (q < point.minQScore) {
        paused = true;
        lastPauseAt = Date.now();
        emitGuardrails({ type: 'chain-paused', reason: `${point.label} needs Q≥${point.minQScore.toFixed(2)} (Q=${q.toFixed(2)})`, at: lastPauseAt });
        recordChainSample({ pausedAt: point.id, qScore: q });
        await new Promise<void>((resolve) => {
          pauseGate = { resolve };
          watchForRecovery(point.minQScore);
        });
      }
    }

    emitGuardrails({ type: 'chain-step', id: point.id, state: 'starting', at: Date.now() });
    try {
      await point.start();
      emitGuardrails({ type: 'chain-step', id: point.id, state: 'done', at: Date.now() });
    } catch (err) {
      emitGuardrails({
        type: 'chain-step',
        id: point.id,
        state: 'error',
        at: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await new Promise<void>((r) => scheduleIdle(r));
  }
  running = false;
}

export function isChainPaused(): boolean { return paused; }