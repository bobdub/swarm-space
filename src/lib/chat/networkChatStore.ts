/**
 * Network Chat open-state — lets the main menu open the existing Brain
 * chat panel from anywhere in the app.
 *
 * `requestOpenNetworkChat()` first offers the request to any mounted Brain
 * scene (which owns its own chat panel) via a cancelable window event. If
 * no scene claims it, the global NetworkChatHost opens the panel instead.
 */
import { useSyncExternalStore } from 'react';

export const OPEN_NETWORK_CHAT_EVENT = 'swarm:open-chat';

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

/** Open the chat panel: the in-scene panel when a Brain scene is mounted,
 *  otherwise the global floating panel. */
export function requestOpenNetworkChat(): void {
  if (typeof window !== 'undefined') {
    const event = new CustomEvent(OPEN_NETWORK_CHAT_EVENT, { cancelable: true });
    const unclaimed = window.dispatchEvent(event);
    if (!unclaimed) return; // A Brain scene opened its own panel.
  }
  setNetworkChatOpen(true);
}
