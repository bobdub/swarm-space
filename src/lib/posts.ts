import { get, put, remove } from "./store";
import type { Post } from "@/types";
import { getCurrentUser } from "./auth";
import { removePostFromProject } from "./projects";

/**
 * Update an existing post. Only the author may edit their post.
 */
export async function updatePost(
  postId: string,
  updates: Partial<Pick<Post, "content" | "nsfw">>
): Promise<Post> {
  const post = await get<Post>("posts", postId);
  if (!post) {
    throw new Error("Post not found");
  }

  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.id !== post.author) {
    throw new Error("Cannot edit another user's post");
  }

  const updated: Post = {
    ...post,
    ...updates,
    editedAt: new Date().toISOString(),
  };

  await put("posts", updated);
  return updated;
}

/**
 * Delete a post. Only the author may delete their post.
 */
export async function deletePost(postId: string): Promise<void> {
  const post = await get<Post>("posts", postId);
  if (!post) {
    return;
  }

  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.id !== post.author) {
    throw new Error("Cannot delete another user's post");
  }

  await remove("posts", postId);

  if (post.projectId) {
    await removePostFromProject(post.projectId, postId);
  }
}
