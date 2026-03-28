/**
 * Storage Provider Registry
 * Selects the active provider based on data tier and configuration.
 */

import type { StorageProvider, StorageTier, StorageThresholds } from './types';
import { STORE_TIER_MAP, DEFAULT_THRESHOLDS } from './types';
import { BrowserStorageProvider } from './browserProvider';

const browserProvider = new BrowserStorageProvider();

const providers = new Map<string, StorageProvider>([
  ['browser', browserProvider],
]);

let thresholds: StorageThresholds = { ...DEFAULT_THRESHOLDS };

/** Tier → provider id override (empty = browser default) */
const tierOverrides = new Map<StorageTier, string>();

// ── Public API ──────────────────────────────────────────

export function registerProvider(provider: StorageProvider): void {
  providers.set(provider.id, provider);
}

export function unregisterProvider(id: string): void {
  if (id === 'browser') return; // never remove default
  providers.delete(id);
  // clear any tier overrides pointing to this provider
  for (const [tier, pid] of tierOverrides.entries()) {
    if (pid === id) tierOverrides.delete(tier);
  }
}

export function setTierOverride(tier: StorageTier, providerId: string): void {
  tierOverrides.set(tier, providerId);
}

export function clearTierOverride(tier: StorageTier): void {
  tierOverrides.delete(tier);
}

export function updateThresholds(partial: Partial<StorageThresholds>): void {
  thresholds = { ...thresholds, ...partial };
}

export function getThresholds(): Readonly<StorageThresholds> {
  return thresholds;
}

/**
 * Get the active provider for a given tier.
 * Falls back to browser if the configured provider is unavailable.
 */
export function getProvider(tier: StorageTier): StorageProvider {
  const overrideId = tierOverrides.get(tier);
  if (overrideId) {
    const provider = providers.get(overrideId);
    if (provider) return provider;
  }
  return browserProvider;
}

/**
 * Convenience: resolve tier from a store name, then return the provider.
 */
export function getProviderForStore(storeName: string): StorageProvider {
  const tier = STORE_TIER_MAP[storeName] ?? 'critical';
  return getProvider(tier);
}

/**
 * List all registered providers.
 */
export function getAllProviders(): StorageProvider[] {
  return Array.from(providers.values());
}

/**
 * Get a provider by its id.
 */
export function getProviderById(id: string): StorageProvider | undefined {
  return providers.get(id);
}

export { browserProvider };
