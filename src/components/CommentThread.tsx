import { useState, useEffect, useCallback, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { MessageCircle, Send, Loader2, X, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Comment } from "@/types";
import { addComment, getComments } from "@/lib/interactions";
import { useToast } from "@/hooks/use-toast";
import { Avatar } from "@/components/Avatar";
import { UserBadgeStrip } from "@/components/UserBadgeStrip";
import { ENTITY_USER_ID } from "@/lib/p2p/entityVoice";
import { MentionPopover } from "@/components/MentionPopover";
import { containsEntityMention, buildMentionCache } from "@/lib/mentions";

interface CommentThreadProps {
  postId: string;
  initialCount?: number;
}

/** Render text with @mentions as clickable Links */
function renderTextWithMentions(text: string): React.ReactNode[] {
  const MENTION_RE = /@(\w+)/g;
  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  const mentionCache = buildMentionCache();

  while ((m = MENTION_RE.exec(text)) !== null) {
    if (m.index > lastIdx) nodes.push(text.slice(lastIdx, m.index));
    const username = m[1];
    const isEntity = ['infinity', 'imagination'].includes(username.toLowerCase());
    const resolvedId = mentionCache.get(username.toLowerCase());

    if (resolvedId) {
      nodes.push(
        <Link
          key={`mention-${m.index}`}
          to={isEntity ? `/u/${ENTITY_USER_ID}?tab=posts#posts-feed` : `/u/${resolvedId}?tab=posts#posts-feed`}
          className={isEntity ? 'font-semibold text-primary hover:underline' : 'font-medium text-[hsl(326,71%,62%)] hover:underline'}
        >
          @{username}
        </Link>
      );
    } else {
      nodes.push(
        <span
          key={`mention-${m.index}`}
          className={isEntity ? 'font-semibold text-primary' : 'font-medium text-[hsl(326,71%,62%)]'}
        >
          @{username}
        </span>
      );
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) nodes.push(text.slice(lastIdx));
  if (nodes.length === 0) nodes.push(text);
  return nodes;
}

const COLLAPSE_THRESHOLD = 300;

function CommentBody({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > COLLAPSE_THRESHOLD;
  const displayText = isLong && !expanded ? text.slice(0, COLLAPSE_THRESHOLD) + '…' : text;

  return (
    <div className="mt-1 text-[0.8rem] leading-snug text-foreground/70 whitespace-pre-wrap break-words">
      {renderTextWithMentions(displayText)}
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-1 text-[0.7rem] font-medium text-primary hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

export function CommentThread({ postId, initialCount = 0 }: CommentThreadProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const lastKnownCount = useRef(initialCount);
  const commentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
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

  // Eager load on mount so badge count is accurate
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

      // If @Infinity or @Imagination was mentioned, force entity reply
      if (containsEntityMention(newComment)) {
        try {
          window.dispatchEvent(new CustomEvent('p2p-comment-created', {
            detail: { comment: { ...comment, _forceEntityReply: true } }
          }));
        } catch { /* non-critical */ }
      }

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
      {/* Open button — only when closed */}
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
        <div id={`comment-section-${postId}`} className="mt-2 space-y-2">
          {/* Header */}
          <div className="flex items-center px-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/60">
              <MessageCircle className="h-3.5 w-3.5" />
              <span>
                {commentCount} {commentCount === 1 ? "comment" : "comments"}
              </span>
            </div>
          </div>

          {/* Comment list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-foreground/40" />
            </div>
          ) : comments.length === 0 ? (
            <div className="py-4 text-center text-xs text-foreground/35">
              No comments yet — be the first!
            </div>
          ) : (
            <div className="space-y-1">
              {comments.map((comment) => {
                const isEntity = comment.author === ENTITY_USER_ID;
                return (
                <div
                  key={comment.id}
                  className={`flex gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-background/30 ${isEntity ? 'border-l-2 border-primary/30' : ''}`}
                >
                  {isEntity ? (
                    <Link
                      to={`/u/${ENTITY_USER_ID}?tab=posts#posts-feed`}
                      className="flex-shrink-0 mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary transition-all duration-200 hover:scale-105"
                    >
                      <Brain className="h-4 w-4" />
                    </Link>
                  ) : (
                    <Link to={`/u/${comment.author}?tab=posts#posts-feed`} className="flex-shrink-0 mt-0.5">
                      <Avatar
                        avatarRef={comment.authorAvatarRef}
                        username={comment.author}
                        displayName={comment.authorName}
                        size="sm"
                        className="transition-all duration-200 hover:scale-105"
                      />
                    </Link>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isEntity ? (
                        <Link
                          to={`/u/${ENTITY_USER_ID}?tab=posts#posts-feed`}
                          className="text-xs font-semibold text-primary flex items-center gap-1 hover:underline"
                        >
                          Ξ {comment.authorName || "Imagination"}
                        </Link>
                      ) : (
                        <Link
                          to={`/u/${comment.author}?tab=posts#posts-feed`}
                          className="text-xs font-semibold text-foreground truncate max-w-[120px] hover:text-[hsl(326,71%,62%)] transition-colors"
                        >
                          {comment.authorName || "Anonymous"}
                        </Link>
                      )}
                      {!isEntity && <UserBadgeStrip userId={comment.author} size={14} maxBadges={2} />}
                      <span className="text-[0.6rem] text-foreground/30 whitespace-nowrap">
                        {formatDistanceToNow(new Date(comment.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    <CommentBody text={comment.text} />
                  </div>
                </div>
                );
              })}
            </div>
          )}

          {/* Compose */}
          <div className="relative rounded-lg border border-border/20 bg-background/20 p-2.5">
            <Textarea
              ref={commentTextareaRef}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write a comment... Use @username to mention"
              className="min-h-[60px] resize-none rounded-md border-border/20 bg-background/30 text-xs text-foreground placeholder:text-foreground/30 focus-visible:ring-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleSubmit();
                }
              }}
            />
            <MentionPopover
              textareaRef={commentTextareaRef}
              value={newComment}
              onSelect={(username, start, end) => {
                const before = newComment.slice(0, start);
                const after = newComment.slice(end);
                setNewComment(`${before}@${username} ${after}`);
                setTimeout(() => {
                  const pos = start + username.length + 2;
                  commentTextareaRef.current?.setSelectionRange(pos, pos);
                  commentTextareaRef.current?.focus();
                }, 0);
              }}
            />
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[0.55rem] text-foreground/25">Ctrl+Enter</span>
              <Button
                onClick={handleSubmit}
                disabled={!newComment.trim() || isSubmitting}
                size="sm"
                className="h-7 gap-1 px-3 text-[0.65rem]"
              >
                {isSubmitting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Post
              </Button>
            </div>
          </div>

          {/* Close — below input */}
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={toggleComments}
              className="h-7 gap-1 rounded-full px-3 text-[0.6rem] text-foreground/40 hover:text-foreground/70 hover:bg-background/30 transition-colors"
            >
              <X className="h-3 w-3" />
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
