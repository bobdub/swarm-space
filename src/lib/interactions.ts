// Social interaction utilities
import { get, put, getAllByIndex } from "./store";
import { Post, Comment, Reaction } from "@/types";
import { getCurrentUser } from "./auth";
import { createNotification } from "./notifications";
import type { AchievementEvent } from "./achievements";

const reactionKey = (userId: string, emoji: string) => `${userId}::${emoji}`;

async function notifyAchievements(event: AchievementEvent): Promise<void> {
  try {
    const module = await import("./achievements");
    await module.evaluateAchievementEvent(event);
  } catch (error) {
    console.warn("[interactions] Failed to notify achievements", error);
  }
}

/**
 * Add an emoji reaction to a post
 */
export async function addReaction(
  postId: string,
  emoji: string
): Promise<Post> {
  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");

  const post = (await get("posts", postId)) as Post;
  if (!post) throw new Error("Post not found");

  // Remove any existing reaction from this user with the same emoji
  const reactions = post.reactions || [];
  const filtered = reactions.filter(
    (r) => !(r.userId === user.id && r.emoji === emoji)
  );

  const createdAt = new Date().toISOString();

  // Add new reaction
  filtered.push({
    userId: user.id,
    emoji,
    createdAt,
  });

  post.reactions = filtered;

  if (post.reactionTombstones) {
    const key = reactionKey(user.id, emoji);
    if (post.reactionTombstones[key]) {
      const tombstones = { ...post.reactionTombstones };
      delete tombstones[key];
      post.reactionTombstones =
        Object.keys(tombstones).length > 0 ? tombstones : undefined;
    }
  }
  post.editedAt = new Date().toISOString();
  await put("posts", post);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
  }

  // Generate notification if not reacting to own post
  if (post.author !== user.id) {
    await createNotification({
      userId: post.author,
      type: "reaction",
      triggeredBy: user.id,
      triggeredByName: user.displayName || user.username,
      postId,
      emoji,
    });
  }

  return post;
}

/**
 * Remove a user's reaction from a post
 */
export async function removeReaction(postId: string, emoji: string): Promise<Post> {
  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");

  const post = (await get("posts", postId)) as Post;
  if (!post) throw new Error("Post not found");

  post.reactions = (post.reactions || []).filter(
    (r) => !(r.userId === user.id && r.emoji === emoji)
  );
  const tombstones = { ...(post.reactionTombstones ?? {}) };
  tombstones[reactionKey(user.id, emoji)] = new Date().toISOString();
  post.reactionTombstones = tombstones;
  post.editedAt = new Date().toISOString();
  await put("posts", post);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
  }

  return post;
}

/**
 * Get reaction counts grouped by emoji
 */
export function getReactionCounts(reactions: Reaction[]): Map<string, number> {
  const counts = new Map<string, number>();
  reactions.forEach((r) => {
    counts.set(r.emoji, (counts.get(r.emoji) || 0) + 1);
  });
  return counts;
}

/**
 * Check if current user has reacted to a post
 */
export async function getUserReaction(
  postId: string
): Promise<string | null> {
  const reactions = await getUserReactions(postId);
  return reactions[0] ?? null;
}

/**
 * Get all reactions from the current user on a post
 */
export async function getUserReactions(postId: string): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const post = (await get("posts", postId)) as Post;
  if (!post) return [];

  return (post.reactions || [])
    .filter((reaction) => reaction.userId === user.id)
    .map((reaction) => reaction.emoji);
}

/**
 * Add a comment to a post
 */
export async function addComment(
  postId: string,
  text: string,
  parentId?: string
): Promise<Comment> {
  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");

  const comment: Comment = {
    id: crypto.randomUUID(),
    postId,
    author: user.id,
    authorName: user.displayName || user.username,
    text,
    createdAt: new Date().toISOString(),
    parentId,
  };

  await put("comments", comment);

  // Trigger P2P sync for the comment
  window.dispatchEvent(new CustomEvent("p2p-comment-created", { 
    detail: { comment } 
  }));

  void notifyAchievements({
    type: "social:comment",
    userId: user.id,
    postId,
    commentId: comment.id,
  });

  // Update post comment count
  const post = (await get("posts", postId)) as Post;
  if (post) {
    post.commentCount = (post.commentCount || 0) + 1;
    await put("posts", post);

    // Generate notification if not commenting on own post
    if (post.author !== user.id) {
      await createNotification({
        userId: post.author,
        type: "comment",
        triggeredBy: user.id,
        triggeredByName: user.displayName || user.username,
        postId,
        content: text.slice(0, 100),
      });
    }
  }

  return comment;
}

/**
 * Delete a comment
 */
export async function deleteComment(commentId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");

  const comment = (await get("comments", commentId)) as Comment;
  if (!comment) throw new Error("Comment not found");
  if (comment.author !== user.id)
    throw new Error("Cannot delete another user's comment");

  // TODO: Implement soft delete or remove from IndexedDB
  // For now, we'll just mark it as deleted by clearing the text
  comment.text = "[deleted]";
  await put("comments", comment);
}

/**
 * Get all comments for a post
 */
export async function getComments(postId: string): Promise<Comment[]> {
  const comments = (await getAllByIndex<Comment>(
    "comments",
    "postId",
    postId
  )).filter((c) => c.text !== "[deleted]");

  if (comments.length > 0) {
    return comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // Fallback for legacy comments that were stored on the post itself without
  // a postId index entry. If found, backfill them into the comments store so
  // subsequent calls can rely on the indexed query.
  const post = (await get("posts", postId)) as Post | undefined;
  const legacyComments: Comment[] = Array.isArray(post?.comments)
    ? (post?.comments as Comment[])
    : [];

  if (!legacyComments.length) {
    return [];
  }

  const normalized = await Promise.all(
    legacyComments
      .filter((comment) => comment.text !== "[deleted]")
      .map(async (comment) => {
        const withPostId: Comment = {
          ...comment,
          id: comment.id || crypto.randomUUID(),
          postId,
        };

        await put("comments", withPostId);
        return withPostId;
      })
  );

  return normalized.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
