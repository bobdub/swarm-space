import { get, put } from "./store";

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
