import { describe, expect, test } from "bun:test";
import {
  FEED_FILTER_STORAGE_KEY,
  fetchHomeFeed,
  loadStoredFeedFilter,
  persistFeedFilter,
  type FeedDependencies,
} from "@/lib/feed";
import type { Post } from "@/types";
import type { UserMeta } from "@/lib/auth";

type StorageStub = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function createMemoryStorage(initial: Record<string, string> = {}): StorageStub {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

function createUserMeta(overrides: Partial<UserMeta> = {}): UserMeta {
  return {
    id: "user-1",
    username: "user-1",
    displayName: "User One",
    publicKey: "pk",
    wrappedKeyRef: "ref",
    createdAt: new Date(2024, 0, 1).toISOString(),
    ...overrides,
  };
}

function makePost(id: string, author: string, createdAt: string): Post {
  return {
    id,
    author,
    type: "text",
    content: `${id}-content`,
    createdAt,
  };
}

describe("feed storage helpers", () => {
  test("persistFeedFilter stores the current selection", () => {
    const storage = createMemoryStorage();
    persistFeedFilter("local", storage);
    expect(storage.getItem(FEED_FILTER_STORAGE_KEY)).toBe("local");
  });

  test("loadStoredFeedFilter falls back to all when value is missing or invalid", () => {
    const emptyStorage = createMemoryStorage();
    expect(loadStoredFeedFilter(emptyStorage)).toBe("all");

    const storage = createMemoryStorage({ [FEED_FILTER_STORAGE_KEY]: "invalid" });
    expect(loadStoredFeedFilter(storage)).toBe("all");
  });

  test("loadStoredFeedFilter returns stored value when valid", () => {
    const storage = createMemoryStorage({ [FEED_FILTER_STORAGE_KEY]: "following" });
    expect(loadStoredFeedFilter(storage)).toBe("following");
  });
});

describe("fetchHomeFeed", () => {
  const basePosts: Post[] = [
    makePost("post-1", "alice", new Date("2024-03-01T12:00:00Z").toISOString()),
    makePost("post-2", "bob", new Date("2024-02-20T12:00:00Z").toISOString()),
    makePost("post-3", "user-1", new Date("2024-03-05T12:00:00Z").toISOString()),
    makePost("post-4", "blocked", new Date("2024-02-28T12:00:00Z").toISOString()),
    makePost("post-5", "carol", new Date("2024-02-27T12:00:00Z").toISOString()),
  ];

  const dependencies: Partial<FeedDependencies> = {
    loadPosts: async () => basePosts,
    getUser: () => createUserMeta(),
    loadBlockedUserIds: async () => ["blocked"],
    loadHiddenPostIds: async () => ["post-5"],
    loadFollowingIds: async () => ["alice"],
  };

  test("returns visible posts sorted by created date for the all filter", async () => {
    const posts = await fetchHomeFeed("all", dependencies);
    expect(posts.map((post) => post.id)).toEqual(["post-3", "post-1", "post-2"]);
  });

  test("includes followed authors and the current user for the following filter", async () => {
    const posts = await fetchHomeFeed("following", dependencies);
    expect(posts.map((post) => post.id)).toEqual(["post-3", "post-1"]);
  });

  test("limits the local filter to posts authored by the current user", async () => {
    const posts = await fetchHomeFeed("local", dependencies);
    expect(posts.map((post) => post.id)).toEqual(["post-3"]);
  });

  test("returns an empty array for following/local when no user is present", async () => {
    const posts = await fetchHomeFeed("following", {
      ...dependencies,
      getUser: () => null,
    });
    const localPosts = await fetchHomeFeed("local", {
      ...dependencies,
      getUser: () => null,
    });
    expect(posts).toEqual([]);
    expect(localPosts).toEqual([]);
  });
});
