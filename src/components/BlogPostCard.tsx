import { useMemo } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { BookOpen, ExternalLink } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/Avatar";
import {
  classifyPost,
  extractBlogTitle,
  extractFirstUrl,
  type BlogClassification,
} from "@/lib/blogging/awareness";
import type { Post } from "@/types";
import blogQuillIcon from "@/assets/blog-quill-icon.png";

interface BlogPostCardProps {
  post: Post;
}

/**
 * Blog-formatted card — replaces the standard PostCard layout
 * for posts classified as "blog" or "book" by the awareness system.
 */
export function BlogPostCard({ post }: BlogPostCardProps) {
  const awareness = useMemo(() => classifyPost(post), [post]);
  const title = useMemo(() => extractBlogTitle(post.content), [post.content]);
  const firstUrl = useMemo(() => extractFirstUrl(post.content), [post.content]);
  const isBook = awareness.classification === "book";
  const hasMedia = awareness.checks.hasMedia;

  const timeAgo = formatDistanceToNow(new Date(post.createdAt), { addSuffix: true });
  const wordCount = (post.content ?? "").split(/\s+/).filter(Boolean).length;
  const readMinutes = Math.max(1, Math.round(wordCount / 200));

  // Excerpt: strip the title line and take the next ~280 chars
  const excerpt = useMemo(() => {
    const lines = post.content.split("\n");
    const bodyStart = lines.findIndex((l, i) => i > 0 && l.trim().length > 0);
    const body = bodyStart >= 0 ? lines.slice(bodyStart).join(" ").trim() : "";
    return body.length > 280 ? `${body.slice(0, 277)}…` : body;
  }, [post.content]);

  return (
    <Link to={`/post/${post.id}`} className="block group">
      <Card className="overflow-hidden border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.82)] backdrop-blur-2xl transition-all duration-300 hover:border-[hsla(174,59%,56%,0.35)] hover:shadow-[0_20px_60px_hsla(326,71%,62%,0.12)]">
        {/* Hero area */}
        <HeroSection
          hasMedia={hasMedia}
          firstUrl={firstUrl}
          classification={awareness.classification}
        />

        {/* Content */}
        <div className="space-y-4 p-5 md:p-6">
          {/* Classification badge */}
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className="rounded-lg border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,12%,0.6)] text-[hsl(174,59%,76%)] text-[10px] uppercase tracking-[0.25em]"
            >
              {isBook ? "Book" : "Blog"}
            </Badge>
            <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/40">
              {readMinutes} min read
            </span>
          </div>

          {/* Title */}
          <h3 className="font-display text-lg leading-snug tracking-[0.08em] text-foreground group-hover:text-[hsl(174,59%,76%)] transition-colors md:text-xl">
            {title}
          </h3>

          {/* Excerpt */}
          {excerpt && (
            <p className="text-sm leading-relaxed text-foreground/60 line-clamp-3">
              {excerpt}
            </p>
          )}

          {/* Footer */}
          <div className="flex items-center gap-3 border-t border-[hsla(174,59%,56%,0.1)] pt-4">
            <Avatar
              avatarRef={post.authorAvatarRef}
              username={post.authorName || post.author}
              size="sm"
              className="h-7 w-7"
            />
            <span className="text-xs font-display uppercase tracking-[0.2em] text-foreground/55">
              {post.authorName || post.author}
            </span>
            <span className="ml-auto text-[10px] text-foreground/35">{timeAgo}</span>
          </div>

          {isBook && (
            <div className="rounded-xl border border-[hsla(326,71%,62%,0.2)] bg-[hsla(326,71%,62%,0.06)] px-4 py-3 text-xs text-[hsl(326,71%,62%)]">
              <BookOpen className="mr-2 inline-block h-3.5 w-3.5" />
              This book is torrent-wrapped — download via SWARM to read the full text.
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}

// ── Hero sub-component ───────────────────────────────────────────

function HeroSection({
  hasMedia,
  firstUrl,
  classification,
}: {
  hasMedia: boolean;
  firstUrl: string | null;
  classification: BlogClassification;
}) {
  // If post has attached media, PostCard already decrypts images —
  // for the blog card we show a gradient hero with the quill as accent.
  // Future: decrypt hero image inline if needed.

  if (hasMedia) {
    return (
      <div className="relative h-40 bg-gradient-to-br from-[hsla(326,71%,62%,0.2)] via-[hsla(245,70%,12%,0.6)] to-[hsla(174,59%,56%,0.2)]">
        <div className="absolute inset-0 flex items-center justify-center opacity-30">
          <img src={blogQuillIcon} alt="" className="h-16 w-16 object-contain" aria-hidden />
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[hsla(245,70%,8%,0.95)] to-transparent" />
      </div>
    );
  }

  if (firstUrl) {
    return (
      <div className="relative flex h-40 items-center justify-center bg-gradient-to-br from-[hsla(245,70%,14%,0.8)] to-[hsla(174,59%,56%,0.08)]">
        <div className="flex flex-col items-center gap-2 opacity-60">
          <ExternalLink className="h-8 w-8 text-[hsl(174,59%,56%)]" />
          <span className="max-w-[240px] truncate text-[10px] uppercase tracking-[0.15em] text-foreground/40">
            {firstUrl}
          </span>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[hsla(245,70%,8%,0.95)] to-transparent" />
      </div>
    );
  }

  // Fallback: custom quill icon
  return (
    <div className="relative flex h-40 items-center justify-center bg-gradient-to-br from-[hsla(326,71%,62%,0.15)] via-[hsla(245,70%,10%,0.7)] to-[hsla(174,59%,56%,0.12)]">
      <img
        src={blogQuillIcon}
        alt={classification === "book" ? "Book" : "Blog"}
        className="h-20 w-20 object-contain drop-shadow-[0_0_24px_hsla(326,71%,62%,0.4)]"
      />
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[hsla(245,70%,8%,0.95)] to-transparent" />
    </div>
  );
}
