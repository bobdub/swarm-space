import { useEffect, useState } from 'react';
import { getSharedFieldEngine } from '@/lib/uqrc/fieldEngine';
import type { ClosureReport } from '@/lib/uqrc/closure';

/**
 * Subscribe to the ℓ_min closure report at 1 Hz (well under the 4 Hz
 * field tick). Read-only — the closure module is a pure observer.
 */
export function useUqrcClosure(): ClosureReport | null {
  const [report, setReport] = useState<ClosureReport | null>(null);
  useEffect(() => {
    const engine = getSharedFieldEngine();
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      try {
        setReport(engine.getClosureReport());
      } catch {
        // ignore — engine may not be ready yet
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return report;
}
