import { useEffect, useState } from 'react';
import {
  subscribeAppHealth,
  getAppHealth,
  getDomainHealth,
  type AppHealth,
  type DomainHealth,
  type HealthDomain,
} from '@/lib/uqrc/appHealth';

export interface UseAppHealthResult extends AppHealth {
  domain(d: HealthDomain): DomainHealth;
}

/**
 * Subscribe to whole-app health. Re-renders ≤ 1 Hz (throttled inside the bus).
 */
export function useAppHealth(): UseAppHealthResult {
  const [health, setHealth] = useState<AppHealth>(() => getAppHealth());

  useEffect(() => {
    const unsub = subscribeAppHealth(setHealth);
    return unsub;
  }, []);

  return {
    ...health,
    domain: (d: HealthDomain) => getDomainHealth(d),
  };
}