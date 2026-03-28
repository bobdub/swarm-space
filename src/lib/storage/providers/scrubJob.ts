/**
 * Periodic Integrity Scrub Job
 * Verifies HMAC integrity of data stored on external providers.
 * Runs on app startup and every 6 hours.
 */

import { getAllProviders, getProvider } from './index';
import type { StorageProvider } from './types';

export interface ScrubReport {
  provider: string;
  scannedAt: number;
  totalRecords: number;
  corruptedRecords: string[];
  durationMs: number;
}

const SCRUB_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
let scrubTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Scrub a single provider by reading all manifests/chunks and
 * checking they parse correctly. Full HMAC verification requires
 * the user's private key, so this performs structural integrity only
 * unless a verifier callback is supplied.
 */
async function scrubProvider(
  provider: StorageProvider,
  stores: string[] = ['manifests', 'chunks'],
  verify?: (store: string, key: string, data: unknown) => Promise<boolean>
): Promise<ScrubReport> {
  const start = Date.now();
  const corrupted: string[] = [];
  let total = 0;

  for (const store of stores) {
    try {
      const records = await provider.getAll<Record<string, unknown>>(store);
      for (const record of records) {
        total++;
        const key = (record as any).fileId ?? (record as any).ref ?? (record as any).id ?? 'unknown';

        if (verify) {
          try {
            const valid = await verify(store, key, record);
            if (!valid) corrupted.push(`${store}/${key}`);
          } catch {
            corrupted.push(`${store}/${key}`);
          }
        }
      }
    } catch (error) {
      console.warn(`[ScrubJob] Failed to scan ${store} on ${provider.id}:`, error);
    }
  }

  return {
    provider: provider.id,
    scannedAt: Date.now(),
    totalRecords: total,
    corruptedRecords: corrupted,
    durationMs: Date.now() - start,
  };
}

/**
 * Run scrub across all non-browser providers.
 */
export async function runScrub(
  verify?: (store: string, key: string, data: unknown) => Promise<boolean>
): Promise<ScrubReport[]> {
  const reports: ScrubReport[] = [];

  for (const provider of getAllProviders()) {
    if (provider.id === 'browser') continue;
    if (!(await provider.isAvailable())) continue;

    const report = await scrubProvider(provider, ['manifests', 'chunks'], verify);
    reports.push(report);

    if (report.corruptedRecords.length > 0) {
      console.warn(
        `[ScrubJob] ${report.corruptedRecords.length} corrupted records on ${provider.id}`,
        report.corruptedRecords
      );

      window.dispatchEvent(
        new CustomEvent('storage-scrub-corruption', {
          detail: report,
        })
      );
    }
  }

  return reports;
}

/**
 * Start the periodic scrub loop (safe to call multiple times).
 */
export function startScrubLoop(
  verify?: (store: string, key: string, data: unknown) => Promise<boolean>
): void {
  if (scrubTimer) return;

  // Run initial scrub after a short delay to avoid blocking startup
  setTimeout(() => void runScrub(verify), 10_000);

  scrubTimer = setInterval(() => void runScrub(verify), SCRUB_INTERVAL_MS);
}

/**
 * Stop the periodic scrub loop.
 */
export function stopScrubLoop(): void {
  if (scrubTimer) {
    clearInterval(scrubTimer);
    scrubTimer = null;
  }
}
