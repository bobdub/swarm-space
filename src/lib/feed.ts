import { getAll } from "./store";
import type { Post } from "@/types";
import { getCurrentUser, type UserMeta } from "./auth";
import { getBlockedUserIds } from "./connections";
import { getHiddenPostIds } from "./hiddenPosts";
import { getEntangledUserIds } from "./entanglements";
import { filterPostsByProjectMembership } from "./projects";

export type FeedFilter = "all" | "following" | "local";

type FeedFilterStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const FEED_FILTER_STORAGE_KEY = "home.feed.filter";

export interface FeedDependencies {
  loadPosts: () => Promise<Post[]>;
  getUser: () => UserMeta | null;
  loadBlockedUserIds: (userId: string) => Promise<string[]>;
  loadHiddenPostIds: (userId: string) => Promise<string[]>;
  loadFollowingIds: (userId: string) => Promise<string[]>;
}

const defaultDependencies: FeedDependencies = {
  loadPosts: () => getAll<Post>("posts"),
  getUser: () => getCurrentUser(),
  loadBlockedUserIds: (userId: string) => getBlockedUserIds(userId),
  loadHiddenPostIds: (userId: string) => getHiddenPostIds(userId),
  loadFollowingIds: (userId: string) => getEntangledUserIds(userId),
};

function resolveStorage(storage?: FeedFilterStorage | null): FeedFilterStorage | null {
  if (storage) {
    return storage;
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch (error) {
    console.warn("[feed] Failed to access localStorage", error);
    return null;
  }
}

function isFeedFilter(value: unknown): value is FeedFilter {
  return value === "all" || value === "following" || value === "local";
}

export function loadStoredFeedFilter(storage?: FeedFilterStorage | null): FeedFilter {
  const resolved = resolveStorage(storage);
  if (!resolved) {
    return "all";
  }

  try {
    const stored = resolved.getItem(FEED_FILTER_STORAGE_KEY);
    if (isFeedFilter(stored)) {
      return stored;
    }
  } catch (error) {
    console.warn("[feed] Failed to read stored filter", error);
  }

  return "all";
}

export function persistFeedFilter(filter: FeedFilter, storage?: FeedFilterStorage | null): void {
  const resolved = resolveStorage(storage);
  if (!resolved) {
    return;
  }

  try {
    resolved.setItem(FEED_FILTER_STORAGE_KEY, filter);
  } catch (error) {
    console.warn("[feed] Failed to persist filter", error);
  }
}

export async function fetchHomeFeed(
  filter: FeedFilter,
  dependencies: Partial<FeedDependencies> = {},
): Promise<Post[]> {
  const deps: FeedDependencies = { ...defaultDependencies, ...dependencies };

  const posts = await deps.loadPosts();
  const user = deps.getUser();
  const userId = user?.id;

  let blockedIds: string[] = [];
  let hiddenIds: string[] = [];
  let followingIds: string[] = [];

  if (userId) {
    [blockedIds, hiddenIds, followingIds] = await Promise.all([
      deps.loadBlockedUserIds(userId),
      deps.loadHiddenPostIds(userId),
      deps.loadFollowingIds(userId),
    ]);
  }

  const visiblePosts = posts.filter((post) => {
    if (blockedIds.includes(post.author)) {
      return false;
    }
    if (hiddenIds.includes(post.id)) {
      return false;
    }
    return true;
  });

  const membershipFilteredPosts = await filterPostsByProjectMembership(visiblePosts, userId ?? null);

  const sorted = [...membershipFilteredPosts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  if (filter === "following") {
    if (!userId) {
      return [];
    }
    const allowedAuthors = new Set(followingIds.concat(userId));
    return sorted.filter((post) => allowedAuthors.has(post.author));
  }

  if (filter === "local") {
    if (!userId) {
      return [];
    }
    return sorted.filter((post) => post.author === userId);
  }

  return sorted;
}
