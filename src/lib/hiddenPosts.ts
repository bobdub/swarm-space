import { useSyncExternalStore } from "react";
import { get, put } from "./store";

/**
 * Posts hidden in this session, so every PostCard on screen (Explore keeps
 * its list and only merges new rows) vanishes the moment Hide is chosen
 * instead of waiting for a page reload. The durable list stays in IndexedDB.
 */
let hiddenNow = new Set<string>();
const hiddenListeners = new Set<() => void>();
function emitHidden() {
  hiddenListeners.forEach((fn) => { try { fn(); } catch { /* noop */ } });
}
function subscribeHidden(fn: () => void): () => void {
  hiddenListeners.add(fn);
  return () => { hiddenListeners.delete(fn); };
}
export function isPostHiddenNow(postId: string): boolean {
  return hiddenNow.has(postId);
}
export function useIsPostHiddenNow(postId: string): boolean {
  const read = () => hiddenNow.has(postId);
  return useSyncExternalStore(subscribeHidden, read, read);
}

const HIDDEN_POSTS_KEY_PREFIX = "hidden-posts:";

interface HiddenPostsEntry {
  k: string;
  v: string[];
}

function getStorageKey(userId: string) {
  return `${HIDDEN_POSTS_KEY_PREFIX}${userId}`;
}

export async function getHiddenPostIds(userId: string): Promise<string[]> {
  if (!userId) {
    return [];
  }

  const entry = await get<HiddenPostsEntry>("meta", getStorageKey(userId));
  if (!entry || !Array.isArray(entry.v)) {
    return [];
  }

  return entry.v.filter((value): value is string => typeof value === "string");
}

export async function hidePostForUser(userId: string, postId: string): Promise<void> {
  if (!userId || !postId) {
    return;
  }

  if (!hiddenNow.has(postId)) {
    hiddenNow = new Set(hiddenNow).add(postId);
    emitHidden();
  }

  const currentHidden = await getHiddenPostIds(userId);
  if (currentHidden.includes(postId)) {
    return;
  }

  const updatedHidden = [...currentHidden, postId];
  const entry: HiddenPostsEntry = {
    k: getStorageKey(userId),
    v: updatedHidden,
  };

  await put("meta", entry);
}

export async function unhidePostForUser(userId: string, postId: string): Promise<void> {
  if (!userId || !postId) {
    return;
  }

  if (hiddenNow.has(postId)) {
    hiddenNow = new Set(hiddenNow);
    hiddenNow.delete(postId);
    emitHidden();
  }

  const currentHidden = await getHiddenPostIds(userId);
  if (!currentHidden.length) {
    return;
  }

  const updatedHidden = currentHidden.filter((id) => id !== postId);
  const entry: HiddenPostsEntry = {
    k: getStorageKey(userId),
    v: updatedHidden,
  };

  await put("meta", entry);
}
