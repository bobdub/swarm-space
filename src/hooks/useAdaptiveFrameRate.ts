import { useEffect, useState } from 'react';
import { getGuardrailsMultiplier } from '@/lib/guardrails/browserHealth';
import { subscribeGuardrails } from '@/lib/guardrails/bus';

/**
 * Returns the interval (ms) a non-essential animation should tick at,
 * scaled by the current Browser QScore level.
 *
 * Healthy → baseMs. Warn → 2×. Degrade → 4×. Critical → 8×.
 */
export function useAdaptiveFrameRate(baseMs = 16): number {
  const [interval, setInt] = useState<number>(baseMs * getGuardrailsMultiplier());
  useEffect(() => {
    const recompute = () => setInt(baseMs * getGuardrailsMultiplier());
    recompute();
    const unsub = subscribeGuardrails((evt) => {
      if (evt.type === 'qscore') recompute();
    });
    return unsub;
  }, [baseMs]);
  return interval;
}