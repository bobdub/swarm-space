import { useState, useEffect, useCallback, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { MessageCircle, Send, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Comment } from "@/types";
import { addComment, getComments } from "@/lib/interactions";
import { useToast } from "@/hooks/use-toast";
import { Avatar } from "@/components/Avatar";
import { UserBadgeStrip } from "@/components/UserBadgeStrip";

interface CommentThreadProps {
  postId: string;
  initialCount?: number;
}

export function CommentThread({ postId, initialCount = 0 }: CommentThreadProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const lastKnownCount = useRef(initialCount);
  const { toast } = useToast();

  const loadComments = useCallback(async () => {
    setIsLoading(true);
    try {
      const loadedComments = await getComments(postId);
      setComments(loadedComments);
      if (loadedComments.length > 0) {
        lastKnownCount.current = loadedComments.length;
      }
    } catch (error) {
      console.error("Failed to load comments:", error);
    } finally {
      setIsLoading(false);
    }
  }, [postId]);

  // Load comment count eagerly on mount (even when closed) so badge is accurate
  useEffect(() => {
    const loadCount = async () => {
      try {
        const loadedComments = await getComments(postId);
        if (loadedComments.length > 0) {
          lastKnownCount.current = loadedComments.length;
          setComments(loadedComments);
        }
      } catch {
        // silent
      }
    };
    void loadCount();
  }, [postId]);

  useEffect(() => {
    if (isOpen) {
      void loadComments();
    }
  }, [isOpen, loadComments]);

  // Keep count fresh from p2p updates
  useEffect(() => {
    const handleCommentUpdate = () => {
      void loadComments();
    };

    window.addEventListener("p2p-comments-updated", handleCommentUpdate);
    return () => window.removeEventListener("p2p-comments-updated", handleCommentUpdate);
  }, [loadComments]);

  const toggleComments = useCallback(() => {
    setIsOpen((previous) => !previous);
  }, []);

  const handleSubmit = async () => {
    if (!newComment.trim()) return;

    setIsSubmitting(true);
    try {
      const comment = await addComment(postId, newComment.trim());
      setComments((prev) => {
        const next = [...prev, comment];
        lastKnownCount.current = next.length;
        return next;
      });
      setNewComment("");
      toast({
        title: "Comment posted",
        description: "Your comment has been added.",
      });
    } catch (error) {
      console.error("Failed to post comment:", error);
      toast({
        title: "Failed to post comment",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const commentCount = comments.length > 0 ? comments.length : lastKnownCount.current;

  return (
    <div className="flex flex-col">
      {!isOpen && (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={toggleComments}
          className="gap-2 rounded-full border border-transparent px-4 py-2 text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.55)] hover:text-foreground"
          aria-expanded={false}
          aria-controls={`comment-section-${postId}`}
        >
          <MessageCircle className="h-4 w-4" />
          <span>{commentCount}</span>
          <span className="text-[0.65rem] uppercase tracking-[0.25em] text-foreground/60">
            Comments
          </span>
        </Button>
      )}

      {isOpen && (
        <div id={`comment-section-${postId}`} className="mt-2 space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
              <MessageCircle className="h-4 w-4" />
              <span>
                {commentCount} {commentCount === 1 ? "Comment" : "Comments"}
              </span>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center rounded-xl border border-border/30 bg-background/30 py-8">
              <Loader2 className="h-5 w-5 animate-spin text-foreground/40" />
            </div>
          ) : comments.length === 0 ? (
            <div className="rounded-xl border border-border/30 bg-background/30 py-6 text-center text-sm text-foreground/40">
              No comments yet. Be the first to comment!
            </div>
          ) : (
            <div className="space-y-2">
              {comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-xl border border-border/20 bg-background/30 px-4 py-3 transition-colors hover:bg-background/40"
                >
                  <div className="flex gap-3">
                    <Avatar
                      username={comment.author}
                      displayName={comment.authorName}
                      size="sm"
                      className="mt-0.5 flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {comment.authorName || "Anonymous"}
                        </span>
                        <UserBadgeStrip userId={comment.author} size={16} maxBadges={2} />
                        <span className="ml-auto text-[0.65rem] text-foreground/35">
                          {formatDistanceToNow(new Date(comment.createdAt), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm leading-relaxed text-foreground/75 whitespace-pre-wrap break-words">
                        {comment.text}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-border/30 bg-background/30 p-3">
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write a comment..."
              className="min-h-[80px] resize-none rounded-lg border-border/30 bg-background/40 text-sm text-foreground placeholder:text-foreground/35 focus-visible:ring-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleSubmit();
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[0.6rem] text-foreground/30">Ctrl + Enter to post</span>
              <Button
                onClick={handleSubmit}
                disabled={!newComment.trim() || isSubmitting}
                size="sm"
                className="gap-1.5 text-xs"
              >
                {isSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Post
              </Button>
            </div>
          </div>

          <div className="flex justify-center pt-1 pb-1">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={toggleComments}
              className="gap-1.5 rounded-full px-4 py-1.5 text-xs text-foreground/50 hover:text-foreground/80 hover:bg-background/40 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Close comments
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
