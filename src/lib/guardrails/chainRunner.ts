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

const RECOVERY_POLL_MS = 1000;

function watchForRecovery(minQScore: number): void {
  if (unsubQ) return;
  let stableSince = 0;
  const check = (score: number) => {
    if (score >= minQScore) {
      if (stableSince === 0) stableSince = Date.now();
      if (Date.now() - stableSince >= RESUME_STABLE_MS) {
        unsubQ?.(); unsubQ = null;
        releasePause();
      }
    } else {
      stableSince = 0;
    }
  };
  const unsubBus = subscribeGuardrails((evt) => {
    if (evt.type === 'qscore') check(evt.score);
  });
  // The bus only reports level changes. A score that recovers and then
  // stays inside one level sends a single event, which never satisfied the
  // stable window, so the chain stayed paused (in the Brain that kept the
  // mesh from ever starting discovery). Sample the score directly too.
  const poll = setInterval(() => check(getBrowserQScore()), RECOVERY_POLL_MS);
  unsubQ = () => { unsubBus(); clearInterval(poll); };
}

export async function startChain(): Promise<void> {
  if (running) return;
  running = true;
  startBrowserHealth();

  // Register defaults once. Idempotent.
  registerDefaultPoints();

  const cfg = getLoadingChainConfig();
  const known = new Set(listLoadingPoints().map((p) => p.id));
  const configured = [...cfg.order.filter((id) => known.has(id))];
  // Append any registered points the config forgot, keeps forward-compat.
  for (const p of listLoadingPoints()) if (!configured.includes(p.id)) configured.push(p.id);
  // Essential points never wait: a pause on an earlier, heavier point (the
  // Brain's game functions on a busy frame) used to hold them back too.
  const isEssential = (id: string) => getLoadingPoint(id)?.essential === true;
  const order = [...configured.filter(isEssential), ...configured.filter((id) => !isEssential(id))];

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