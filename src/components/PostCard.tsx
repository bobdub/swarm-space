import { Share2, MoreHorizontal, Loader2, Coins, Pencil, Trash2, Ban, Eye, EyeOff } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Post, User, PostMetrics } from "@/types";
import { get } from "@/lib/store";
import { decryptAndReassembleFile, importKeyRaw, Manifest } from "@/lib/fileEncryption";
import { ReactionPicker } from "@/components/ReactionPicker";
import { CommentThread } from "@/components/CommentThread";
import { StreamPostCardContent } from "@/components/streaming/StreamPostCardContent";
import {
  addReaction,
  removeReaction,
  getReactionCounts,
  getUserReactions,
} from "@/lib/interactions";
import { useToast } from "@/hooks/use-toast";
import { Avatar } from "@/components/Avatar";
import { hymePost, CREDIT_REWARDS } from "@/lib/credits";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { UserBadgeStrip } from "@/components/UserBadgeStrip";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { updatePost, deletePost as removePost } from "@/lib/posts";
import { blockUser } from "@/lib/connections";
import { hidePostForUser } from "@/lib/hiddenPosts";
import { useP2PContext } from "@/contexts/P2PContext";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ensurePostMetrics, recordPostView } from "@/lib/postMetrics";


const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

const normalizeUrl = (rawUrl: string): string => (rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);

const extractYoutubeVideoIds = (content: string): string[] => {
  const pattern = new RegExp(URL_REGEX);
  const ids = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const href = normalizeUrl(match[0]);

    try {
      const url = new URL(href);
      const hostname = url.hostname.toLowerCase();

      if (hostname === "youtu.be") {
        const pathId = url.pathname.split("/").filter(Boolean)[0];
        if (pathId) {
          ids.add(pathId);
        }
        continue;
      }

      if (!hostname.endsWith("youtube.com")) {
        continue;
      }

      const segments = url.pathname.split("/").filter(Boolean);

      if (segments.length === 0 || segments[0] === "watch") {
        const id = url.searchParams.get("v");
        if (id) {
          ids.add(id);
        }
        continue;
      }

      const [firstSegment, secondSegment] = segments;
      if (firstSegment === "embed" || firstSegment === "shorts" || firstSegment === "live" || firstSegment === "v") {
        const id = secondSegment ?? segments[segments.length - 1];
        if (id) {
          ids.add(id);
        }
      }
    } catch {
      // Ignore malformed URLs when attempting to build embeds
    }
  }

  return Array.from(ids);
};

