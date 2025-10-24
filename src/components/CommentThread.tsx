import { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { MessageCircle, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Comment } from "@/types";
import { addComment, getComments } from "@/lib/interactions";
import { useToast } from "@/hooks/use-toast";

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

  useEffect(() => {
    if (isOpen) {
      loadComments();
    }
  }, [isOpen, postId]);

  const loadComments = async () => {
    setIsLoading(true);
    try {
      const loadedComments = await getComments(postId);
      setComments(loadedComments);
    } catch (error) {
      console.error("Failed to load comments:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!newComment.trim()) return;

    setIsSubmitting(true);
    try {
      const comment = await addComment(postId, newComment.trim());
      setComments([...comments, comment]);
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

  if (!isOpen) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="gap-2 rounded-full border border-transparent px-4 py-2 text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.55)] hover:text-foreground"
      >
        <MessageCircle className="h-4 w-4" />
        <span>{commentCount}</span>
      </Button>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] p-5 backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-foreground/70">
          <MessageCircle className="h-4 w-4" />
          <span>{commentCount} {commentCount === 1 ? "comment" : "comments"}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(false)}
          className="h-7 px-3 text-xs text-foreground/60 hover:text-foreground"
        >
          Hide
        </Button>
      </div>

      {/* Comment input */}
      <div className="space-y-2">
        <Textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Write a comment..."
          className="min-h-[80px] resize-none rounded-xl border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.65)] text-foreground placeholder:text-foreground/40"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleSubmit();
            }
          }}
        />
        <div className="flex justify-end">
          <Button
            onClick={handleSubmit}
            disabled={!newComment.trim() || isSubmitting}
            size="sm"
            className="gap-2 rounded-full bg-[hsla(326,71%,62%,0.85)] text-white hover:bg-[hsla(326,71%,62%,1)]"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Post
          </Button>
        </div>
      </div>

      {/* Comments list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-foreground/40" />
        </div>
      ) : comments.length === 0 ? (
        <div className="py-8 text-center text-sm text-foreground/40">
          No comments yet. Be the first to comment!
        </div>
      ) : (
        <div className="space-y-4">
          {comments.map((comment) => (
            <div key={comment.id} className="space-y-2">
              <div className="flex gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-[hsla(326,71%,62%,0.35)] bg-[hsla(253,82%,6%,0.65)] text-xs font-display uppercase tracking-wider text-[hsl(326,71%,62%)]">
                  {comment.authorName?.[0]?.toUpperCase() || "A"}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
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
                  <p className="text-sm text-foreground/75 whitespace-pre-wrap">
                    {comment.text}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
