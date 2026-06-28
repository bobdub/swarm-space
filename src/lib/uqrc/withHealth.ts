/**
 * withHealth — wrap a function so its lifecycle (entry / slow / failure /
 * success) injects amplitude into the shared App Health bus. Lets the
 * visible Q_Score badge spike when users hit stressed paths.
 *
 * Cost: `recordAppEvent` is 250 ms-debounced per key, so even chatty call
 * sites can't saturate the lattice. Original function semantics are
 * preserved exactly (never swallows throws, never changes return shape).
 *
 * Off-switch:  localStorage['uqrc.health.off'] === '1'
 */
import { recordAppEvent, type HealthDomain } from './appHealth';

export interface WithHealthOpts {
  /** Soft latency budget in ms; exceeding it injects a "slow" pulse. */
  slowMs?: number;
  /** Optional reward delta on success (cools the basin). Default +0.1. */
  successReward?: number;
}

function disabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('uqrc.health.off') === '1';
  } catch { return false; }
}

function pulse(domain: HealthDomain, key: string, amplitude: number, reward = 0): void {
  if (disabled()) return;
  try { recordAppEvent(domain, key, { amplitude, reward }); } catch { /* ignore */ }
}

export function withHealth<T extends (...args: any[]) => any>(
  domain: HealthDomain,
  key: string,
  fn: T,
  opts: WithHealthOpts = {},
): T {
  const slowMs = opts.slowMs ?? 750;
  const successReward = opts.successReward ?? 0.1;

  const wrapped = ((...args: Parameters<T>): ReturnType<T> => {
    pulse(domain, key, 0.4);
    const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let result: any;
    try {
      result = fn(...args);
    } catch (err) {
      pulse(domain, key, 1.0, -0.5);
      throw err;
    }
    if (result && typeof result.then === 'function') {
      return result.then(
        (v: unknown) => {
          const dur = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
          if (dur > slowMs) pulse(domain, key, 0.7);
          else pulse(domain, key, 0.2, successReward);
          return v;
        },
        (err: unknown) => {
          pulse(domain, key, 1.0, -0.5);
          throw err;
        },
      ) as ReturnType<T>;
    }
    const dur = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    if (dur > slowMs) pulse(domain, key, 0.7);
    else pulse(domain, key, 0.2, successReward);
    return result;
  }) as T;

  return wrapped;
}

/** One-shot spike helper for hand-instrumented call sites. */
export function spikeHealth(domain: HealthDomain, key: string, amplitude = 0.6): void {
  pulse(domain, key, amplitude);
}

/** Seed the field with the static baseline so the badge isn't flat on boot. */
export async function seedHealthBaseline(): Promise<void> {
  if (disabled()) return;
  try {
    const baseline = await import('./baseline.json', { with: { type: 'json' } } as any).then(
      (m: any) => m.default ?? m,
      () => null,
    );
    if (!baseline?.topStress) return;
    for (const row of baseline.topStress as Array<{ file: string; q: number }>) {
      try { recordAppEvent('route', `static:${row.file}`, { amplitude: Math.min(1, row.q * 2) }); } catch { /* ignore */ }
    }
  } catch { /* baseline optional */ }
}