const renderContentWithLinks = (content: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const urlPattern = new RegExp(URL_REGEX);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(content)) !== null) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      nodes.push(content.slice(lastIndex, matchIndex));
    }

    const rawUrl = match[0];
    const href = normalizeUrl(rawUrl);

    nodes.push(
      <a
        key={`link-${matchIndex}-${rawUrl}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[hsl(174,59%,76%)] underline-offset-4 hover:underline"
      >
        {rawUrl}
      </a>
    );

    lastIndex = matchIndex + rawUrl.length;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  if (nodes.length === 0) {
    nodes.push(content);
  }

  return nodes;
};

interface PostCardProps {
  post: Post;
}

export function PostCard({ post }: PostCardProps) {
  const timeAgo = formatDistanceToNow(new Date(post.createdAt), { addSuffix: true });
  const editedTimeAgo = post.editedAt
    ? formatDistanceToNow(new Date(post.editedAt), { addSuffix: true })
    : null;
  const [fileUrls, setFileUrls] = useState<string[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [userReactions, setUserReactions] = useState<Set<string>>(() => new Set());
  const [authorAvatarRef, setAuthorAvatarRef] = useState<string | undefined>(post.authorAvatarRef);
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const { broadcastPost } = useP2PContext();
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(post.content);
  const [editedNSFW, setEditedNSFW] = useState(Boolean(post.nsfw));
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [isHidingPost, setIsHidingPost] = useState(false);
  const [showNSFWContent, setShowNSFWContent] = useState(false);
  const [isHypeDialogOpen, setIsHypeDialogOpen] = useState(false);
  const [hypeAmountInput, setHypeAmountInput] = useState<string>(String(CREDIT_REWARDS.HYPE_COST));
  const [isHyping, setIsHyping] = useState(false);
  const [postMetrics, setPostMetrics] = useState<PostMetrics | null>(null);
  const [pendingManifestIds, setPendingManifestIds] = useState<string[]>([]);
  const isAuthor = currentUser?.id === post.author;
  const nsfwHidden = Boolean(post.nsfw) && !showNSFWContent && !isAuthor && !isEditing;
  const isStreamPost = post.type === "stream" && Boolean(post.stream);
  const hasRecordedView = useRef(false);
  const youtubeVideoIds = useMemo(() => extractYoutubeVideoIds(post.content), [post.content]);

  const reactionCounts = getReactionCounts(post.reactions || []);
  const totalReactions = Array.from(reactionCounts.values()).reduce((a, b) => a + b, 0);
  const minHypeAmount = CREDIT_REWARDS.MIN_TRANSFER;
  const maxHypeAmount = CREDIT_REWARDS.MAX_TRANSFER;

  const getHypePreview = (amount: number) => {
    const burnAmount = Math.floor(amount * CREDIT_REWARDS.HYPE_BURN_PERCENTAGE);
    const postLoadAmount = amount - burnAmount;
    return { burnAmount, postLoadAmount };
  };

  const trimmedHypeAmountInput = hypeAmountInput.trim();
  const parsedHypeAmount = trimmedHypeAmountInput === "" ? Number.NaN : Number(trimmedHypeAmountInput);
  const hypeAmountError = (() => {
    if (trimmedHypeAmountInput === "") {
      return "Enter how many credits you'd like to invest.";
    }

    if (!Number.isFinite(parsedHypeAmount)) {
      return "Enter a valid number of credits.";
    }

    if (!Number.isInteger(parsedHypeAmount)) {
      return "Amount must be a whole number.";
    }

    if (parsedHypeAmount < minHypeAmount) {
      return `Minimum hype is ${minHypeAmount} credit${minHypeAmount === 1 ? "" : "s"}.`;
    }

    if (parsedHypeAmount > maxHypeAmount) {
      return `Maximum hype is ${maxHypeAmount} credits.`;
    }

    return null;
  })();

  const hypeAmount = hypeAmountError ? null : parsedHypeAmount;
  const hypePreview = getHypePreview(hypeAmount ?? 0);
  const postCreditTotal = postMetrics?.creditTotal ?? 0;
  const formattedPostCreditTotal = new Intl.NumberFormat().format(postCreditTotal);
  const postCreditLabel = postCreditTotal === 1 ? "credit" : "credits";
  const authorPostsLink = `/u/${post.author}?tab=posts#posts-feed`;

  const loadUserReactions = useCallback(async () => {
    const reactions = await getUserReactions(post.id);
    setUserReactions(new Set(reactions));
  }, [post.id]);

  const loadFiles = useCallback(async () => {
    if (!post.manifestIds || post.manifestIds.length === 0) {
      setFileUrls((prev) => {
        prev.forEach((url) => URL.revokeObjectURL(url));
        return [];
      });
      setPendingManifestIds([]);
      return;
    }

    setLoadingFiles(true);
    const missingManifests: string[] = [];
    try {
      const urls: string[] = [];
      for (const fileId of post.manifestIds) {
        const manifest = await get("manifests", fileId) as Manifest | undefined;
        if (!manifest) {
          if (!missingManifests.includes(fileId)) {
            missingManifests.push(fileId);
          }
          continue;
        }

        if (!manifest.fileKey) {
          console.warn(`Manifest ${fileId} is missing its encryption key.`);
          if (!missingManifests.includes(fileId)) {
            missingManifests.push(fileId);
          }
          continue;
        }

        try {
          const fileKey = await importKeyRaw(manifest.fileKey);
          const blob = await decryptAndReassembleFile(manifest, fileKey);
          urls.push(URL.createObjectURL(blob));
        } catch (error) {
          console.error(`Failed to decrypt manifest ${fileId}:`, error);
          if (!missingManifests.includes(fileId)) {
            missingManifests.push(fileId);
          }
        }
      }
      setFileUrls((prev) => {
        prev.forEach((url) => URL.revokeObjectURL(url));
        return urls;
      });
    } catch (error) {
      console.error("Failed to load files:", error);
    } finally {
      setLoadingFiles(false);
      setPendingManifestIds(missingManifests);
    }
  }, [post.manifestIds]);

  const fetchPostMetrics = useCallback(async (): Promise<PostMetrics | null> => {
    try {
      return await ensurePostMetrics(post.id);
    } catch (error) {
      console.error("Failed to load post metrics:", error);
      return null;
    }
  }, [post.id]);

  useEffect(() => {
    void loadUserReactions();
  }, [loadUserReactions]);

  useEffect(() => {
    if (hasRecordedView.current) {
      return;
    }
    hasRecordedView.current = true;
    void recordPostView(post.id);
  }, [post.id]);

  useEffect(() => {
    setEditedContent(post.content);
    setEditedNSFW(Boolean(post.nsfw));
  }, [post.content, post.nsfw]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (pendingManifestIds.length === 0) {
      return;
    }

    const retryTimeout = window.setTimeout(() => {
      void loadFiles();
    }, 4000);

    return () => {
      window.clearTimeout(retryTimeout);
    };
  }, [pendingManifestIds, loadFiles]);

  useEffect(() => {
    let cancelled = false;

    const loadMetrics = async () => {
      const metrics = await fetchPostMetrics();
      if (!cancelled) {
        setPostMetrics(metrics);
      }
    };

    void loadMetrics();

    return () => {
      cancelled = true;
    };
  }, [fetchPostMetrics]);

  useEffect(() => {
    setAuthorAvatarRef(post.authorAvatarRef);
  }, [post.authorAvatarRef]);

  useEffect(() => {
    if (post.authorAvatarRef) return;

    let cancelled = false;

    const loadAuthorAvatar = async () => {
      try {
        const author = (await get("users", post.author)) as User | undefined;
        const avatarRef = author?.profile?.avatarRef;
        if (!cancelled && avatarRef) {
          setAuthorAvatarRef(avatarRef);
        }
      } catch (error) {
        console.error("Failed to load author avatar:", error);
      }
    };

    void loadAuthorAvatar();

    return () => {
      cancelled = true;
    };
  }, [post.author, post.authorAvatarRef]);

  useEffect(() => {
    return () => {
      fileUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [fileUrls]);

  useEffect(() => {
    if (!post.nsfw) {
      setShowNSFWContent(false);
    }
  }, [post.nsfw]);

  const handleReaction = async (emoji: string) => {
    try {
      const hasReaction = userReactions.has(emoji);
      if (hasReaction) {
        const updatedPost = await removeReaction(post.id, emoji);
        setUserReactions((prev) => {
          const next = new Set(prev);
          next.delete(emoji);
          return next;
        });
        broadcastPost(updatedPost);
        toast({
          title: "Reaction removed",
        });
      } else {
        const updatedPost = await addReaction(post.id, emoji);
        setUserReactions((prev) => {
          const next = new Set(prev);
          next.add(emoji);
          return next;
        });
        broadcastPost(updatedPost);
        toast({
          title: "Reacted!",
          description: `You reacted with ${emoji}`,
        });
      }
    } catch (error) {
      console.error("Failed to react:", error);
      toast({
        title: "Failed to react",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleHypeDialogChange = (open: boolean) => {
    setIsHypeDialogOpen(open);
    if (!open) {
      setHypeAmountInput(String(CREDIT_REWARDS.HYPE_COST));
    }
  };

  const handleConfirmHype = async () => {
    if (!hypeAmount) {
      toast({
        title: "Choose a hype amount",
        description: hypeAmountError ?? `Enter a value between ${minHypeAmount} and ${maxHypeAmount} credits.`,
        variant: "destructive",
      });
      return;
    }

    setIsHyping(true);
    const { burnAmount, postLoadAmount } = getHypePreview(hypeAmount);

    try {
      await hymePost(post.id, hypeAmount);
      toast({
        title: "Hyped! 🚀",
        description: `Post boosted with ${hypeAmount} credits (${postLoadAmount} loaded on post, ${burnAmount} burned)`,
      });
      const metrics = await fetchPostMetrics();
      if (metrics) {
        setPostMetrics(metrics);
      }
      handleHypeDialogChange(false);
    } catch (error) {
      console.error("Failed to hype:", error);
      toast({
        title: "Failed to hype",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsHyping(false);
    }
  };

  const handleStartEditing = () => {
    setIsEditing(true);
    if (post.nsfw) {
      setShowNSFWContent(true);
    }
  };

  const handleCancelEditing = () => {
    setIsEditing(false);
    setEditedContent(post.content);
    setEditedNSFW(Boolean(post.nsfw));
  };

  const handleSaveEdit = async () => {
    if (!editedContent.trim()) {
      toast({
        title: "Content required",
        description: "Post content cannot be empty.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const updated = await updatePost(post.id, {
        content: editedContent.trim(),
        nsfw: editedNSFW,
      });
      broadcastPost(updated);
      toast({
        title: "Post updated",
      });
      setIsEditing(false);
      if (!editedNSFW) {
        setShowNSFWContent(false);
      }
      window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
    } catch (error) {
      console.error("Failed to update post:", error);
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isAuthor) return;
    const confirmed = window.confirm("Delete this post? This action cannot be undone.");
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await removePost(post.id);
      toast({
        title: "Post deleted",
      });
      window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
    } catch (error) {
      console.error("Failed to delete post:", error);
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBlockUser = async () => {
    if (!currentUser || isAuthor) return;

    setIsBlocking(true);
    try {
      await blockUser(currentUser.id, post.author);
      toast({
        title: "User blocked",
        description: "Their future posts will be hidden from your feed.",
      });
      window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
    } catch (error) {
      console.error("Failed to block user:", error);
      toast({
        title: "Block failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsBlocking(false);
    }
  };

  const handleHidePost = async () => {
    if (!currentUser || isAuthor) return;

    setIsHidingPost(true);
    try {
      await hidePostForUser(currentUser.id, post.id);
      toast({
        title: "Post hidden",
        description: "We'll keep this out of your feeds.",
      });
      window.dispatchEvent(new CustomEvent("p2p-posts-updated"));
    } catch (error) {
      console.error("Failed to hide post:", error);
      toast({
        title: "Hide failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsHidingPost(false);
    }
  };

  const canBlockUser = Boolean(currentUser) && !isAuthor;
  const canHidePost = Boolean(currentUser) && !isAuthor;

  const handleShare = useCallback(async () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const permalink = origin ? `${origin}/posts/${post.id}` : `/posts/${post.id}`;
    const normalizedContent = post.content.replace(/\s+/g, " ").trim();
    const preview = normalizedContent.length > 160 ? `${normalizedContent.slice(0, 157)}…` : normalizedContent;

    if (typeof navigator !== "undefined" && navigator.share) {
      const shareData: ShareData = {
        title: post.authorName ? `${post.authorName} on Imagination Network` : "Imagination Network Post",
        url: permalink,
      };
      if (preview) {
        shareData.text = preview;
      }

      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        console.warn("navigator.share failed, falling back to clipboard:", error);
      }
    }

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(permalink);
        toast({
          title: "Link copied",
          description: "Post permalink copied to your clipboard.",
        });
        return;
      } catch (error) {
        console.error("Failed to copy permalink to clipboard:", error);
      }
    }

    toast({
      title: "Sharing unavailable",
      description: `Copy this link manually: ${permalink}`,
      variant: "destructive",
    });
  }, [post.authorName, post.content, post.id, toast]);

  return (
    <div id={`post-${post.id}`} className="group relative overflow-hidden rounded-[26px]">
      <div className="absolute inset-0 rounded-[26px] bg-gradient-to-br from-[hsla(326,71%,62%,0.28)] via-transparent to-[hsla(174,59%,56%,0.28)] opacity-60 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="absolute inset-0 rounded-[26px] bg-[hsla(326,71%,62%,0.18)] opacity-0 blur-3xl transition-opacity duration-300 group-hover:opacity-60" />
      <Card className="relative rounded-[26px] border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.82)] p-6 text-foreground shadow-[0_30px_90px_hsla(244,70%,5%,0.65)] backdrop-blur-2xl transition-transform duration-300 group-hover:-translate-y-1">
        <div className="flex gap-5">
          <Link to={authorPostsLink} className="flex-shrink-0">
            <Avatar
              avatarRef={authorAvatarRef}
              username={post.author}
              displayName={post.authorName}
              size="lg"
              className="transition-all duration-200 hover:scale-105"
            />
          </Link>

          <div className="min-w-0 flex-1 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <Link
                  to={authorPostsLink}
                  className="text-lg font-semibold tracking-[0.08em] text-foreground transition-colors hover:text-[hsl(326,71%,62%)]"
                >
                  {post.authorName || "Anonymous"}
                </Link>
                <UserBadgeStrip
                  userId={post.author}
                  size={26}
                  className="pt-0.5"
                  fallbackBadgeSnapshots={post.authorBadgeSnapshots}
                />
                <div className="flex flex-wrap items-center gap-2 text-[0.65rem] font-display uppercase tracking-[0.35em] text-foreground/55">
                  <Link
                    to={`/posts/${post.id}`}
                    className="flex flex-wrap items-center gap-2 text-foreground/55 transition-colors hover:text-[hsl(326,71%,62%)]"
                  >
                    <span>{timeAgo}</span>
                    {editedTimeAgo && (
                      <span className="text-foreground/45">· Edited {editedTimeAgo}</span>
                    )}
                  </Link>
                  {post.nsfw && (
                    <Badge
                      variant="outline"
                      className="border-red-400/40 bg-red-500/10 px-2 py-0 text-[0.55rem] font-semibold uppercase tracking-[0.3em] text-red-300"
                    >
                      NSFW
                    </Badge>
                  )}
                </div>
              </div>
              {(isAuthor || canBlockUser || canHidePost) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-full border border-[hsla(174,59%,56%,0.2)] text-foreground/60 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.65)] hover:text-foreground"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {isAuthor && (
                      <>
                        <DropdownMenuItem
                          onSelect={(event) => {
                            event.preventDefault();
                            handleStartEditing();
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit Post
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={(event) => {
                            event.preventDefault();
                            void handleDelete();
                          }}
                          disabled={isDeleting}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {isDeleting ? "Deleting…" : "Delete Post"}
                        </DropdownMenuItem>
                      </>
                    )}
                    {canHidePost && (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          void handleHidePost();
                        }}
                        disabled={isHidingPost}
                      >
                        <EyeOff className="mr-2 h-4 w-4" />
                        {isHidingPost ? "Hiding…" : "Hide Post"}
                      </DropdownMenuItem>
                    )}
                    {canBlockUser && (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          void handleBlockUser();
                        }}
                        disabled={isBlocking}
                      >
                        <Ban className="mr-2 h-4 w-4" />
                        {isBlocking ? "Blocking…" : "Block User"}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            <div className="space-y-5">
              {isEditing ? (
                <div className="space-y-4">
                  <Textarea
                    value={editedContent}
                    onChange={(event) => setEditedContent(event.target.value)}
                    className="min-h-[160px] border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,12%,0.55)]"
                  />
                  <div className="flex items-start justify-between gap-4 rounded-md border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,12%,0.45)] px-4 py-3">
                    <div>
                      <Label htmlFor={`nsfw-edit-${post.id}`} className="text-xs font-semibold uppercase tracking-[0.25em]">
                        NSFW Content
                      </Label>
                      <p className="text-xs text-foreground/60">
                        Sensitive posts stay hidden until viewers opt in.
                      </p>
                    </div>
                    <Switch
                      id={`nsfw-edit-${post.id}`}
                      checked={editedNSFW}
                      onCheckedChange={setEditedNSFW}
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={handleCancelEditing}
                      disabled={isSaving}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSaveEdit}
                      disabled={isSaving}
                      className="bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)]"
                    >
                      {isSaving ? "Saving…" : "Save Changes"}
                    </Button>
                  </div>
                </div>
              ) : nsfwHidden ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] px-6 py-8 text-center text-sm text-foreground/70 backdrop-blur">
                  <p>This post is marked as sensitive.</p>
                  <Button
                    size="sm"
                    onClick={() => setShowNSFWContent(true)}
                    className="gap-2"
                  >
                    <Eye className="h-4 w-4" /> Reveal content
                  </Button>
                </div>
              ) : isStreamPost ? (
                <StreamPostCardContent post={post} />
              ) : (
                <div className="space-y-3">
                  <div className="whitespace-pre-wrap text-base leading-relaxed text-foreground/75">
                    {renderContentWithLinks(post.content)}
                  </div>
                  {post.nsfw && !isAuthor && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2 text-foreground/60 hover:text-foreground"
                      onClick={() => setShowNSFWContent(false)}
                    >
                      <EyeOff className="h-4 w-4" /> Hide content
                    </Button>
                  )}
                </div>
              )}

              {!nsfwHidden && !isStreamPost && (post.manifestIds?.length ?? 0) > 0 && (
                <>
                  {loadingFiles ? (
                    <div className="flex aspect-video items-center justify-center rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] text-sm text-foreground/60 backdrop-blur">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : (
                    <>
                      {post.type === "image" && fileUrls.length > 0 && (
                        <div className="rounded-2xl border border-[hsla(174,59%,56%,0.18)] overflow-hidden bg-[hsla(245,70%,12%,0.45)] backdrop-blur">
                          <img
                            src={fileUrls[0]}
                            alt="Post attachment"
                            className="w-full h-auto max-h-[500px] object-contain"
                          />
                        </div>
                      )}

                      {post.type === "video" && fileUrls.length > 0 && (
                        <div className="rounded-2xl border border-[hsla(174,59%,56%,0.18)] overflow-hidden bg-[hsla(245,70%,12%,0.45)] backdrop-blur">
                          <video
                            src={fileUrls[0]}
                            controls
                            className="w-full h-auto max-h-[500px]"
                          >
                            Your browser does not support video playback.
                          </video>
                        </div>
                      )}

                      {post.type === "file" && (
                        <div className="flex items-center gap-3 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] px-5 py-4 text-sm text-foreground/70 backdrop-blur">
                          {post.manifestIds.length} file(s) attached
                        </div>
                      )}

                      {fileUrls.length === 0 && pendingManifestIds.length > 0 && (
                        <div className="flex items-center gap-3 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] px-5 py-4 text-sm text-foreground/70 backdrop-blur">
                          <Loader2 className="h-4 w-4 animate-spin text-[hsl(174,59%,66%)]" />
                          <span>Waiting for attachments to sync across the mesh…</span>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {!nsfwHidden &&
                !isStreamPost &&
                post.type !== "text" &&
                (!post.manifestIds || post.manifestIds.length === 0) && (
                <div className="flex items-center gap-3 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] px-5 py-4 text-sm text-foreground/70 backdrop-blur">
                  <Loader2 className="h-4 w-4 animate-spin text-[hsl(174,59%,66%)]" />
                  <span>Attachment metadata is syncing across the mesh…</span>
                </div>
              )}

              {!nsfwHidden &&
                !isStreamPost &&
                youtubeVideoIds.length > 0 &&
                fileUrls.length === 0 &&
                (!post.manifestIds || post.manifestIds.length === 0) && (
                  <div className="space-y-3">
                    {youtubeVideoIds.map((videoId) => (
                      <div
                        key={videoId}
                        className="rounded-2xl border border-[hsla(174,59%,56%,0.18)] overflow-hidden bg-[hsla(245,70%,12%,0.45)] backdrop-blur"
                      >
                        <div className="aspect-video">
                          <iframe
                            src={`https://www.youtube.com/embed/${videoId}`}
                            title={`YouTube video player ${videoId}`}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                            loading="lazy"
                            referrerPolicy="strict-origin-when-cross-origin"
                            className="h-full w-full"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4 text-foreground/60">
                <div className="flex items-center gap-2 rounded-full border border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,16%,0.45)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-foreground/80">
                  <Coins className="h-3.5 w-3.5 text-[hsl(174,59%,66%)]" />
                  <span>
                    {formattedPostCreditTotal} {postCreditLabel}
                  </span>
                </div>

                {/* Reaction picker */}
                <ReactionPicker
                  onReactionSelect={handleReaction}
                  currentReactions={Array.from(userReactions)}
                />

                {/* Reaction display */}
                {totalReactions > 0 && (
                  <div className="flex items-center gap-2">
                    {Array.from(reactionCounts.entries()).map(([emoji, count]) => {
                      const isSelected = userReactions.has(emoji);
                      return (
                      <button
                        key={emoji}
                        onClick={() => handleReaction(emoji)}
                        className={`flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-all duration-200 hover:scale-105 ${
                          isSelected
                            ? "border-[hsla(326,71%,62%,0.6)] bg-[hsla(326,71%,62%,0.2)]"
                            : "border-[hsla(174,59%,56%,0.18)] hover:border-[hsla(326,71%,62%,0.32)]"
                        }`}
                      >
                        <span>{emoji}</span>
                        <span className="text-foreground/70">{count}</span>
                      </button>
                      );
                    })}
                  </div>
                )}

                <CommentThread postId={post.id} initialCount={post.commentCount} />

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleHypeDialogChange(true)}
                  className="gap-2 rounded-full border border-transparent px-4 py-2 text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.55)] hover:text-foreground"
                >
                  <Coins className="h-4 w-4" />
                  <span className="text-xs">Hype</span>
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleShare}
                  className="gap-2 rounded-full border border-transparent px-4 py-2 text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.55)] hover:text-foreground"
                  aria-label="Share post"
                  title="Share post"
                >
                  <Share2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Dialog open={isHypeDialogOpen} onOpenChange={handleHypeDialogChange}>
        <DialogContent className="max-w-md border-[hsla(174,59%,56%,0.28)] bg-[hsla(245,70%,8%,0.92)] backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold uppercase tracking-[0.2em] text-foreground">
              Choose your hype boost
            </DialogTitle>
            <DialogDescription className="text-sm text-foreground/70">
              Enter how many credits to invest. We'll preview how much loads onto the post and how much burns back into the network.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label
                htmlFor={`hype-amount-${post.id}`}
                className="text-sm font-semibold uppercase tracking-[0.2em] text-foreground"
              >
                Hype amount
              </Label>
              <div className="flex items-center gap-3">
                <Input
                  id={`hype-amount-${post.id}`}
                  type="number"
                  min={minHypeAmount}
                  max={maxHypeAmount}
                  step={1}
                  inputMode="numeric"
                  value={hypeAmountInput}
                  onChange={(event) => setHypeAmountInput(event.target.value)}
                  className="h-11 w-full rounded-xl border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.55)] text-sm text-foreground placeholder:text-foreground/40 focus-visible:ring-[hsl(326,71%,62%)]"
                />
                <span className="text-xs font-semibold uppercase tracking-[0.25em] text-foreground/60">Credits</span>
              </div>
            </div>

            <p className="text-xs text-foreground/50">
              Choose any whole number between {minHypeAmount} and {maxHypeAmount} credits.
            </p>

            {hypeAmountError ? (
              <p className="text-xs font-medium text-[hsl(326,71%,62%)]">{hypeAmountError}</p>
            ) : null}

            <div className="rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.55)] p-4 text-[0.7rem] text-foreground/70 shadow-[0_0_25px_hsla(326,71%,62%,0.12)]">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[hsl(326,71%,62%)]" />
                  Burned {hypePreview.burnAmount}
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[hsl(174,59%,56%)]" />
                  Post +{hypePreview.postLoadAmount}
                </div>
              </div>
              <p className="mt-3 rounded-lg bg-[hsla(245,70%,14%,0.65)] px-3 py-2 text-[0.7rem] text-foreground/60">
                {hypeAmount
                  ? `Preview: boosts discovery lanes by loading ${hypePreview.postLoadAmount} credits onto the post while respectfully burning ${hypePreview.burnAmount}.`
                  : "Enter a whole number to see how the hype splits between post load and burn."}
              </p>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleHypeDialogChange(false)}
              className="border-[hsla(174,59%,56%,0.25)] text-foreground/70 hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirmHype}
              disabled={isHyping || !hypeAmount}
              className="gap-2 bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)]"
            >
              {isHyping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
              {isHyping ? "Sending..." : hypeAmount ? `Boost ${hypeAmount} credits` : "Boost credits"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
