/**
 * Builder render mode — Stacked (full fidelity) or Light (performance).
 *
 *  - Stacked (default): every user placement renders — walls, interactive
 *    items, billboards — with its physics body.
 *  - Light: user placements are bypassed completely. No placement meshes,
 *    no physics colliders and no `<Html>` layers, so older CPUs/GPUs keep
 *    terrain, ocean, sky and live avatars at a high framerate.
 *
 * Saved in local preferences so a low-spec device stays on Light across
 * reloads. Local to this device; never shared with peers.
 */
import { useSyncExternalStore } from 'react';

export type BuilderRenderMode = 'stacked' | 'light';

const STORAGE_KEY = 'brain:builder-render-mode:v1';
const listeners = new Set<() => void>();

function load(): BuilderRenderMode {
  try {
    if (typeof localStorage === 'undefined') return 'stacked';
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'stacked';
  } catch {
    return 'stacked';
  }
}

let mode: BuilderRenderMode = load();

export function getBuilderRenderMode(): BuilderRenderMode {
  return mode;
}

export function isLightBuilderMode(): boolean {
  return mode === 'light';
}

export function setBuilderRenderMode(next: BuilderRenderMode): void {
  const value: BuilderRenderMode = next === 'light' ? 'light' : 'stacked';
  if (value === mode) return;
  mode = value;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage unavailable — mode still applies for this session */
  }
  listeners.forEach((fn) => {
    try { fn(); } catch { /* listener errors must not break the store */ }
  });
}

export function subscribeBuilderRenderMode(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useBuilderRenderMode(): BuilderRenderMode {
  return useSyncExternalStore(subscribeBuilderRenderMode, getBuilderRenderMode, getBuilderRenderMode);
}

export function _resetBuilderRenderModeForTest(): void {
  mode = load();
  listeners.clear();
}
