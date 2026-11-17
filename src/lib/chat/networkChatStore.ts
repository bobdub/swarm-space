/**
 * Network Chat open-state — lets the main menu open the existing Brain
 * chat panel from anywhere in the app.
 *
 * The Brain scene has its own chat button (and no main menu), so this only
 * drives the global NetworkChatHost used everywhere else in the app.
 */
import { useSyncExternalStore } from 'react';

/** Full-page Brain routes: the scene shows its own chat panel there. */
export function isBrainScenePath(pathname: string): boolean {
  return pathname === '/brain' || pathname === '/brain/join' || /^\/projects\/[^/]+\/hub$/.test(pathname);
}

let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function setNetworkChatOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  emit();
}

export function isNetworkChatOpen(): boolean {
  return open;
}

export function subscribeNetworkChat(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useNetworkChatOpen(): boolean {
  return useSyncExternalStore(subscribeNetworkChat, isNetworkChatOpen, () => false);
}

/** Open the network chat panel (main-menu "Chat"). */
export function requestOpenNetworkChat(): void {
  setNetworkChatOpen(true);
}
