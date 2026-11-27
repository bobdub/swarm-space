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
/** Collapsed into the bar at the bottom of the screen (like a minimized screen share). */
let docked = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function setNetworkChatOpen(next: boolean): void {
  // Closing forgets the dock, so Chat from the menu always opens the window.
  const nextDocked = next ? docked : false;
  if (open === next && docked === nextDocked) return;
  open = next;
  docked = nextDocked;
  emit();
}

export function setNetworkChatDocked(next: boolean): void {
  if (docked === next) return;
  docked = next;
  emit();
}

export function isNetworkChatDocked(): boolean {
  return docked;
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

export function useNetworkChatDocked(): boolean {
  return useSyncExternalStore(subscribeNetworkChat, isNetworkChatDocked, () => false);
}

/** Open the network chat panel (main-menu "Chat"); a docked chat pops back up. */
export function requestOpenNetworkChat(): void {
  setNetworkChatOpen(true);
  setNetworkChatDocked(false);
}
