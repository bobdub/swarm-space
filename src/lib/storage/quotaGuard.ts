/**
 * Quota Guard — hard-block asset transfers when local storage is nearly full.
 * Prevents users from losing tokens or coins to failed IndexedDB writes.
 */

export interface StorageHealth {
  percent: number | null;
  usedBytes: number | null;
  quotaBytes: number | null;
}

export class StorageFullError extends Error {
  readonly percent: number;
  constructor(percent: number) {
    super(
      `Local storage is ${percent}% full — export or withdraw assets to MetaMask before continuing.`,
    );
    this.name = "StorageFullError";
    this.percent = percent;
  }
}

let cached: { at: number; health: StorageHealth } | null = null;
const CACHE_MS = 15_000;

export async function getStorageHealth(force = false): Promise<StorageHealth> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.health;
  let health: StorageHealth = { percent: null, usedBytes: null, quotaBytes: null };
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (est.usage != null && est.quota != null && est.quota > 0) {
        health = {
          usedBytes: est.usage,
          quotaBytes: est.quota,
          percent: Math.round((est.usage / est.quota) * 100),
        };
      }
    }
  } catch {
    /* estimate not supported */
  }
  cached = { at: Date.now(), health };
  return health;
}

/**
 * Throw StorageFullError when quota usage is at/above `blockAt` (default 90).
 * No-op when the browser doesn't expose quota estimates.
 */
export async function assertStorageWritable(blockAt = 90): Promise<void> {
  const h = await getStorageHealth();
  if (h.percent != null && h.percent >= blockAt) {
    throw new StorageFullError(h.percent);
  }
}

export const STORAGE_WARN_PERCENT = 85;
export const STORAGE_BLOCK_PERCENT = 90;