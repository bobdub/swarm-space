import { getAll, get, put } from "../store";
import { getCurrentUser } from "../auth";
import type { Post, Project, User } from "@/types";

type PostSyncMessageType = "posts_request" | "posts_sync" | "post_created";

export interface PostSyncMessage {
  type: PostSyncMessageType;
  posts?: Post[];
  post?: Post;
}

type SendMessageFn = (peerId: string, message: PostSyncMessage) => boolean;
type ConnectedPeersFn = () => string[];
type EnsureManifestsFn = (manifestIds: string[], sourcePeerId?: string) => Promise<void>;

export class PostSyncManager {
  private readonly messageTypes: Set<PostSyncMessageType> = new Set([
    "posts_request",
    "posts_sync",
    "post_created"
  ]);

  constructor(
    private readonly sendMessage: SendMessageFn,
    private readonly getConnectedPeers: ConnectedPeersFn,
    private readonly ensureManifests: EnsureManifestsFn
  ) {}

  isPostSyncMessage(message: unknown): message is PostSyncMessage {
    return (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      this.messageTypes.has((message as { type: string }).type as PostSyncMessageType)
    );
  }

  async handlePeerConnected(peerId: string): Promise<void> {
    await this.sendAllPostsToPeer(peerId);
    this.sendMessage(peerId, { type: "posts_request" });
  }

  async handlePeerDisconnected(_peerId: string): Promise<void> {
    // Placeholder for future cleanup logic if needed
  }

  async handleMessage(peerId: string, message: PostSyncMessage): Promise<void> {
    switch (message.type) {
      case "posts_request":
        await this.sendAllPostsToPeer(peerId);
        break;
      case "posts_sync":
        if (Array.isArray(message.posts) && message.posts.length > 0) {
          const saved = await this.saveIncomingPosts(message.posts);
          if (saved.length > 0) {
            await this.ensurePostAssets(saved, peerId);
          }
        }
        break;
      case "post_created":
        if (message.post) {
          const saved = await this.saveIncomingPosts([message.post]);
          if (saved.length > 0) {
            await this.ensurePostAssets(saved, peerId);
          }
        }
        break;
    }
  }

  broadcastPost(post: Post): void {
    const peers = this.getConnectedPeers();
    if (peers.length === 0) return;

    peers.forEach((peerId) => {
      const sent = this.sendMessage(peerId, {
        type: "post_created",
        post
      });

      if (!sent) {
        console.warn(`[PostSync] Failed to broadcast post ${post.id} to ${peerId}`);
      }
    });
  }

  private async sendAllPostsToPeer(peerId: string): Promise<void> {
    try {
      const posts = await getAll<Post>("posts");
      if (posts.length === 0) return;

      const sent = this.sendMessage(peerId, {
        type: "posts_sync",
        posts
      });

      if (!sent) {
        console.warn(`[PostSync] Failed to send posts to ${peerId}`);
      }
    } catch (error) {
      console.error("[PostSync] Error sending posts to peer:", error);
    }
  }

  private async saveIncomingPosts(posts: Post[]): Promise<Post[]> {
    let updatedCount = 0;
    const updatedPosts: Post[] = [];
    const authorSnapshots = new Map<string, { name?: string; firstSeenAt?: string; avatarRef?: string }>();

    for (const post of posts) {
      try {
        if (post.author) {
          const existingSnapshot = authorSnapshots.get(post.author) ?? {};
          if (post.authorName && !existingSnapshot.name) {
            existingSnapshot.name = post.authorName;
          }

          if (post.authorAvatarRef && !existingSnapshot.avatarRef) {
            existingSnapshot.avatarRef = post.authorAvatarRef;
          }

          if (post.createdAt) {
            const createdAtDate = new Date(post.createdAt);
            if (!Number.isNaN(createdAtDate.getTime())) {
              const createdAt = createdAtDate.toISOString();
              if (!existingSnapshot.firstSeenAt || createdAt < existingSnapshot.firstSeenAt) {
                existingSnapshot.firstSeenAt = createdAt;
              }
            }
          }

          authorSnapshots.set(post.author, existingSnapshot);
        }

        const changed = await this.upsertPost(post);
        if (changed) {
          updatedCount++;
          updatedPosts.push(post);
        }
      } catch (error) {
        console.error(`[PostSync] Failed to store post ${post.id}:`, error);
      }
    }

    if (authorSnapshots.size > 0) {
      await this.ensureAuthorProfiles(authorSnapshots);
    }

    if (updatedCount > 0) {
      this.notifyFeeds();
    }

    return updatedPosts;
  }

