import { useState, useEffect, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { MessageCircle, Send, Loader2 } from "lucide-react";
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
  const { toast } = useToast();

  const loadComments = useCallback(async () => {
    setIsLoading(true);
    try {
      const loadedComments = await getComments(postId);
      setComments(loadedComments);
    } catch (error) {
      console.error("Failed to load comments:", error);
    } finally {
      setIsLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    if (isOpen) {
      void loadComments();
    }
  }, [isOpen, loadComments]);

  useEffect(() => {
    const handleCommentUpdate = () => {
      if (isOpen) {
        void loadComments();
      }
    };

    window.addEventListener("p2p-comments-updated", handleCommentUpdate);
    return () => window.removeEventListener("p2p-comments-updated", handleCommentUpdate);
  }, [isOpen, loadComments]);

  const toggleComments = useCallback(() => {
    setIsOpen((previous) => !previous);
  }, []);

  const handleSubmit = async () => {
    if (!newComment.trim()) return;

    setIsSubmitting(true);
    try {
      const comment = await addComment(postId, newComment.trim());
      setComments((prev) => [...prev, comment]);
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

  const commentCount = comments.length || initialCount;

  return (
    <div className="flex flex-col">
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={toggleComments}
        className={`gap-2 rounded-full border border-transparent px-4 py-2 text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.55)] hover:text-foreground ${
          isOpen ? "border-[hsla(326,71%,62%,0.32)] bg-[hsla(245,70%,16%,0.55)] text-foreground" : ""
        }`}
        aria-expanded={isOpen}
        aria-controls={`comment-section-${postId}`}
      >
        <MessageCircle className="h-4 w-4" />
        <span>{commentCount}</span>
        <span className="text-[0.65rem] uppercase tracking-[0.25em] text-foreground/60">
          {isOpen ? "Hide" : "Comments"}
        </span>
      </Button>

      {isOpen && (
        <div id={`comment-section-${postId}`} className="mt-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <MessageCircle className="h-4 w-4" />
            <span>
              {commentCount} {commentCount === 1 ? "Comment" : "Comments"}
            </span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center rounded-xl border border-border/50 bg-background/40 py-8">
              <Loader2 className="h-6 w-6 animate-spin text-foreground/40" />
            </div>
          ) : comments.length === 0 ? (
            <div className="rounded-xl border border-border/50 bg-background/40 py-8 text-center text-sm text-foreground/40">
              No comments yet. Be the first to comment!
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-border/50 bg-background/40 p-4">
              {comments.map((comment) => (
                <div key={comment.id} className="flex gap-3 rounded-lg p-2 transition-colors hover:bg-background/60">
                  <Avatar
                    username={comment.author}
                    displayName={comment.authorName}
                    size="sm"
                    className="flex-shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {comment.authorName || "Anonymous"}
                      </span>
                      <span className="text-xs text-foreground/40">
                        {formatDistanceToNow(new Date(comment.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    <UserBadgeStrip userId={comment.author} size={20} maxBadges={2} />
                    <p className="text-sm text-foreground/80 whitespace-pre-wrap break-words">
                      {comment.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 rounded-xl border border-border/50 bg-background/40 p-4">
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write a comment..."
              className="min-h-[100px] resize-none rounded-lg border-border/50 bg-background/60 text-foreground placeholder:text-foreground/40 focus-visible:ring-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleSubmit();
                }
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground/40">Cmd/Ctrl + Enter to post</span>
              <Button
                onClick={handleSubmit}
                disabled={!newComment.trim() || isSubmitting}
                size="sm"
                className="gap-2"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Post Comment
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
