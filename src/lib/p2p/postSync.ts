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
import { signPost, verifyPostSignature } from "./replication";
import { recordP2PDiagnostic } from "./diagnostics";
import { applyBlogIdentity } from "@/lib/blogging/awareness";

type PostSyncMessageType =
  | "posts_request"
  | "posts_sync"
  | "post_created"
  | "project_upsert"
  | "projects_request"
  | "projects_sync";

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
    "post_created",
    "project_upsert",
    "projects_request",
    "projects_sync"
  ]);

  // Offline queue — posts queued when no peers are connected
  private offlineQueue: Post[] = [];
  private static readonly OFFLINE_QUEUE_KEY = 'p2p:offlinePostQueue';

  // Offline queue for projects when no peers are connected
  private offlineProjectQueue: Project[] = [];
  private static readonly OFFLINE_PROJECT_QUEUE_KEY = 'p2p:offlineProjectQueue';

  constructor(
    private readonly sendMessage: SendMessageFn,
    private readonly getConnectedPeers: ConnectedPeersFn,
    private readonly ensureManifests: EnsureManifestsFn
  ) {
    // Restore any queued posts from localStorage on construction
    this.restoreOfflineQueue();
    this.restoreOfflineProjectQueue();
  }

  isPostSyncMessage(message: unknown): message is PostSyncMessage {
    return (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      this.messageTypes.has((message as { type: string }).type as PostSyncMessageType)
    );
  }

  async handlePeerConnected(peerId: string): Promise<void> {
    // Flush offline queue first — deliver any posts that were created while disconnected
    await this.flushOfflineProjectQueue();
    await this.flushOfflineQueue();
    await this.sendAllPostsToPeer(peerId);
    await this.sendAllProjectsToPeer(peerId);
    this.sendMessage(peerId, { type: "posts_request" });
    this.sendMessage(peerId, { type: "projects_request" });
  }

  async handlePeerDisconnected(_peerId: string): Promise<void> {
    // Placeholder for future cleanup logic if needed
  }

  async handleMessage(peerId: string, message: PostSyncMessage): Promise<void> {
    console.log(`[PostSync] 📨 Received ${message.type} message from ${peerId}`);
    
    switch (message.type) {
      case "posts_request":
        console.log(`[PostSync] Peer ${peerId} requested all posts`);
        await this.sendAllPostsToPeer(peerId);
        break;
      case "posts_sync":
        console.log(`[PostSync] Received sync with ${message.posts?.length ?? 0} posts and ${message.projects?.length ?? 0} projects from ${peerId}`);
        if (Array.isArray(message.projects) && message.projects.length > 0) {
          await this.saveIncomingProjects(message.projects);
        }

        if (Array.isArray(message.posts) && message.posts.length > 0) {
          const saved = await this.saveIncomingPosts(message.posts);
          console.log(`[PostSync] 💾 Saved ${saved.length} new/updated posts from ${peerId}`);
          if (saved.length > 0) {
            await this.ensurePostAssets(saved, peerId);
          }
        }
        break;
      case "post_created":
        console.log(`[PostSync] Received new post ${message.post?.id} from ${peerId}`);
        if (message.post) {
          if (Array.isArray(message.projects) && message.projects.length > 0) {
            await this.saveIncomingProjects(message.projects);
          }
          const saved = await this.saveIncomingPosts([message.post]);
          console.log(`[PostSync] 💾 Saved ${saved.length} posts from post_created message`);
          if (saved.length > 0) {
            await this.ensurePostAssets(saved, peerId);
          }
        }
        break;
      case "projects_request":
        console.log(`[PostSync] Peer ${peerId} requested all projects`);
        await this.sendAllProjectsToPeer(peerId);
        break;
      case "projects_sync":
      case "project_upsert":
        console.log(`[PostSync] Received ${message.projects?.length ?? 0} projects from ${peerId}`);
        if (Array.isArray(message.projects) && message.projects.length > 0) {
          await this.saveIncomingProjects(message.projects);
        }
        break;
    }
  }

  async broadcastPost(post: Post): Promise<void> {
    // Never broadcast local-only posts
    if (post._localOnly) {
      console.log(`[PostSync] ⏭️ Post ${post.id} is local-only, skipping broadcast`);
      return;
    }

    const peers = this.getConnectedPeers();
    if (peers.length === 0) {
      // No peers connected — queue the post for later delivery
      console.log(`[PostSync] 📦 No peers connected, queuing post ${post.id} for offline delivery`);
      this.enqueueOfflinePost(post);
      return;
    }

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

    const outboundPost = (await verifyPostSignature(post)) ? post : await signPost(post);

    const payload: PostSyncMessage = { type: "post_created", post: outboundPost };
    if (associatedProject) {
      payload.projects = [associatedProject];
    }

    let sentToAny = false;
    peers.forEach((peerId) => {
      const sent = this.sendMessage(peerId, payload);
      if (sent) {
        sentToAny = true;
      } else {
        console.warn(`[PostSync] Failed to broadcast post ${post.id} to ${peerId}`);
      }
    });

    // Mark as synced if delivered to at least one peer
    if (sentToAny) {
      this.markPostSynced(post.id);
    }
  }

  private async sendAllPostsToPeer(peerId: string): Promise<void> {
    try {
      const [allPosts, projects] = await Promise.all([
        getAll<Post>("posts"),
        getAll<Project>("projects"),
      ]);

      // Filter out local-only posts — they should never leave this node
      const posts = allPosts.filter(p => !p._localOnly);

      console.log(`[PostSync] 📤 Preparing to send ${posts.length} posts and ${projects.length} projects to peer ${peerId}`);

      const shareableProjects = projects.filter((project) => this.isProjectShareable(project));

      if (posts.length === 0 && shareableProjects.length === 0) {
        console.log(`[PostSync] No posts or projects to send to ${peerId}`);
        return;
      }

      const payload: PostSyncMessage = { type: "posts_sync" };
      if (posts.length > 0) {
        payload.posts = posts;
      }
      if (shareableProjects.length > 0) {
        payload.projects = shareableProjects;
      }

      console.log(`[PostSync] 🚀 Sending posts_sync message with ${posts.length} posts to ${peerId}`);
      const sent = this.sendMessage(peerId, payload);

      if (!sent) {
        console.warn(`[PostSync] ❌ Failed to send posts to ${peerId}`);
      } else {
        console.log(`[PostSync] ✅ Successfully sent posts to ${peerId}`);
      }
    } catch (error) {
      console.error("[PostSync] Error sending posts to peer:", error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PROJECT BROADCAST + SYNC
  // ═══════════════════════════════════════════════════════════════════

  async broadcastProject(project: Project): Promise<void> {
    if (!this.isProjectShareable(project)) {
      return;
    }

    const peers = this.getConnectedPeers();
    if (peers.length === 0) {
      this.enqueueOfflineProject(project);
      return;
    }

    const payload: PostSyncMessage = { type: "project_upsert", projects: [project] };
    let sentToAny = false;
    for (const peerId of peers) {
      if (this.sendMessage(peerId, payload)) {
        sentToAny = true;
      }
    }

    if (!sentToAny) {
      this.enqueueOfflineProject(project);
    }
  }

  private async sendAllProjectsToPeer(peerId: string): Promise<void> {
    try {
      const projects = await getAll<Project>("projects");
      const shareable = projects.filter((project) => this.isProjectShareable(project));
      if (shareable.length === 0) return;

      const sent = this.sendMessage(peerId, { type: "projects_sync", projects: shareable });
      if (!sent) {
        console.warn(`[PostSync] Failed to send projects_sync to ${peerId}`);
      } else {
        console.log(`[PostSync] ✅ Sent ${shareable.length} projects to ${peerId}`);
      }
    } catch (error) {
      console.error("[PostSync] Error sending projects to peer:", error);
    }
  }

  private enqueueOfflineProject(project: Project): void {
    // Replace any existing entry for the same id (latest wins)
    this.offlineProjectQueue = this.offlineProjectQueue.filter((p) => p.id !== project.id);
    this.offlineProjectQueue.push(project);
    this.persistOfflineProjectQueue();
    console.log(`[PostSync] 📦 Queued project ${project.id} (${this.offlineProjectQueue.length} in queue)`);
  }

  private async flushOfflineProjectQueue(): Promise<void> {
    if (this.offlineProjectQueue.length === 0) return;
    const peers = this.getConnectedPeers();
    if (peers.length === 0) return;

    const toFlush = [...this.offlineProjectQueue];
    const delivered: string[] = [];

    for (const project of toFlush) {
      const payload: PostSyncMessage = { type: "project_upsert", projects: [project] };
      let sentToAny = false;
      for (const peerId of peers) {
        if (this.sendMessage(peerId, payload)) {
          sentToAny = true;
        }
      }
      if (sentToAny) delivered.push(project.id);
    }

    if (delivered.length > 0) {
      const set = new Set(delivered);
      this.offlineProjectQueue = this.offlineProjectQueue.filter((p) => !set.has(p.id));
      this.persistOfflineProjectQueue();
    }
  }

  private persistOfflineProjectQueue(): void {
    try {
      localStorage.setItem(
        PostSyncManager.OFFLINE_PROJECT_QUEUE_KEY,
        JSON.stringify(this.offlineProjectQueue)
      );
    } catch {
      console.warn('[PostSync] Failed to persist offline project queue');
    }
  }

  private restoreOfflineProjectQueue(): void {
    try {
      const stored = localStorage.getItem(PostSyncManager.OFFLINE_PROJECT_QUEUE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.offlineProjectQueue = parsed;
          console.log(`[PostSync] 📦 Restored ${this.offlineProjectQueue.length} projects from offline queue`);
        }
      }
    } catch {
      console.warn('[PostSync] Failed to restore offline project queue');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // OFFLINE QUEUE
  // ═══════════════════════════════════════════════════════════════════

  private enqueueOfflinePost(post: Post): void {
    // Avoid duplicates
    if (this.offlineQueue.some(p => p.id === post.id)) return;
    this.offlineQueue.push(post);
    this.persistOfflineQueue();
    console.log(`[PostSync] 📦 Queued post ${post.id} (${this.offlineQueue.length} in queue)`);
    
    recordP2PDiagnostic({
      level: 'info',
      source: 'post-sync',
      code: 'post-queued-offline',
      message: `Post ${post.id} queued for offline delivery (${this.offlineQueue.length} total)`,
    });
  }

  private async flushOfflineQueue(): Promise<void> {
    if (this.offlineQueue.length === 0) return;

    const peers = this.getConnectedPeers();
    if (peers.length === 0) return;

    console.log(`[PostSync] 🔄 Flushing ${this.offlineQueue.length} queued posts to ${peers.length} peers`);
    const toFlush = [...this.offlineQueue];
    // Don't clear yet — only remove successfully delivered posts
    const delivered: string[] = [];

    for (const post of toFlush) {
      // Skip local-only posts — they should never be broadcast
      if (post._localOnly) {
        delivered.push(post.id);
        console.log(`[PostSync] ⏭️ Skipping local-only post ${post.id}`);
        continue;
      }

      try {
        const outboundPost = (await verifyPostSignature(post)) ? post : await signPost(post);
        const payload: PostSyncMessage = { type: "post_created", post: outboundPost };

        let sentToAny = false;
        for (const peerId of peers) {
          if (this.sendMessage(peerId, payload)) {
            sentToAny = true;
          }
        }

        if (sentToAny) {
          delivered.push(post.id);
          console.log(`[PostSync] ✅ Delivered queued post ${post.id}`);
          // Mark as synced in IndexedDB
          this.markPostSynced(post.id);
        } else {
          console.warn(`[PostSync] ⚠️ Failed to deliver queued post ${post.id}, keeping in queue`);
        }
      } catch (err) {
        console.error(`[PostSync] Failed to flush post ${post.id}:`, err);
        // Keep in queue — don't remove
      }
    }

    // Only remove delivered posts from queue
    if (delivered.length > 0) {
      const deliveredSet = new Set(delivered);
      this.offlineQueue = this.offlineQueue.filter(p => !deliveredSet.has(p.id));
      this.persistOfflineQueue();
    }

    recordP2PDiagnostic({
      level: 'info',
      source: 'post-sync',
      code: 'offline-queue-flushed',
      message: `Flushed ${delivered.length}/${toFlush.length} queued posts, ${this.offlineQueue.length} remaining`,
    });
  }

  private async markPostSynced(postId: string): Promise<void> {
    try {
      const post = await get<Post>("posts", postId);
      if (post && !post._syncedToMesh) {
        await put("posts", { ...post, _syncedToMesh: true });
        this.notifyFeeds();
      }
    } catch {
      // Non-critical
    }
  }

  private persistOfflineQueue(): void {
    try {
      localStorage.setItem(
        PostSyncManager.OFFLINE_QUEUE_KEY,
        JSON.stringify(this.offlineQueue)
      );
    } catch {
      console.warn('[PostSync] Failed to persist offline queue');
    }
  }

  private restoreOfflineQueue(): void {
    try {
      const stored = localStorage.getItem(PostSyncManager.OFFLINE_QUEUE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.offlineQueue = parsed;
          console.log(`[PostSync] 📦 Restored ${this.offlineQueue.length} posts from offline queue`);
        }
      }
    } catch {
      console.warn('[PostSync] Failed to restore offline queue');
    }
  }

  getOfflineQueueSize(): number {
    return this.offlineQueue.length;
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

    for (const rawPost of posts) {
      try {
        const post = applyBlogIdentity(rawPost);

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

      const signatureValid = await verifyPostSignature(post);
      if (!signatureValid) {
        // SEC-001 FIX: Brain-stage-gated signature enforcement.
        // Stages 1-3 (bootstrap): accept unsigned posts to allow early mesh sync.
        // Stage 4+: reject posts with invalid signatures to prevent forgery.
        const enforceSignatures = this.shouldEnforceSignatures();
        if (enforceSignatures && post.signature) {
          // Post HAS a signature but it's INVALID — reject (forgery attempt)
          console.warn('[PostSync] 🛡️ REJECTED post with invalid signature:', post.id, 'from:', post.author);
          recordP2PDiagnostic({
            level: 'warn',
            source: 'post-sync',
            code: 'post-signature-rejected',
            message: `Post REJECTED — invalid signature (enforcement active)`,
            context: { postId: post.id, authorId: post.author }
          });
          continue; // Skip this post entirely
        }

        // Log acceptance for unsigned/early-stage posts
        const logLevel = enforceSignatures ? 'warn' : 'info';
        console.warn(`[PostSync] ⚠️ Post signature unverified (stage-gated: ${enforceSignatures ? 'enforcing' : 'permissive'}):`, post.id);
        recordP2PDiagnostic({
          level: logLevel,
          source: 'post-sync',
          code: 'post-signature-unverified',
          message: `Post accepted with unverified signature (enforcement=${enforceSignatures})`,
          context: { postId: post.id, authorId: post.author, hasSignature: !!post.signature, hasPublicKey: !!post.signerPublicKey }
        });
      }

      // BUG-15 FIX: Tag incoming posts with _origin='synced' so the feed
      // filter can distinguish local vs. peer content.  Posts created locally
      // already carry _origin='local' from the PostComposer.  Legacy posts
      // that arrive without _origin are conservatively tagged as 'synced'.
      if (!post._origin) {
        post._origin = 'synced';
      }

      const changed = await this.upsertPost(post);
        if (changed) {
          updatedCount++;
          updatedPosts.push(post);
        }
      } catch (error) {
        const postId = typeof rawPost?.id === "string" ? rawPost.id : "unknown";
        console.error(`[PostSync] Failed to store post ${postId}:`, error);
      }
    }

    if (authorSnapshots.size > 0) {
      await this.ensureAuthorProfiles(authorSnapshots);
    }

    if (badgeSnapshotsByAuthor.size > 0) {
      await this.ensureAuthorBadges(badgeSnapshotsByAuthor);
    }

    if (updatedCount > 0) {
      console.log(`[PostSync] 🔔 Notifying feeds about ${updatedCount} new/updated posts`);
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
    const incomingPost = applyBlogIdentity(post);
    const existing = await get<Post>("posts", post.id);

    if (!existing) {
      // Tag synced posts — preserve _origin if already set (e.g. local offline queue)
      const tagged: Post = incomingPost._origin ? incomingPost : { ...incomingPost, _origin: 'synced' };
      await put("posts", tagged);

      if (tagged.projectId) {
        await this.ensureProjectFeedContainsPost(tagged.projectId, tagged.id);
      }

      return true;
    }

    const incomingTimestamp = this.getPostTimestamp(incomingPost);
    const existingTimestamp = this.getPostTimestamp(existing);

    const mergedTombstones = this.mergeReactionTombstones(
      existing.reactionTombstones,
      incomingPost.reactionTombstones
    );

    const mergedReactions = this.mergeReactions(
      existing.reactions,
      incomingPost.reactions,
      mergedTombstones
    );

    const prunedTombstones = this.pruneReactionTombstones(
      mergedReactions,
      mergedTombstones
    );

    const mergedPost: Post =
      incomingTimestamp >= existingTimestamp
        ? { ...existing, ...incomingPost }
        : { ...existing };

    // Preserve local origin — never downgrade a locally-created post to 'synced'
    if (existing._origin === 'local') {
      mergedPost._origin = 'local';
    }

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

    const latestEditedAt = this.getNewestDate(existing.editedAt, incomingPost.editedAt);
    if (latestEditedAt) {
      mergedPost.editedAt = latestEditedAt;
    } else {
      delete mergedPost.editedAt;
    }

    const normalizedMergedPost = applyBlogIdentity(mergedPost);

    if (!this.didPostChange(existing, normalizedMergedPost)) {
      return false;
    }

    await put("posts", normalizedMergedPost);

    if (normalizedMergedPost.projectId) {
      await this.ensureProjectFeedContainsPost(normalizedMergedPost.projectId, normalizedMergedPost.id);
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

  // ═══════════════════════════════════════════════════════════════════
  // SEC-001: Brain-stage-gated signature enforcement
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Determines whether signature enforcement is active.
   * - Stages 1-3 (bootstrap): permissive — unsigned/unverified posts accepted
   * - Stage 4+: strict — posts with INVALID signatures are rejected
   * 
   * The brain stage is read from the entity voice birth timestamp and
   * total interaction count stored by the neural engine.  If unavailable
   * (e.g. entity voice not yet initialised), defaults to permissive.
   */
  private shouldEnforceSignatures(): boolean {
    try {
      const birthRaw = localStorage.getItem('entity-voice-birth-timestamp');
      if (!birthRaw) return false; // no entity yet → permissive

      const birthTs = parseInt(birthRaw, 10);
      if (isNaN(birthTs)) return false;

      const ageMs = Date.now() - birthTs;

      // Stage 4 requires 500+ interactions AND 2+ hours age
      // We can't easily access the neural engine from here, so we use
      // a conservative heuristic: if the entity has been alive > 2 hours
      // AND total interaction count (stored by neural engine) is high enough
      const interactionCountRaw = localStorage.getItem('neural-total-interactions');
      const interactionCount = interactionCountRaw ? parseInt(interactionCountRaw, 10) : 0;

      // Stage 4 thresholds: 500 interactions, 2 hours
      return interactionCount >= 500 && ageMs >= 2 * 3600_000;
    } catch {
      return false; // fail-open during bootstrap
    }
  }
}
