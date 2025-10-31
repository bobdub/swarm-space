import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FileUpload } from "@/components/FileUpload";
import { AccountSetupModal } from "@/components/AccountSetupModal";
import { PostCard } from "@/components/PostCard";
import { FolderOpen, X } from "lucide-react";
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

      const post: Post = {
        id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        author: user.id,
        authorName: user.displayName || user.username,
        authorAvatarRef: user.profile?.avatarRef,
        authorBannerRef: user.profile?.bannerRef,
        authorBadgeSnapshots: badgeSnapshots,
        projectId: projectIdForPost,
        type: postType,
        content: content.trim(),
        manifestIds,
        createdAt: new Date().toISOString(),
        nsfw: isNSFW,
        likes: 0,
        comments: [],
      };

      await put("posts", post);

      announceContent(post.id);
      broadcastPost(post);

      manifestIds.forEach((manifestId) => {
        announceContent(manifestId);
      });

      if (projectIdForPost) {
        await addPostToProject(projectIdForPost, post.id);
      }

      await awardPostCredits(post.id, user.id);

      await evaluateAchievementEvent({
        type: "post:created",
        userId: user.id,
        post,
      }).catch((error) => {
        console.warn("[PostComposer] Failed to evaluate achievements", error);
      });

      toast.success("Post created! +10 credits earned");

      setContent("");
      setAttachedManifests([]);
      setSelectedProjectId("");
      setIsNSFW(false);
      setShowFileUpload(false);

      void loadUserPosts();
      onPostCreated?.(post);
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
              maxFiles={10}
              maxFileSize={100 * 1024 * 1024}
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
              disabled={loading || !content.trim()}
              className="gap-2 bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] hover:opacity-90"
            >
              {loading ? "Publishing..." : "Publish"}
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
