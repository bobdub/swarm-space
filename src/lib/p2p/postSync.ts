import { getAll, get, put } from "../store";
import { getCurrentUser } from "../auth";
import {
  getAchievementProgressRecord,
  saveAchievementProgressRecord,
} from "../achievementsStore";
import type {
  Post,
  PostBadgeSnapshot,
  Project,
  Reaction,
  User
} from "@/types";

type PostSyncMessageType = "posts_request" | "posts_sync" | "post_created";

export interface PostSyncMessage {
  type: PostSyncMessageType;
  posts?: Post[];
  post?: Post;
  projects?: Project[];
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
        if (Array.isArray(message.projects) && message.projects.length > 0) {
          await this.saveIncomingProjects(message.projects);
        }

        if (Array.isArray(message.posts) && message.posts.length > 0) {
          const saved = await this.saveIncomingPosts(message.posts);
          if (saved.length > 0) {
            await this.ensurePostAssets(saved, peerId);
          }
        }
        break;
      case "post_created":
        if (message.post) {
          if (Array.isArray(message.projects) && message.projects.length > 0) {
            await this.saveIncomingProjects(message.projects);
          }
          const saved = await this.saveIncomingPosts([message.post]);
          if (saved.length > 0) {
            await this.ensurePostAssets(saved, peerId);
          }
        }
        break;
    }
  }

  async broadcastPost(post: Post): Promise<void> {
    const peers = this.getConnectedPeers();
    if (peers.length === 0) return;

    let associatedProject: Project | null = null;
    if (post.projectId) {
      try {
        const project = await get<Project>("projects", post.projectId);
        if (project && this.isProjectShareable(project)) {
          associatedProject = project;
        }
      } catch (error) {
        console.warn(`[PostSync] Failed to load project ${post.projectId} for broadcast`, error);
      }
    }

    const payload: PostSyncMessage = { type: "post_created", post };
    if (associatedProject) {
      payload.projects = [associatedProject];
    }

    peers.forEach((peerId) => {
      const sent = this.sendMessage(peerId, payload);

      if (!sent) {
        console.warn(`[PostSync] Failed to broadcast post ${post.id} to ${peerId}`);
      }
    });
  }

  private async sendAllPostsToPeer(peerId: string): Promise<void> {
    try {
      const [posts, projects] = await Promise.all([
        getAll<Post>("posts"),
        getAll<Project>("projects"),
      ]);

      const shareableProjects = projects.filter((project) => this.isProjectShareable(project));

      if (posts.length === 0 && shareableProjects.length === 0) return;

      const payload: PostSyncMessage = { type: "posts_sync" };
      if (posts.length > 0) {
        payload.posts = posts;
      }
      if (shareableProjects.length > 0) {
        payload.projects = shareableProjects;
      }

      const sent = this.sendMessage(peerId, payload);

      if (!sent) {
        console.warn(`[PostSync] Failed to send posts to ${peerId}`);
      }
    } catch (error) {
      console.error("[PostSync] Error sending posts to peer:", error);
    }
  }

  private isProjectShareable(project: Project): boolean {
    const visibility = project.settings?.visibility ?? "public";
    return visibility !== "private";
  }

  private getProjectTimestamp(project: Project | null | undefined): number {
    if (!project) {
      return 0;
    }

    const updatedAt = project.meta?.updatedAt;
    const createdAt = project.meta?.createdAt;

    const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
    if (Number.isFinite(updatedMs)) {
      return updatedMs;
    }

    const createdMs = createdAt ? Date.parse(createdAt) : Number.NaN;
    return Number.isFinite(createdMs) ? createdMs : 0;
  }

  private async saveIncomingProjects(projects: Project[]): Promise<void> {
    if (projects.length === 0) {
      return;
    }

    let changed = false;

    for (const project of projects) {
      try {
        const existing = await get<Project>("projects", project.id);

        if (!existing) {
          await put("projects", project);
          changed = true;
          continue;
        }

        const incomingTimestamp = this.getProjectTimestamp(project);
        const existingTimestamp = this.getProjectTimestamp(existing);

        if (incomingTimestamp <= existingTimestamp) {
          continue;
        }

        const merged: Project = {
          ...existing,
          ...project,
          meta: {
            ...existing.meta,
            ...project.meta,
          },
        };

        await put("projects", merged);
        changed = true;
      } catch (error) {
        console.warn(`[PostSync] Failed to store project ${project.id}:`, error);
      }
    }

    if (changed) {
      this.notifyProjectsUpdated();
    }
  }

  private notifyProjectsUpdated(): void {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("p2p-projects-updated"));
    }
  }

  private async saveIncomingPosts(posts: Post[]): Promise<Post[]> {
    let updatedCount = 0;
    const updatedPosts: Post[] = [];
    const authorSnapshots = new Map<string, {
      name?: string;
      firstSeenAt?: string;
      avatarRef?: string;
      bannerRef?: string;
    }>();
    const badgeSnapshotsByAuthor = new Map<string, Map<string, PostBadgeSnapshot>>();

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

          if (post.authorBannerRef && !existingSnapshot.bannerRef) {
            existingSnapshot.bannerRef = post.authorBannerRef;
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

        if (post.author && Array.isArray(post.authorBadgeSnapshots) && post.authorBadgeSnapshots.length > 0) {
          let authorBadgeMap = badgeSnapshotsByAuthor.get(post.author);
          if (!authorBadgeMap) {
            authorBadgeMap = new Map();
            badgeSnapshotsByAuthor.set(post.author, authorBadgeMap);
          }

          for (const snapshot of post.authorBadgeSnapshots) {
            if (!snapshot?.id) {
              continue;
            }

            const existingSnapshot = authorBadgeMap.get(snapshot.id);
            if (!existingSnapshot) {
              authorBadgeMap.set(snapshot.id, snapshot);
              continue;
            }

            const incomingTime = this.getSnapshotTimestamp(snapshot);
            const existingTime = this.getSnapshotTimestamp(existingSnapshot);
            if (incomingTime >= existingTime) {
              authorBadgeMap.set(snapshot.id, snapshot);
            }
          }
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

    if (badgeSnapshotsByAuthor.size > 0) {
      await this.ensureAuthorBadges(badgeSnapshotsByAuthor);
    }

    if (updatedCount > 0) {
      this.notifyFeeds();
    }

    return updatedPosts;
  }

  private async ensureAuthorProfiles(authorSnapshots: Map<string, {
    name?: string;
    firstSeenAt?: string;
    avatarRef?: string;
    bannerRef?: string;
  }>): Promise<void> {
    try {
      const existingUsers = await getAll<User>("users");
      const usersById = new Map(existingUsers.map((user) => [user.id, user]));
      const operations: Promise<void>[] = [];
      const profileManifests: string[] = [];

      for (const [authorId, snapshot] of authorSnapshots.entries()) {
        if (!authorId) continue;

        // Collect avatar manifest IDs for proactive fetching
        if (snapshot.avatarRef) {
          profileManifests.push(snapshot.avatarRef);
        }

        if (snapshot.bannerRef) {
          profileManifests.push(snapshot.bannerRef);
        }

        const existing = usersById.get(authorId);
        if (existing) {
          let shouldUpdate = false;
          const updatedUser: User = { ...existing };

          if (!existing.displayName && snapshot.name) {
            updatedUser.displayName = snapshot.name;
            shouldUpdate = true;
          }

          if (snapshot.avatarRef || snapshot.bannerRef) {
            const existingProfile = existing.profile ?? {};
            const nextProfile = { ...existingProfile };
            let profileChanged = false;

            if (snapshot.avatarRef && existingProfile.avatarRef !== snapshot.avatarRef) {
              nextProfile.avatarRef = snapshot.avatarRef;
              profileChanged = true;
            }

            if (snapshot.bannerRef && existingProfile.bannerRef !== snapshot.bannerRef) {
              nextProfile.bannerRef = snapshot.bannerRef;
              profileChanged = true;
            }

            if (profileChanged) {
              updatedUser.profile = nextProfile;
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
            ...(snapshot.bannerRef ? { bannerRef: snapshot.bannerRef } : {}),
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

      // Proactively fetch avatar manifests in background
      if (profileManifests.length > 0) {
        console.log(`[PostSync] Proactively fetching ${profileManifests.length} profile manifests`);
        this.ensureManifests(profileManifests).catch(err =>
          console.warn("[PostSync] Failed to fetch profile manifests:", err)
        );
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

    if (!existing) {
      await put("posts", post);

      if (post.projectId) {
        await this.ensureProjectFeedContainsPost(post.projectId, post.id);
      }

      return true;
    }

    const incomingTimestamp = this.getPostTimestamp(post);
    const existingTimestamp = this.getPostTimestamp(existing);

    const mergedTombstones = this.mergeReactionTombstones(
      existing.reactionTombstones,
      post.reactionTombstones
    );

    const mergedReactions = this.mergeReactions(
      existing.reactions,
      post.reactions,
      mergedTombstones
    );

    const prunedTombstones = this.pruneReactionTombstones(
      mergedReactions,
      mergedTombstones
    );

    const mergedPost: Post =
      incomingTimestamp >= existingTimestamp
        ? { ...existing, ...post }
        : { ...existing };

    if (mergedReactions && mergedReactions.length > 0) {
      mergedPost.reactions = mergedReactions;
    } else {
      delete mergedPost.reactions;
    }

    if (prunedTombstones && Object.keys(prunedTombstones).length > 0) {
      mergedPost.reactionTombstones = prunedTombstones;
    } else {
      delete mergedPost.reactionTombstones;
    }

    const latestEditedAt = this.getNewestDate(existing.editedAt, post.editedAt);
    if (latestEditedAt) {
      mergedPost.editedAt = latestEditedAt;
    } else {
      delete mergedPost.editedAt;
    }

    if (!this.didPostChange(existing, mergedPost)) {
      return false;
    }

    await put("posts", mergedPost);

    if (mergedPost.projectId) {
      await this.ensureProjectFeedContainsPost(mergedPost.projectId, mergedPost.id);
    }

    return true;
  }

  private mergeReactions(
    existing: Reaction[] | undefined,
    incoming: Reaction[] | undefined,
    tombstones?: Record<string, string>
  ): Reaction[] | undefined {
    const existingList = existing ?? [];
    const incomingList = incoming ?? [];

    if (existingList.length === 0 && incomingList.length === 0) {
      return undefined;
    }

    const existingMap = new Map<string, Reaction>();
    for (const reaction of existingList) {
      existingMap.set(this.getReactionKey(reaction), reaction);
    }

    const incomingMap = new Map<string, Reaction>();
    for (const reaction of incomingList) {
      incomingMap.set(this.getReactionKey(reaction), reaction);
    }

    const merged = new Map(existingMap);

    for (const [key, reaction] of incomingMap) {
      const current = merged.get(key);
      if (!current) {
        merged.set(key, reaction);
        continue;
      }

      const currentCreated = this.parseTimestamp(current.createdAt);
      const incomingCreated = this.parseTimestamp(reaction.createdAt);
      if (incomingCreated > currentCreated) {
        merged.set(key, reaction);
      }
    }

    if (tombstones) {
      for (const [key, removedAt] of Object.entries(tombstones)) {
        const removedTimestamp = this.parseTimestamp(removedAt);
        if (removedTimestamp === 0) continue;

        const reaction = merged.get(key);
        if (!reaction) continue;

        const createdAt = this.parseTimestamp(reaction.createdAt);
        if (createdAt <= removedTimestamp) {
          merged.delete(key);
        }
      }
    }

    const mergedList = Array.from(merged.values()).sort((a, b) =>
      this.compareReactions(a, b)
    );

    return mergedList.length > 0 ? mergedList : [];
  }

  private getReactionKey(reaction: Reaction): string {
    return `${reaction.userId}::${reaction.emoji}`;
  }

  private parseTimestamp(value?: string | null): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private getNewestDate(
    ...values: (string | undefined | null)[]
  ): string | undefined {
    let latest = 0;
    for (const value of values) {
      const parsed = this.parseTimestamp(value ?? undefined);
      if (parsed > latest) {
        latest = parsed;
      }
    }

    return latest > 0 ? new Date(latest).toISOString() : undefined;
  }

  private didPostChange(existing: Post, next: Post): boolean {
    if (!this.areReactionsEqual(existing.reactions, next.reactions)) {
      return true;
    }

    const existingSerialized = this.serializePost(existing);
    const nextSerialized = this.serializePost(next);
    return existingSerialized !== nextSerialized;
  }

  private areReactionsEqual(
    left?: Reaction[] | null,
    right?: Reaction[] | null
  ): boolean {
    const leftNormalized = [...(left ?? [])].sort((a, b) =>
      this.compareReactions(a, b)
    );
    const rightNormalized = [...(right ?? [])].sort((a, b) =>
      this.compareReactions(a, b)
    );

    if (leftNormalized.length !== rightNormalized.length) {
      return false;
    }

    for (let i = 0; i < leftNormalized.length; i++) {
      const l = leftNormalized[i];
      const r = rightNormalized[i];
      if (
        l.userId !== r.userId ||
        l.emoji !== r.emoji ||
        this.parseTimestamp(l.createdAt) !== this.parseTimestamp(r.createdAt)
      ) {
        return false;
      }
    }

    return true;
  }

  private compareReactions(a: Reaction, b: Reaction): number {
    if (a.userId === b.userId) {
      if (a.emoji === b.emoji) {
        return this.parseTimestamp(a.createdAt) - this.parseTimestamp(b.createdAt);
      }
      return a.emoji.localeCompare(b.emoji);
    }
    return a.userId.localeCompare(b.userId);
  }

  private serializePost(post: Post): string {
    const clone: Record<string, unknown> = { ...post };

    clone.reactions = [...(post.reactions ?? [])].sort((a, b) =>
      this.compareReactions(a, b)
    );

    if (post.manifestIds) {
      clone.manifestIds = [...post.manifestIds].sort();
    }

    if (post.tags) {
      clone.tags = [...post.tags].sort();
    }

    if (post.authorBadgeSnapshots) {
      clone.authorBadgeSnapshots = [...post.authorBadgeSnapshots].sort((a, b) => {
        if (a.id === b.id) {
          return this.parseTimestamp(a.unlockedAt ?? undefined) -
            this.parseTimestamp(b.unlockedAt ?? undefined);
        }
        return a.id.localeCompare(b.id);
      });
    }

    if (post.reactionTombstones) {
      const entries = Object.entries(post.reactionTombstones).map(([key, value]) => [
        key,
        this.parseTimestamp(value)
      ]);
      entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      clone.reactionTombstones = entries;
    }

    return JSON.stringify(clone);
  }

  private mergeReactionTombstones(
    existing?: Record<string, string>,
    incoming?: Record<string, string>
  ): Record<string, string> | undefined {
    if (!existing && !incoming) {
      return undefined;
    }

    const merged = new Map<string, string>();
    const addEntries = (source?: Record<string, string>) => {
      if (!source) return;
      for (const [key, value] of Object.entries(source)) {
        const timestamp = this.parseTimestamp(value);
        if (timestamp === 0) {
          continue;
        }

        const current = merged.get(key);
        if (!current) {
          merged.set(key, new Date(timestamp).toISOString());
          continue;
        }

        if (this.parseTimestamp(current) < timestamp) {
          merged.set(key, new Date(timestamp).toISOString());
        }
      }
    };

    addEntries(existing);
    addEntries(incoming);

    if (merged.size === 0) {
      return undefined;
    }

    return Object.fromEntries(merged.entries());
  }

  private pruneReactionTombstones(
    reactions: Reaction[] | undefined,
    tombstones?: Record<string, string>
  ): Record<string, string> | undefined {
    if (!tombstones) {
      return undefined;
    }

    const entries = Object.entries(tombstones);
    if (entries.length === 0) {
      return undefined;
    }

    const map = new Map(entries);

    if (reactions && reactions.length > 0) {
      for (const reaction of reactions) {
        const key = this.getReactionKey(reaction);
        const removedAt = map.get(key);
        if (!removedAt) continue;

        const removalTimestamp = this.parseTimestamp(removedAt);
        const createdAt = this.parseTimestamp(reaction.createdAt);
        if (removalTimestamp < createdAt) {
          map.delete(key);
        }
      }
    }

    return map.size > 0 ? Object.fromEntries(map.entries()) : undefined;
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

      if (post.authorBannerRef) {
        manifestIds.add(post.authorBannerRef);
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

  private getSnapshotTimestamp(snapshot: PostBadgeSnapshot): number {
    if (!snapshot.unlockedAt) {
      return 0;
    }

    const value = Date.parse(snapshot.unlockedAt);
    return Number.isFinite(value) ? value : 0;
  }

  private async ensureAuthorBadges(
    badgeSnapshotsByAuthor: Map<string, Map<string, PostBadgeSnapshot>>,
  ): Promise<void> {
    const operations: Promise<void>[] = [];

    for (const [authorId, badgeMap] of badgeSnapshotsByAuthor.entries()) {
      if (!authorId || badgeMap.size === 0) {
        continue;
      }

      for (const snapshot of badgeMap.values()) {
        operations.push(this.upsertBadgeProgress(authorId, snapshot));
      }
    }

    if (operations.length > 0) {
      await Promise.allSettled(operations);
    }
  }

  private async upsertBadgeProgress(authorId: string, snapshot: PostBadgeSnapshot): Promise<void> {
    try {
      const achievementId = snapshot.id;
      if (!achievementId) {
        return;
      }

      const existing = await getAchievementProgressRecord(authorId, achievementId);
      const existingUnlockedTime = existing?.unlocked
        ? Date.parse(existing.unlockedAt ?? existing.lastUpdated)
        : 0;
      const incomingUnlockedTime = snapshot.unlockedAt ? Date.parse(snapshot.unlockedAt) : Date.now();

      if (
        existing?.unlocked &&
        Number.isFinite(existingUnlockedTime) &&
        Number.isFinite(incomingUnlockedTime) &&
        existingUnlockedTime >= incomingUnlockedTime
      ) {
        return;
      }

      const now = new Date().toISOString();
      await saveAchievementProgressRecord({
        id: existing?.id ?? `progress-${authorId}-${achievementId}`,
        userId: authorId,
        achievementId,
        unlocked: true,
        unlockedAt: snapshot.unlockedAt ?? existing?.unlockedAt ?? now,
        lastUpdated: now,
        progress: 1,
        progressLabel: "Unlocked",
        meta: existing?.meta,
      });
    } catch (error) {
      console.warn(
        `[PostSync] Failed to synchronize badge ${snapshot.id} for author ${authorId}:`,
        error,
      );
    }
  }
}