  private async ensureAuthorProfiles(authorSnapshots: Map<string, { name?: string; firstSeenAt?: string; avatarRef?: string }>): Promise<void> {
    try {
      const existingUsers = await getAll<User>("users");
      const usersById = new Map(existingUsers.map((user) => [user.id, user]));
      const operations: Promise<void>[] = [];

      for (const [authorId, snapshot] of authorSnapshots.entries()) {
        if (!authorId) continue;

        const existing = usersById.get(authorId);
        if (existing) {
          let shouldUpdate = false;
          const updatedUser: User = { ...existing };

          if (!existing.displayName && snapshot.name) {
            updatedUser.displayName = snapshot.name;
            shouldUpdate = true;
          }

          if (snapshot.avatarRef) {
            const existingProfile = existing.profile ?? {};
            if (existingProfile.avatarRef !== snapshot.avatarRef) {
              updatedUser.profile = {
                ...existingProfile,
                avatarRef: snapshot.avatarRef,
              };
              shouldUpdate = true;
            }
          }

          if (shouldUpdate) {
            usersById.set(authorId, updatedUser);
            operations.push(put("users", updatedUser));
          }
          continue;
        }

        const placeholder: User = {
          id: authorId,
          username: this.createPlaceholderUsername(authorId, snapshot.name),
          displayName: snapshot.name ?? authorId,
          publicKey: "",
          profile: {
            ...(snapshot.avatarRef ? { avatarRef: snapshot.avatarRef } : {}),
            stats: {
              postCount: 0,
              projectCount: 0,
              joinedAt: snapshot.firstSeenAt ?? new Date().toISOString(),
            },
          },
          meta: {
            createdAt: snapshot.firstSeenAt ?? new Date().toISOString(),
          },
        };

        usersById.set(authorId, placeholder);
        operations.push(put("users", placeholder));
      }

      if (operations.length > 0) {
        await Promise.all(operations);
      }
    } catch (error) {
      console.warn("[PostSync] Failed to ensure author profiles", error);
    }
  }

  private createPlaceholderUsername(authorId: string, displayName?: string): string {
    if (displayName) {
      const slug = displayName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (slug) {
        return slug;
      }
    }

    return authorId;
  }

  private async upsertPost(post: Post): Promise<boolean> {
    const existing = await get<Post>("posts", post.id);

    if (existing) {
      const incomingTimestamp = this.getPostTimestamp(post);
      const existingTimestamp = this.getPostTimestamp(existing);

      if (incomingTimestamp <= existingTimestamp) {
        return false;
      }
    }

    await put("posts", post);

    if (post.projectId) {
      await this.ensureProjectFeedContainsPost(post.projectId, post.id);
    }

    return true;
  }

  private async ensureProjectFeedContainsPost(projectId: string, postId: string): Promise<void> {
    const project = await get<Project>("projects", projectId);
    if (!project) return;

    const user = getCurrentUser();
    if (!user) return;

    const isMember = project.members.includes(user.id) || project.owner === user.id;
    if (!isMember) {
      console.warn(
        `[PostSync] Skipping post ${postId} for unauthorized project ${projectId}`
      );
      return;
    }

    if (!project.feedIndex.includes(postId)) {
      await put("projects", {
        ...project,
        feedIndex: [postId, ...project.feedIndex]
      });
    }
  }

  private getPostTimestamp(post: Post): number {
    const date = post.editedAt ?? post.createdAt;
    return new Date(date).getTime();
  }

  private notifyFeeds(): void {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
    }
  }

  private async ensurePostAssets(posts: Post[], sourcePeerId?: string): Promise<void> {
    const manifestIds = new Set<string>();

    for (const post of posts) {
      if (Array.isArray(post.manifestIds)) {
        for (const manifestId of post.manifestIds) {
          if (manifestId) {
            manifestIds.add(manifestId);
          }
        }
      }

      if (post.authorAvatarRef) {
        manifestIds.add(post.authorAvatarRef);
      }
    }

    if (manifestIds.size === 0) {
      return;
    }

    try {
      await this.ensureManifests(Array.from(manifestIds), sourcePeerId);
    } catch (error) {
      console.error("[PostSync] Failed to ensure manifests for posts:", error);
    }
  }
}
