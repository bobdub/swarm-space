import { useEffect, useState } from 'react';
import { getBrowserQScore, getBrowserLevel, startBrowserHealth } from '@/lib/guardrails/browserHealth';
import { subscribeGuardrails, type GuardrailsLevel } from '@/lib/guardrails/bus';

export interface BrowserQScoreState {
  score: number;
  level: GuardrailsLevel;
}

/** Subscribe to Browser QScore transitions. Boots the monitor on first use. */
export function useBrowserQScore(): BrowserQScoreState {
  const [state, setState] = useState<BrowserQScoreState>(() => ({
    score: getBrowserQScore(),
    level: getBrowserLevel(),
  }));

  useEffect(() => {
    startBrowserHealth();
    const unsub = subscribeGuardrails((evt) => {
      if (evt.type === 'qscore') setState({ score: evt.score, level: evt.level });
    });
    // Poll once per second so score number moves even between level changes.
    const t = setInterval(() => {
      setState((prev) => {
        const s = getBrowserQScore();
        if (Math.abs(s - prev.score) < 0.01 && getBrowserLevel() === prev.level) return prev;
        return { score: s, level: getBrowserLevel() };
      });
    }, 1000);
    return () => { unsub(); clearInterval(t); };
  }, []);

  return state;
}