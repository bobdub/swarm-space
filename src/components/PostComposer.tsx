import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FileUpload } from "@/components/FileUpload";
import { AccountSetupModal } from "@/components/AccountSetupModal";
import { PostCard } from "@/components/PostCard";
import { FolderOpen, X, Lock, Coins } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useP2PContext } from "@/contexts/P2PContext";
import { getAll, put } from "@/lib/store";
import { getUserProjects, addPostToProject } from "@/lib/projects";
import { awardPostCredits } from "@/lib/credits";
import { evaluateAchievementEvent } from "@/lib/achievements";
import { listUserAchievementProgress } from "@/lib/achievementsStore";
import type { PostBadgeSnapshot } from "@/types";
import type { Manifest } from "@/lib/fileEncryption";
import type { Post, Project } from "@/types";
import { toast } from "sonner";
import { StartLiveRoomButton } from "@/components/streaming/StartLiveRoomButton";
import { signPost } from "@/lib/p2p/replication";
import { applyBlogIdentity } from "@/lib/blogging/awareness";
import { MentionPopover } from "@/components/MentionPopover";
import { parseMentions, containsEntityMention } from "@/lib/mentions";
import { createNotification } from "@/lib/notifications";

interface PostComposerProps {
  onCancel?: () => void;
  onPostCreated?: (post: Post) => void;
  defaultProjectId?: string | null;
  showHeader?: boolean;
  showPostHistory?: boolean;
  className?: string;
  autoFocus?: boolean;
  onSetupDismiss?: () => void;
}

