import { getAll } from "./store";
import type { Post } from "@/types";
import { getCurrentUser, type UserMeta } from "./auth";
import { getBlockedUserIds } from "./connections";
import { getHiddenPostIds } from "./hiddenPosts";
import { getEntangledUserIds } from "./entanglements";
import { filterPostsByProjectMembership } from "./projects";
import { isOwnPost, resolveLocalIdentity, type LocalIdentity } from "./content/ownContent";
import { isPostUnsupported } from "./content/unsupportedPostsStore";

export type FeedFilter = "all" | "following" | "local";

type FeedFilterStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const FEED_FILTER_STORAGE_KEY = "home.feed.filter";

// ═══════════════════════════════════════════════════════════════════
// Network Content Toggle
// ═══════════════════════════════════════════════════════════════════

/**
 * "My Content Only" — OFF by default, so peers' content syncs and shows
 * naturally; ON shows only posts authored or signed by the local identity
 * (see `isOwnPost`), with no exceptions (walled peer posts included).
 *
 * Stored under its own key: the old `feed.showNetworkContent` defaulted to
 * hiding network content, so it is deliberately not read any more.
 */
const MY_CONTENT_ONLY_KEY = "feed.myContentOnly";

export function getMyContentOnly(): boolean {
  try {
    return localStorage.getItem(MY_CONTENT_ONLY_KEY) === "true";
  } catch {
    return false;
  }
}

export function setMyContentOnly(only: boolean): void {
  try {
    localStorage.setItem(MY_CONTENT_ONLY_KEY, String(only));
  } catch {
    console.warn("[feed] Failed to persist My Content Only");
  }
  // Notify feeds to re-render
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("network-content-toggle"));
  }
}

/** Whether peers' synced posts show — the inverse of "My Content Only". */
export function getShowNetworkContent(): boolean {
  return !getMyContentOnly();
}

export function setShowNetworkContent(show: boolean): void {
  setMyContentOnly(!show);
}

/**
 * Feed visibility for one post under the "My Content Only" filter and this
 * node's Stop Support list. Shared by the home feed and the Posts page.
 */
export function isPostVisibleForContentFilter(
  post: Post,
  identity: LocalIdentity | null,
  myContentOnly: boolean,
): boolean {
  if (isPostUnsupported(post.id)) return false;
  if (myContentOnly && !isOwnPost(post, identity)) return false;
  return true;
}


// ═══════════════════════════════════════════════════════════════════

export interface FeedDependencies {
  loadPosts: () => Promise<Post[]>;
  getUser: () => UserMeta | null;
  resolveIdentity?: (user: UserMeta | null) => Promise<LocalIdentity>;
  loadBlockedUserIds: (userId: string) => Promise<string[]>;
  loadHiddenPostIds: (userId: string) => Promise<string[]>;
  loadFollowingIds: (userId: string) => Promise<string[]>;
}

const defaultDependencies: FeedDependencies = {
  loadPosts: () => getAll<Post>("posts"),
  getUser: () => getCurrentUser(),
  resolveIdentity: (user) => resolveLocalIdentity(user),
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

  const myContentOnly = getMyContentOnly();
  const identity = myContentOnly || filter === "local"
    ? await (deps.resolveIdentity ?? resolveLocalIdentity)(user).catch(() => ({ userId: userId ?? null }))
    : null;

  const visiblePosts = posts.filter((post) => {
    if (post.type === "stream" && post.stream?.visibility && post.stream.visibility !== "public") {
      return false;
    }
    if (blockedIds.includes(post.author)) {
      return false;
    }
    if (hiddenIds.includes(post.id)) {
      return false;
    }
    // "My Content Only": strictly the local identity's own posts. Walled
    // network posts get no exception here — that loophole kept peers' paid
    // posts in a feed the user had switched to their own content only.
    return isPostVisibleForContentFilter(post, identity, myContentOnly);
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
    return sorted.filter((post) => isOwnPost(post, identity));
  }

  return sorted;
}
