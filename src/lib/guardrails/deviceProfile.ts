/**
 * Device profile — rolling stats about how the local browser behaves
 * across boots. Read-only recommendations only; never mutates settings.
 */

const KEY = 'swarm-device-profile';
const MAX_SAMPLES = 20;

interface ChainSample {
  pausedAt: string;
  qScore: number;
  at: number;
}

export interface DeviceProfile {
  samples: ChainSample[];
  avgPauseByPoint: Record<string, number>;
  updatedAt: number;
}

function empty(): DeviceProfile {
  return { samples: [], avgPauseByPoint: {}, updatedAt: 0 };
}

function load(): DeviceProfile {
  if (typeof window === 'undefined') return empty();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty();
    const p = JSON.parse(raw) as Partial<DeviceProfile>;
    return {
      samples: Array.isArray(p.samples) ? p.samples.slice(-MAX_SAMPLES) : [],
      avgPauseByPoint: p.avgPauseByPoint ?? {},
      updatedAt: p.updatedAt ?? 0,
    };
  } catch { return empty(); }
}

function save(p: DeviceProfile): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export function recordChainSample(sample: Omit<ChainSample, 'at'>): void {
  const p = load();
  p.samples.push({ ...sample, at: Date.now() });
  if (p.samples.length > MAX_SAMPLES) p.samples = p.samples.slice(-MAX_SAMPLES);
  const counts: Record<string, number> = {};
  for (const s of p.samples) counts[s.pausedAt] = (counts[s.pausedAt] ?? 0) + 1;
  p.avgPauseByPoint = counts;
  p.updatedAt = Date.now();
  save(p);
}

export function getDeviceProfile(): DeviceProfile { return load(); }

/**
 * Suggests promoting a chain point that pauses often to a later slot.
 * Returns the point id most in need of demotion, or null.
 */
export function suggestDemotion(minSamples = 5): string | null {
  const p = load();
  if (p.samples.length < minSamples) return null;
  let worst: { id: string; count: number } | null = null;
  for (const [id, count] of Object.entries(p.avgPauseByPoint)) {
    if (!worst || count > worst.count) worst = { id, count };
  }
  return worst && worst.count >= Math.ceil(minSamples / 2) ? worst.id : null;
}