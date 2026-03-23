import { useMemo } from "react";
import type { ReactNode } from "react";
import { BookOpen, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Post } from "@/types";
import type { BlogAwareness } from "@/lib/blogAwareness";
import { extractBlogTitle, estimateReadTime } from "@/lib/blogAwareness";

const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

const normalizeUrl = (rawUrl: string): string =>
  rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

const extractFirstUrl = (content: string): string | null => {
  const match = URL_REGEX.exec(content);
  URL_REGEX.lastIndex = 0;
  return match ? normalizeUrl(match[0]) : null;
};

const extractDomain = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
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
      </a>,
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

interface BlogPostCardContentProps {
  post: Post;
  awareness: BlogAwareness;
  /** Decrypted attachment URLs passed from PostCard */
  heroAttachment?: { url: string; mime: string } | null;
}

export function BlogPostCardContent({
  post,
  awareness,
  heroAttachment,
}: BlogPostCardContentProps) {
  const { title, body } = useMemo(
    () => extractBlogTitle(post.content),
    [post.content],
  );

  const readTime = useMemo(
    () => estimateReadTime(awareness.charCount),
    [awareness.charCount],
  );

  const firstUrl = useMemo(() => {
    if (awareness.hasLinks) return extractFirstUrl(post.content);
    return null;
  }, [awareness.hasLinks, post.content]);

  const isBook = awareness.type === "book";

  // Split body into paragraphs on double newlines
  const paragraphs = useMemo(() => {
    if (!body) return [];
    return body
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
  }, [body]);

  return (
    <div className="space-y-4">
      {/* Blog/Book badge + read time */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={`gap-1.5 border-[hsla(174,59%,56%,0.35)] px-2.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.35em] ${
            isBook
              ? "bg-[hsla(326,71%,62%,0.15)] text-[hsl(326,71%,72%)]"
              : "bg-[hsla(174,59%,56%,0.12)] text-[hsl(174,59%,72%)]"
          }`}
        >
          <BookOpen className="h-3 w-3" />
          {isBook ? "BOOK" : "BLOG"}
        </Badge>
        <span className="flex items-center gap-1 text-[0.6rem] font-display uppercase tracking-[0.3em] text-foreground/45">
          <Clock className="h-3 w-3" />
          {readTime} min read
        </span>
        {isBook && (
          <Badge
            variant="outline"
            className="border-[hsla(326,71%,62%,0.3)] bg-[hsla(326,71%,62%,0.1)] px-2 py-0 text-[0.55rem] uppercase tracking-[0.25em] text-[hsl(326,71%,68%)]"
          >
            Torrent-Served
          </Badge>
        )}
      </div>

      {/* Hero section */}
      {heroAttachment ? (
        <div className="overflow-hidden rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)]">
          {heroAttachment.mime.startsWith("video/") ? (
            <video
              src={heroAttachment.url}
              controls
              preload="metadata"
              className="w-full max-h-[400px] object-cover"
            />
          ) : (
            <img
              src={heroAttachment.url}
              alt="Blog hero"
              className="w-full max-h-[400px] object-cover"
            />
          )}
        </div>
      ) : firstUrl ? (
        <a
          href={firstUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-2xl border border-[hsla(174,59%,56%,0.22)] bg-[hsla(245,70%,12%,0.55)] px-5 py-4 transition-colors hover:border-[hsla(326,71%,62%,0.35)]"
        >
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[hsla(174,59%,56%,0.15)]">
            <BookOpen className="h-5 w-5 text-[hsl(174,59%,66%)]" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground/80">
              {extractDomain(firstUrl)}
            </div>
            <div className="truncate text-xs text-foreground/45">{firstUrl}</div>
          </div>
        </a>
      ) : (
        <div className="flex items-center justify-center rounded-2xl border border-[hsla(174,59%,56%,0.15)] bg-gradient-to-br from-[hsla(326,71%,62%,0.08)] to-[hsla(174,59%,56%,0.08)] py-8">
          <img
            src="/icons/blog-quill.svg"
            alt="Blog post"
            className="h-16 w-16 opacity-60"
          />
        </div>
      )}

      {/* Title */}
      <h2 className="font-display text-xl leading-tight tracking-[0.08em] text-foreground md:text-2xl">
        {title}
      </h2>

      {/* Body — blog typography */}
      {paragraphs.length > 0 && (
        <div className="space-y-4 text-[0.9rem] leading-[1.8] text-foreground/70">
          {paragraphs.map((paragraph, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {renderContentWithLinks(paragraph)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
