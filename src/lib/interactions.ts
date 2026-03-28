// Social interaction utilities
import { get, put, getAllByIndex } from "./store";
import { Post, Comment, Reaction, User } from "@/types";
import { getCurrentUser, type UserMeta } from "./auth";
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

async function hydrateLegacyCommentProfiles(comments: Comment[]): Promise<Comment[]> {
  const authorCache = new Map<string, { found: boolean; authorName?: string; authorAvatarRef?: string }>();

  return Promise.all(
    comments.map(async (comment) => {
      let cached = authorCache.get(comment.author);
      if (!cached) {
        try {
          const author = (await get("users", comment.author)) as User | undefined;
          if (!author) {
            cached = { found: false };
          } else {
            cached = {
              found: true,
              authorName: author.displayName || author.username,
              authorAvatarRef: author.profile?.avatarRef,
            };
          }
        } catch {
          cached = { found: false };
        }
        authorCache.set(comment.author, cached);
      }

      if (!cached.found) {
        return comment;
      }

      const nextAuthorName = cached.authorName ?? comment.authorName;
      const nextAuthorAvatarRef = cached.authorAvatarRef;
      const nameChanged = Boolean(nextAuthorName) && nextAuthorName !== comment.authorName;
      const avatarChanged = nextAuthorAvatarRef !== comment.authorAvatarRef;

      if (!nameChanged && !avatarChanged) {
        return comment;
      }

      const updatedComment: Comment = {
        ...comment,
        authorName: nextAuthorName,
        authorAvatarRef: nextAuthorAvatarRef,
      };

      await put("comments", updatedComment);
      return updatedComment;
    })
  );
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

  // Record reaction to blockchain
  try {
    const { recordReactionToBlockchain } = await import("./blockchain/blockchainRecorder");
    await recordReactionToBlockchain(postId, user.id, emoji);
  } catch (error) {
    console.error("[interactions] Failed to record reaction to blockchain:", error);
  }

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

  // Check if this is an NFT post and reward with profile token
  const nftMetadata = (post as any).nftMetadata;
  if (nftMetadata?.isNFTPost && user.id !== post.author) {
    const { rewardHyperWithProfileToken } = await import("./blockchain/nftPost");
    const rewarded = await rewardHyperWithProfileToken({
      postId: post.id,
      userId: user.id,
      nftMetadata,
    });

    if (rewarded) {
      // Update the post's rewarded users list
      nftMetadata.rewardedUsers.push(user.id);
      (post as any).nftMetadata = nftMetadata;
    }
  }

  await put("posts", post);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
  }

  // Broadcast updated post (with reactions) through standalone meshes
  try {
    const { getSwarmMeshStandalone } = await import("@/lib/p2p/swarmMesh.standalone");
    const sm = getSwarmMeshStandalone();
    if (sm.getPhase() === 'online') {
      sm.broadcastNewPost(post as unknown as Record<string, unknown>);
    }
  } catch { /* non-critical */ }
  try {
    const { getStandaloneBuilderMode } = await import("@/lib/p2p/builderMode.standalone");
    const bm = getStandaloneBuilderMode();
    if (bm.getPhase() === 'online') {
      bm.broadcastNewPost(post as unknown as Record<string, unknown>);
    }
  } catch { /* non-critical */ }

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

  // Fetch fresh profile from IndexedDB in case avatar was set after login
  let avatarRef = user.profile?.avatarRef;
  if (!avatarRef) {
    try {
      const freshUser = await get("users", user.id) as UserMeta | undefined;
      avatarRef = freshUser?.profile?.avatarRef;
    } catch { /* use cached */ }
  }

  const comment: Comment = {
    id: crypto.randomUUID(),
    postId,
    author: user.id,
    authorName: user.displayName || user.username,
    authorAvatarRef: avatarRef,
    text,
    createdAt: new Date().toISOString(),
    parentId,
  };

  await put("comments", comment);

  // Record comment to blockchain
  try {
    const { recordCommentToBlockchain } = await import("./blockchain/blockchainRecorder");
    await recordCommentToBlockchain(comment.id, postId, user.id, text);
  } catch (error) {
    console.error("[interactions] Failed to record comment to blockchain:", error);
  }

  // Award credits for commenting
  try {
    const { awardCommentCredits } = await import("./credits");
    await awardCommentCredits(comment.id, postId, user.id);
  } catch (error) {
    console.error("[interactions] Failed to award comment credits:", error);
  }

  // Trigger P2P sync for the comment
  window.dispatchEvent(new CustomEvent("p2p-comment-created", { 
    detail: { comment } 
  }));

  // Broadcast comment directly through standalone P2P meshes
  try {
    const { getSwarmMeshStandalone } = await import("@/lib/p2p/swarmMesh.standalone");
    const sm = getSwarmMeshStandalone();
    if (sm.getPhase() === 'online') {
      sm.broadcastComment(comment as unknown as Record<string, unknown>);
    }
  } catch { /* non-critical */ }
  try {
    const { getStandaloneBuilderMode } = await import("@/lib/p2p/builderMode.standalone");
    const bm = getStandaloneBuilderMode();
    if (bm.getPhase() === 'online') {
      bm.broadcastComment(comment as unknown as Record<string, unknown>);
    }
  } catch { /* non-critical */ }

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
  const user = await getCurrentUser();
  let blockedIds: string[] = [];
  
  // Load blocked users to filter comments
  if (user) {
    try {
      const { getBlockedUserIds } = await import("./connections");
      blockedIds = await getBlockedUserIds(user.id);
    } catch (error) {
      console.warn("[interactions] Failed to load blocked users:", error);
    }
  }

  const comments = (await getAllByIndex<Comment>(
    "comments",
    "postId",
    postId
  ))
    .filter((c) => c.text !== "[deleted]")
    .filter((c) => !blockedIds.includes(c.author)); // Filter blocked users

  if (comments.length > 0) {
    const hydrated = await hydrateLegacyCommentProfiles(comments);
    return hydrated.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
      .filter((comment) => !blockedIds.includes(comment.author)) // Filter blocked users
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

  const hydratedLegacy = await hydrateLegacyCommentProfiles(normalized);
  return hydratedLegacy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Add a comment from the network entity (bypasses auth check).
 * Used by the EntityVoice module to insert AI-generated comments.
 */
export async function addEntityComment(comment: Comment): Promise<void> {
  await put("comments", comment);

  // Update post comment count
  const post = (await get("posts", comment.postId)) as Post;
  if (post) {
    post.commentCount = (post.commentCount || 0) + 1;
    await put("posts", post);
  }

  // Trigger P2P sync
  window.dispatchEvent(new CustomEvent("p2p-comment-created", { detail: { comment } }));
  window.dispatchEvent(new CustomEvent("p2p-comments-updated"));

  // Broadcast through mesh
  try {
    const { getSwarmMeshStandalone } = await import("@/lib/p2p/swarmMesh.standalone");
    const sm = getSwarmMeshStandalone();
    if (sm.getPhase() === 'online') {
      sm.broadcastComment(comment as unknown as Record<string, unknown>);
    }
  } catch { /* non-critical */ }
}