export const PostComposer = ({
  onCancel,
  onPostCreated,
  defaultProjectId,
  showHeader = false,
  showPostHistory = false,
  className,
  autoFocus = false,
  onSetupDismiss,
}: PostComposerProps) => {
  const { user } = useAuth();
  const { broadcastPost, announceContent } = useP2PContext();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [attachedManifests, setAttachedManifests] = useState<Manifest[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(defaultProjectId ?? "");
  const [userProjects, setUserProjects] = useState<Project[]>([]);
  const [userPosts, setUserPosts] = useState<Post[]>([]);
  const [showAccountSetup, setShowAccountSetup] = useState(false);
  const [isNSFW, setIsNSFW] = useState(false);
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [isWalled, setIsWalled] = useState(false);
  const [wallUnlockPrice, setWallUnlockPrice] = useState("");
  const [wallPaymentAssets, setWallPaymentAssets] = useState<import("@/lib/blockchain/walledPost").PaymentAsset[]>([]);
  const [wallSelectedAssetId, setWallSelectedAssetId] = useState("SWARM");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const streamingProjectOptions = useMemo(
    () => userProjects.map((project) => ({ id: project.id, name: project.name })),
    [userProjects],
  );

  const selectedStreamingProjectId = useMemo(() => {
    if (!selectedProjectId || selectedProjectId === "none") {
      return null;
    }
    return selectedProjectId;
  }, [selectedProjectId]);

  const shouldShowCancel = Boolean(onCancel);

  const loadUserProjects = useCallback(async () => {
    const projects = await getUserProjects();
    setUserProjects(projects);
  }, []);

  const loadUserPosts = useCallback(async () => {
    if (!user || !showPostHistory) return;
    const allPosts = await getAll<Post>("posts");
    const posts = allPosts
      .filter((post) => post.author === user.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setUserPosts(posts);
  }, [showPostHistory, user]);

  useEffect(() => {
    if (!user) {
      setShowAccountSetup(true);
      setUserPosts([]);
      return;
    }

    setShowAccountSetup(false);
    void loadUserProjects();
    void loadUserPosts();
  }, [loadUserPosts, loadUserProjects, user]);

  useEffect(() => {
    const handlePostSync = () => {
      void loadUserPosts();
    };

    window.addEventListener("p2p-posts-updated", handlePostSync);
    return () => window.removeEventListener("p2p-posts-updated", handlePostSync);
  }, [loadUserPosts]);

  useEffect(() => {
    if (!defaultProjectId) return;
    setSelectedProjectId(defaultProjectId);
  }, [defaultProjectId]);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  // Load payment assets when walled toggle is enabled
  useEffect(() => {
    if (!isWalled || !user) return;
    let cancelled = false;
    import("@/lib/blockchain/walledPost").then(({ getUserPaymentAssets }) => {
      getUserPaymentAssets(user.id).then((assets) => {
        if (!cancelled) {
          setWallPaymentAssets(assets);
        }
      });
    });
    return () => { cancelled = true; };
  }, [isWalled, user]);

  const handleAccountSetupComplete = () => {
    setShowAccountSetup(false);
    setTimeout(() => {
      void loadUserProjects();
      void loadUserPosts();
    }, 100);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!user) {
      setShowAccountSetup(true);
      toast.error("Please complete account setup first");
      return;
    }

    if (!content.trim()) {
      toast.error("Please enter some content");
      return;
    }

    setLoading(true);
    try {
      const manifestIds = attachedManifests.map((manifest) => manifest.fileId);
      const postType = manifestIds.length > 0
        ? (attachedManifests[0].mime.startsWith("image/")
          ? "image"
          : attachedManifests[0].mime.startsWith("video/")
            ? "video"
            : "file")
        : "text";

      const projectIdForPost = selectedProjectId && selectedProjectId !== "none"
        ? selectedProjectId
        : null;

      let badgeSnapshots: PostBadgeSnapshot[] | undefined;
      try {
        const progressRecords = await listUserAchievementProgress(user.id);
        const unlocked = progressRecords
          .filter((record) => record.unlocked)
          .map<PostBadgeSnapshot>((record) => ({
            id: record.achievementId,
            unlockedAt: record.unlockedAt ?? record.lastUpdated ?? null,
          }))
          .sort((a, b) => {
            const aTime = a.unlockedAt ? new Date(a.unlockedAt).getTime() : 0;
            const bTime = b.unlockedAt ? new Date(b.unlockedAt).getTime() : 0;
            return bTime - aTime;
          })
          .slice(0, 6);

        if (unlocked.length > 0) {
          badgeSnapshots = unlocked;
        }
      } catch (error) {
        console.warn("[PostComposer] Failed to snapshot badges for post", error);
      }

      // Read deterministic peer ID for cross-network identity
      let authorPeerId: string | undefined;
      try {
        const raw = localStorage.getItem("connection-state");
        if (raw) {
          const cs = JSON.parse(raw);
          if (cs.peerId) authorPeerId = cs.peerId;
        }
      } catch { /* non-critical */ }

      const post: Post = {
        id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        author: user.id,
        authorName: user.displayName || user.username,
        authorAvatarRef: user.profile?.avatarRef,
        authorBannerRef: user.profile?.bannerRef,
        authorPeerId,
        authorBadgeSnapshots: badgeSnapshots,
        projectId: projectIdForPost,
        type: postType,
        content: content.trim(),
        manifestIds,
        createdAt: new Date().toISOString(),
        nsfw: isNSFW,
        likes: 0,
        comments: [],
        _origin: 'local',
      };

      let signedPost = await signPost(applyBlogIdentity(post));

      await put("posts", signedPost);

      // Handle walled post locking — MUST happen before broadcast so peers
      // receive the post with `walled: true` already set.
      if (isWalled && wallUnlockPrice && Number(wallUnlockPrice) > 0) {
        try {
          const { lockPost: lockWalledPost } = await import("@/lib/blockchain/walledPost");
          const { getUserProfileTokenHoldings } = await import("@/lib/blockchain/profileTokenBalance");
          const holdings = await getUserProfileTokenHoldings(user.id);
          const creatorToken = holdings[0];
          if (creatorToken) {
            // Find selected payment asset
            const selectedPaymentAsset = wallPaymentAssets.find((a) => a.id === wallSelectedAssetId)
              ?? wallPaymentAssets[0];
            await lockWalledPost(
              user.id,
              signedPost.id,
              creatorToken.tokenId,
              creatorToken.ticker,
              Number(wallUnlockPrice),
              selectedPaymentAsset,
            );
            const dynamicCost = selectedPaymentAsset
              ? 5 * selectedPaymentAsset.ratioToSwarm
              : 5;
            toast.success(
              `Post locked! Fee: ${dynamicCost} ${selectedPaymentAsset?.ticker ?? "SWARM"}. ` +
              `Unlock cost: ${wallUnlockPrice} $${creatorToken.ticker}`,
            );

            // Re-read the post from DB so broadcast carries the walled fields
            const { get: getRecord } = await import("@/lib/store");
            const freshPost = await getRecord<Post>("posts", signedPost.id);
            if (freshPost) {
              signedPost = freshPost;
            }
          } else {
            toast.error("No Creator Token found. Deploy a token first to lock posts.");
          }
        } catch (error) {
          console.error("[PostComposer] Failed to lock post:", error);
          toast.error(error instanceof Error ? error.message : "Failed to lock post");
        }
      }

      // Record post to blockchain (NFT wrapping)
      try {
        const { recordPostToBlockchain } = await import("@/lib/blockchain/blockchainRecorder");
        await recordPostToBlockchain(signedPost.id, user.id, content, manifestIds);
      } catch (error) {
        console.error("[PostComposer] Failed to record post to blockchain:", error);
      }

      // Also record to Builder Mode standalone chain if active
      try {
        const { getStandaloneBuilderMode } = await import("@/lib/p2p/builderMode.standalone");
        const builder = getStandaloneBuilderMode();
        if (builder.getPhase() === 'online' && builder.getToggles().blockchainSync) {
          builder.addTransaction("nft_mint", "swarm-network", {
            postId: signedPost.id,
            contentPreview: content.slice(0, 100),
            type: "content_nft",
            timestamp: new Date().toISOString(),
          });
          console.log("[PostComposer] Post wrapped as NFT on Builder Mode chain");
        }
      } catch {
        // Builder mode not initialized — non-critical
      }

      announceContent(signedPost.id);
      broadcastPost(signedPost);

      // Broadcast through standalone P2P (Test Mode + SwarmMesh)
      try {
        const { getTestMode } = await import('@/lib/p2p/testMode.standalone');
        const tm = getTestMode();
        if (tm.getPhase() === 'online') {
          tm.broadcastNewPost(signedPost as unknown as Record<string, unknown>);
        }
      } catch { /* non-critical */ }
      try {
        const { getSwarmMeshStandalone } = await import('@/lib/p2p/swarmMesh.standalone');
        const sm = getSwarmMeshStandalone();
        if (sm.getPhase() === 'online') {
          sm.broadcastNewPost(signedPost as unknown as Record<string, unknown>);
        }
      } catch { /* non-critical */ }
      try {
        const { getStandaloneBuilderMode } = await import('@/lib/p2p/builderMode.standalone');
        const bm = getStandaloneBuilderMode();
        if (bm.getPhase() === 'online') {
          bm.broadcastNewPost(signedPost as unknown as Record<string, unknown>);
        }
      } catch { /* non-critical */ }

      // Trigger entity voice evaluation for the new post
      try {
        window.dispatchEvent(new CustomEvent('p2p-entity-voice-evaluate', { detail: signedPost }));
      } catch { /* non-critical */ }

      manifestIds.forEach((manifestId) => {
        announceContent(manifestId);
      });

      if (projectIdForPost) {
        await addPostToProject(projectIdForPost, signedPost.id);
      }

      await awardPostCredits(signedPost.id, user.id);

      await evaluateAchievementEvent({
        type: "post:created",
        userId: user.id,
        post: signedPost,
      }).catch((error) => {
        console.warn("[PostComposer] Failed to evaluate achievements", error);
      });

      toast.success("Post created! +1 credit earned");

      setContent("");
      setAttachedManifests([]);
      setSelectedProjectId("");
      setIsNSFW(false);
      setIsWalled(false);
      setWallUnlockPrice("");
      setWallSelectedAssetId("SWARM");
      setShowFileUpload(false);

      void loadUserPosts();
      onPostCreated?.(signedPost);
    } catch (error) {
      toast.error("Failed to create post");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilesReady = (manifests: Manifest[]) => {
    setAttachedManifests((prev) => [...prev, ...manifests]);
  };

  const removeAttachment = (fileId: string) => {
    setAttachedManifests((prev) => prev.filter((manifest) => manifest.fileId !== fileId));
  };

  const wrapperClasses = useMemo(() => {
    return ["space-y-6", className].filter(Boolean).join(" ");
  }, [className]);

  return (
    <div className={wrapperClasses}>
      <AccountSetupModal
        open={showAccountSetup}
        onComplete={handleAccountSetupComplete}
        onDismiss={() => {
          setShowAccountSetup(false);
          onSetupDismiss?.();
        }}
      />

      {showHeader && (
        <h1 className="text-3xl font-bold">Create Post</h1>
      )}

      <form onSubmit={handleSubmit}>
        <Card className="space-y-6 border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.6)] p-6 backdrop-blur-xl">
          <div className="space-y-2">
            <Label htmlFor="content" className="text-sm font-semibold uppercase tracking-wider">
              What's on your mind?
            </Label>
            <Textarea
              ref={textareaRef}
              id="content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Share your thoughts..."
              className="min-h-[200px] border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,10%,0.6)]"
            />
          </div>

          {userProjects.length > 0 && (
            <div className="space-y-2">
              <Label
                htmlFor="project"
                className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider"
              >
                <FolderOpen className="h-4 w-4" />
                Add to Project (Optional)
              </Label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger className="border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,10%,0.6)]">
                  <SelectValue placeholder="Select a project..." />
                </SelectTrigger>
                <SelectContent className="border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.95)] backdrop-blur-xl">
                  <SelectItem value="none">None (Personal Feed)</SelectItem>
                  {userProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedProjectId && selectedProjectId !== "none" && (
                <p className="text-xs text-foreground/60">
                  This post will appear in the project feed and your personal feed.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-md border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,10%,0.6)] p-4">
            <div className="space-y-1">
              <Label className="text-sm font-semibold uppercase tracking-wider">Go live</Label>
              <p className="text-xs text-foreground/60">
                Start a live streaming room from your profile or one of your projects. Active rooms appear in
                the streaming tray for quick access.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-foreground/50">
                Choose a context when launching to share with the right collaborators.
              </p>
              <StartLiveRoomButton
                projectOptions={streamingProjectOptions}
                initialProjectId={selectedStreamingProjectId}
              />
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,10%,0.6)] px-4 py-3">
            <div>
              <Label htmlFor="nsfw" className="text-sm font-semibold uppercase tracking-wider">
                NSFW Content
              </Label>
              <p className="text-xs text-foreground/60">
                Mark as sensitive to hide behind a warning for other explorers.
              </p>
            </div>
            <Switch
              id="nsfw"
              checked={isNSFW}
              onCheckedChange={setIsNSFW}
              aria-label="Mark post as NSFW"
            />
          </div>

          <div className="rounded-md border border-[hsla(326,71%,62%,0.25)] bg-[hsla(245,70%,10%,0.6)] px-4 py-3 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="walled" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
                  <Lock className="h-4 w-4 text-[hsl(326,71%,62%)]" />
                  Lock Post
                </Label>
                <p className="text-xs text-foreground/60">
                  Place content behind an encrypted paywall.
                </p>
              </div>
              <Switch
                id="walled"
                checked={isWalled}
                onCheckedChange={setIsWalled}
                aria-label="Lock post behind paywall"
              />
            </div>

            {isWalled && (
              <div className="space-y-3">
                {/* Payment asset selector */}
                <div className="space-y-2 rounded-lg border border-[hsla(326,71%,62%,0.15)] bg-[hsla(245,70%,12%,0.5)] p-3">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-foreground/70">
                    Pay Processing Fee With
                  </Label>
                  <Select value={wallSelectedAssetId} onValueChange={setWallSelectedAssetId}>
                    <SelectTrigger className="border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,12%,0.6)]">
                      <SelectValue placeholder="Select payment asset" />
                    </SelectTrigger>
                    <SelectContent className="border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.95)] backdrop-blur-xl">
                      {wallPaymentAssets.map((asset) => (
                        <SelectItem key={asset.id} value={asset.id}>
                          ${asset.ticker} ({asset.ratioToSwarm}:1 ratio)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Dynamic fee display */}
                {(() => {
                  const selectedAsset = wallPaymentAssets.find((a) => a.id === wallSelectedAssetId);
                  const dynamicFee = selectedAsset ? 5 * selectedAsset.ratioToSwarm : 5;
                  const isSwarm = !selectedAsset || selectedAsset.type === "swarm";
                  return (
                    <div className="flex items-center gap-2 rounded-lg border border-[hsla(326,71%,62%,0.2)] bg-[hsla(326,71%,62%,0.08)] px-3 py-2">
                      <Coins className="h-4 w-4 flex-shrink-0 text-[hsl(326,71%,62%)]" />
                      <div className="text-[0.7rem] font-medium text-[hsl(326,71%,72%)]">
                        <span>Processing fee: </span>
                        <span className="font-bold">{dynamicFee} {selectedAsset?.ticker ?? "SWARM"}</span>
                        {!isSwarm && (
                          <span className="text-foreground/50"> (= 5 SWARM at {selectedAsset!.ratioToSwarm}:1)</span>
                        )}
                        <span className="block text-[0.6rem] text-foreground/45 mt-0.5">
                          1 coin wraps content • 4 return to pool
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Unlock price input */}
                <div className="space-y-2 rounded-lg border border-[hsla(174,59%,56%,0.15)] bg-[hsla(245,70%,12%,0.5)] p-3">
                  <Label htmlFor="wallPrice" className="text-xs font-semibold uppercase tracking-wider text-foreground/70">
                    Unlock Price (in your Creator Token)
                  </Label>
                  <Input
                    id="wallPrice"
                    type="number"
                    min={1}
                    step={1}
                    value={wallUnlockPrice}
                    onChange={(e) => setWallUnlockPrice(e.target.value)}
                    placeholder="e.g. 20"
                    className="h-9 border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,12%,0.6)]"
                  />
                  <p className="text-[0.65rem] text-foreground/50">
                    This is the token amount viewers must pay to unlock your content.
                  </p>
                </div>
              </div>
            )}
          </div>

          {attachedManifests.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold uppercase tracking-wider">Attachments</Label>
              <div className="flex flex-wrap gap-2">
                {attachedManifests.map((manifest) => (
                  <div
                    key={manifest.fileId}
                    className="flex items-center gap-2 rounded-md border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,12%,0.6)] px-3 py-2 text-sm"
                  >
                    <span className="max-w-[200px] truncate">{manifest.originalName}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => removeAttachment(manifest.fileId)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showFileUpload ? (
            <FileUpload
              onFilesReady={handleFilesReady}
              onEncryptingChange={setIsEncrypting}
              maxFiles={10}
              maxFileSize={1 * 1024 * 1024 * 1024}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowFileUpload(true)}
              className="border-[hsla(174,59%,56%,0.2)]"
            >
              Attach Files
            </Button>
          )}

          <div className="flex justify-end gap-3">
            {shouldShowCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={loading}
              >
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              disabled={loading || !content.trim() || isEncrypting}
              className="gap-2 bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] hover:opacity-90"
            >
              {loading ? "Publishing..." : isEncrypting ? "Encrypting…" : "Publish"}
            </Button>
          </div>
        </Card>
      </form>

      {showPostHistory && userPosts.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-display uppercase tracking-[0.2em] text-foreground">
            Your Posts
          </h2>
          {userPosts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
};
