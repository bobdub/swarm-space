import { get, getAll, put, remove } from "./store";
import type { Post } from "@/types";
import { getCurrentUser } from "./auth";
import { removePostFromProject } from "./projects";
import { applyBlogIdentity } from "./blogging/awareness";
import { tombstoneOwnPost, type TombstoneResult } from "./p2p/contentLifecycle";

/**
 * Return posts whose `createdAt` is strictly newer than the supplied ISO
 * timestamp. Thin wrapper over `getAll("posts")` used by feeds to merge
 * incoming P2P announcements without re-scanning already-rendered rows.
 */
export async function getPostsNewerThan(sinceIso: string | null): Promise<Post[]> {
  const all = await getAll<Post>("posts");
  if (!sinceIso) return all;
  const since = new Date(sinceIso).getTime();
  if (!Number.isFinite(since)) return all;
  return all.filter((p) => {
    const t = new Date(p.createdAt).getTime();
    return Number.isFinite(t) && t > since;
  });
}

/**
 * Update an existing post. Only the author may edit their post.
 */
export async function updatePost(
  postId: string,
  updates: Partial<Pick<Post, "content" | "nsfw" | "manifestIds">>
): Promise<Post> {
  const post = await get<Post>("posts", postId);
  if (!post) {
    throw new Error("Post not found");
  }

  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.id !== post.author) {
    throw new Error("Cannot edit another user's post");
  }

  const updated = applyBlogIdentity({
    ...post,
    ...updates,
    editedAt: new Date().toISOString(),
  });

  await put("posts", updated);
  return updated;
}

/**
 * Delete a post. Only the author may delete their post.
 *
 * A tombstone signed with the author's identity key is recorded and sent to
 * connected peers before the local copy goes, so peers purge it and refuse to
 * take it back. If the key is locked, the post is still removed here and the
 * tombstone is signed and sent once the key is available again.
 */
export async function deletePost(postId: string): Promise<TombstoneResult | null> {
  const post = await get<Post>("posts", postId);
  if (!post) {
    return null;
  }

  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.id !== post.author) {
    throw new Error("Cannot delete another user's post");
  }

  let result: TombstoneResult | null = null;
  try {
    result = await tombstoneOwnPost(post);
  } catch (error) {
    console.warn("[posts] Tombstone failed; deleting locally only", error);
  }
  await remove("posts", postId);

  if (post.projectId) {
    await removePostFromProject(post.projectId, postId);
  }
  return result;
}
