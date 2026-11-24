/**
 * Whether a screen share is open full size over the Brain. Kept outside
 * React state on purpose: the Brain page component holds the whole 3D scene,
 * so a state change there re-rendered every scene element on each open and
 * close of the viewer, which stalled the browser. Only the Canvas wrapper
 * subscribes, and it re-renders without touching the scene.
 */
import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

export function setScreenViewerOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  listeners.forEach((fn) => { try { fn(); } catch { /* listener */ } });
}

export function isScreenViewerOpen(): boolean {
  return open;
}

export function subscribeScreenViewerOpen(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useScreenViewerOpen(): boolean {
  return useSyncExternalStore(subscribeScreenViewerOpen, isScreenViewerOpen, isScreenViewerOpen);
}
