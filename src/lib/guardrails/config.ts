/**
 * Loading chain configuration — persisted user-selected order plus the
 * adaptive-pausing toggle. Defaults derive from the existing loading
 * priority preset so behavior is unchanged for users who never touch it.
 */

import { getLoadingPriority, type LoadingPriority } from '@/lib/settings/loadingPriority';
import type { LoadingPointId } from './loadingChain';

export const LOADING_CHAIN_STORAGE_KEY = 'swarm-loading-chain';

export interface LoadingChainConfig {
  order: string[];
  adaptive: boolean;
}

const CHAIN_BY_PRESET: Record<LoadingPriority, LoadingPointId[]> = {
  gaming: ['local', 'brain', 'brain-game', 'mesh', 'blockchain', 'torrents', 'mining'],
  social: ['local', 'mesh', 'blockchain', 'brain', 'brain-game', 'torrents', 'mining'],
  p2p:    ['local', 'mesh', 'blockchain', 'mining', 'brain', 'brain-game', 'torrents'],
};

export function defaultChainFor(priority: LoadingPriority = getLoadingPriority()): LoadingPointId[] {
  return [...CHAIN_BY_PRESET[priority]];
}

export function getLoadingChainConfig(): LoadingChainConfig {
  if (typeof window === 'undefined') {
    return { order: defaultChainFor(), adaptive: true };
  }
  try {
    const raw = window.localStorage.getItem(LOADING_CHAIN_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LoadingChainConfig>;
      const order = Array.isArray(parsed.order) && parsed.order.length > 0 ? parsed.order : defaultChainFor();
      const adaptive = parsed.adaptive !== false;
      return { order, adaptive };
    }
  } catch { /* ignore */ }
  return { order: defaultChainFor(), adaptive: true };
}

export function setLoadingChainConfig(cfg: LoadingChainConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOADING_CHAIN_STORAGE_KEY, JSON.stringify(cfg));
  } catch { /* ignore */ }
}

export const CHAIN_PRESETS = CHAIN_BY_PRESET;