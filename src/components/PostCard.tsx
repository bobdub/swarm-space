import { Share2, MoreHorizontal, Loader2, Coins, Pencil, Trash2, Ban, Eye, EyeOff } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Post, User } from "@/types";
import { get } from "@/lib/store";
import { decryptAndReassembleFile, importKeyRaw, Manifest } from "@/lib/fileEncryption";
import { ReactionPicker } from "@/components/ReactionPicker";
import { CommentThread } from "@/components/CommentThread";
import { addReaction, removeReaction, getReactionCounts, getUserReaction } from "@/lib/interactions";
import { useToast } from "@/hooks/use-toast";
import { Avatar } from "@/components/Avatar";
import { hymePost, CREDIT_REWARDS } from "@/lib/credits";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { updatePost, deletePost as removePost } from "@/lib/posts";
import { blockUser } from "@/lib/connections";
import { hidePostForUser } from "@/lib/hiddenPosts";
import { useP2PContext } from "@/contexts/P2PContext";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

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
  const [currentReaction, setCurrentReaction] = useState<string | null>(null);
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
  const [selectedHypeAmount, setSelectedHypeAmount] = useState<number>(CREDIT_REWARDS.HYPE_COST);
  const [isHyping, setIsHyping] = useState(false);
  const isAuthor = currentUser?.id === post.author;
  const nsfwHidden = Boolean(post.nsfw) && !showNSFWContent && !isAuthor && !isEditing;

  const reactionCounts = getReactionCounts(post.reactions || []);
  const totalReactions = Array.from(reactionCounts.values()).reduce((a, b) => a + b, 0);
  const hypeOptions = [5, 10, 20, 50];

  const getHypePreview = (amount: number) => {
    const burnAmount = Math.floor(amount * CREDIT_REWARDS.HYPE_BURN_PERCENTAGE);
    const rewardAmount = amount - burnAmount;
    return { burnAmount, rewardAmount };
  };

  const loadUserReaction = useCallback(async () => {
    const reaction = await getUserReaction(post.id);
    setCurrentReaction(reaction);
  }, [post.id]);

  const loadFiles = useCallback(async () => {
    if (!post.manifestIds || post.manifestIds.length === 0) {
      setFileUrls((prev) => {
        prev.forEach((url) => URL.revokeObjectURL(url));
        return [];
      });
      return;
    }

    setLoadingFiles(true);
    try {
      const urls: string[] = [];
      for (const fileId of post.manifestIds) {
        const manifest = await get("manifests", fileId) as Manifest;
        if (manifest) {
          if (!manifest.fileKey) {
            console.warn(`Manifest ${fileId} is missing its encryption key.`);
            continue;
          }

          const fileKey = await importKeyRaw(manifest.fileKey);
          const blob = await decryptAndReassembleFile(manifest, fileKey);
          urls.push(URL.createObjectURL(blob));
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
    }
  }, [post.manifestIds]);

  useEffect(() => {
    void loadUserReaction();
  }, [loadUserReaction]);

  useEffect(() => {
    setEditedContent(post.content);
    setEditedNSFW(Boolean(post.nsfw));
  }, [post.content, post.nsfw]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

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
      if (currentReaction === emoji) {
        await removeReaction(post.id);
        setCurrentReaction(null);
        toast({
          title: "Reaction removed",
        });
      } else {
        await addReaction(post.id, emoji);
        setCurrentReaction(emoji);
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

  const handleConfirmHype = async () => {
    setIsHyping(true);
    const { burnAmount, rewardAmount } = getHypePreview(selectedHypeAmount);

    try {
      await hymePost(post.id, selectedHypeAmount);
      toast({
        title: "Hyped! 🚀",
        description: `Post boosted with ${selectedHypeAmount} credits (${burnAmount} burned, ${rewardAmount} to creator)`,
      });
      setIsHypeDialogOpen(false);
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

  return (
    <div className="group relative overflow-hidden rounded-[26px]">
      <div className="absolute inset-0 rounded-[26px] bg-gradient-to-br from-[hsla(326,71%,62%,0.28)] via-transparent to-[hsla(174,59%,56%,0.28)] opacity-60 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="absolute inset-0 rounded-[26px] bg-[hsla(326,71%,62%,0.18)] opacity-0 blur-3xl transition-opacity duration-300 group-hover:opacity-60" />
      <Card className="relative rounded-[26px] border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.82)] p-6 text-foreground shadow-[0_30px_90px_hsla(244,70%,5%,0.65)] backdrop-blur-2xl transition-transform duration-300 group-hover:-translate-y-1">
        <div className="flex gap-5">
          <Link to={`/u/${post.author}`} className="flex-shrink-0">
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
              <div className="space-y-1">
                <Link
                  to={`/u/${post.author}`}
                  className="text-lg font-semibold tracking-[0.08em] text-foreground transition-colors hover:text-[hsl(326,71%,62%)]"
                >
                  {post.authorName || "Anonymous"}
                </Link>
                <div className="flex flex-wrap items-center gap-2 text-[0.65rem] font-display uppercase tracking-[0.35em] text-foreground/55">
                  <span>{timeAgo}</span>
                  {editedTimeAgo && (
                    <span className="text-foreground/45">· Edited {editedTimeAgo}</span>
                  )}
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
              ) : (
                <div className="space-y-3">
                  <div className="whitespace-pre-wrap text-base leading-relaxed text-foreground/75">
                    {post.content}
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

              {!nsfwHidden && post.manifestIds && post.manifestIds.length > 0 && (
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
                    </>
                  )}
                </>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4 text-foreground/60">
                {/* Reaction picker */}
                <ReactionPicker
                  onReactionSelect={handleReaction}
                  currentReaction={currentReaction}
                />

                {/* Reaction display */}
                {totalReactions > 0 && (
                  <div className="flex items-center gap-2">
                    {Array.from(reactionCounts.entries()).map(([emoji, count]) => (
                      <button
                        key={emoji}
                        onClick={() => handleReaction(emoji)}
                        className={`flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-all duration-200 hover:scale-105 ${
                          currentReaction === emoji
                            ? "border-[hsla(326,71%,62%,0.6)] bg-[hsla(326,71%,62%,0.2)]"
                            : "border-[hsla(174,59%,56%,0.18)] hover:border-[hsla(326,71%,62%,0.32)]"
                        }`}
                      >
                        <span>{emoji}</span>
                        <span className="text-foreground/70">{count}</span>
                      </button>
                    ))}
                  </div>
                )}

                <CommentThread postId={post.id} initialCount={post.commentCount} />

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsHypeDialogOpen(true)}
                  className="gap-2 rounded-full border border-transparent px-4 py-2 text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.55)] hover:text-foreground"
                >
                  <Coins className="h-4 w-4" />
                  <span className="text-xs">Hype</span>
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 rounded-full border border-transparent px-4 py-2 text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.55)] hover:text-foreground"
                >
                  <Share2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Dialog open={isHypeDialogOpen} onOpenChange={setIsHypeDialogOpen}>
        <DialogContent className="max-w-md border-[hsla(174,59%,56%,0.28)] bg-[hsla(245,70%,8%,0.92)] backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold uppercase tracking-[0.2em] text-foreground">
              Choose your hype boost
            </DialogTitle>
            <DialogDescription className="text-sm text-foreground/70">
              Select how many credits to invest. We preview the burn and reward split for every option so you can decide with
              confidence.
            </DialogDescription>
          </DialogHeader>

          <RadioGroup
            value={String(selectedHypeAmount)}
            onValueChange={(value) => setSelectedHypeAmount(Number(value))}
            className="mt-4 space-y-3"
          >
            {hypeOptions.map((amount) => {
              const { burnAmount, rewardAmount } = getHypePreview(amount);
              const value = amount.toString();
              const isSelected = amount === selectedHypeAmount;

              return (
                <div
                  key={value}
                  className={`flex items-center gap-4 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.55)] p-4 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.55)] ${
                    isSelected ? "border-[hsla(326,71%,62%,0.5)] shadow-[0_0_25px_hsla(326,71%,62%,0.22)]" : ""
                  }`}
                >
                  <RadioGroupItem value={value} id={`hype-${post.id}-${value}`} className="mt-1" />
                  <Label
                    htmlFor={`hype-${post.id}-${value}`}
                    className="flex cursor-pointer flex-1 flex-col gap-2 text-left text-foreground"
                  >
                    <span className="text-sm font-semibold uppercase tracking-[0.2em]">{amount} Credits</span>
                    <div className="grid grid-cols-2 gap-3 text-[0.7rem] text-foreground/70">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-[hsl(326,71%,62%)]" />
                        Burned {burnAmount}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-[hsl(174,59%,56%)]" />
                        Creator +{rewardAmount}
                      </div>
                    </div>
                    <p className="rounded-lg bg-[hsla(245,70%,14%,0.65)] px-3 py-2 text-[0.7rem] text-foreground/60">
                      Preview: boosts discovery lanes for {rewardAmount} credits while respectfully burning {burnAmount} back into the network.
                    </p>
                  </Label>
                </div>
              );
            })}
          </RadioGroup>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsHypeDialogOpen(false)}
              className="border-[hsla(174,59%,56%,0.25)] text-foreground/70 hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirmHype}
              disabled={isHyping}
              className="gap-2 bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)]"
            >
              {isHyping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
              {isHyping ? "Sending..." : `Boost ${selectedHypeAmount} credits`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
