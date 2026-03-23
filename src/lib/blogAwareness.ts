import type { Post } from "@/types";

export const BLOG_THRESHOLD = 1_000;
export const LONG_BLOG_THRESHOLD = 3_000;
export const BOOK_THRESHOLD = 250_000;

const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

export interface BlogAwareness {
  type: "post" | "blog" | "book";
  hasMedia: boolean;
  hasLinks: boolean;
  charCount: number;
}

export function getBlogAwareness(post: Post): BlogAwareness {
  const charCount = post.content.length;
  const hasMedia = (post.manifestIds?.length ?? 0) > 0;
  const hasLinks = URL_REGEX.test(post.content);
  // Reset regex lastIndex after test
  URL_REGEX.lastIndex = 0;

  if (charCount < BLOG_THRESHOLD) {
    return { type: "post", hasMedia, hasLinks, charCount };
  }

  const isLong = charCount >= LONG_BLOG_THRESHOLD;
  const isBook = charCount >= BOOK_THRESHOLD;

  // Count how many consideration checks pass
  let score = 0;
  if (hasMedia) score++;
  if (hasLinks) score++;
  if (isLong) score++;
  if (isBook) score++;

  if (score >= 2) {
    return {
      type: isBook ? "book" : "blog",
      hasMedia,
      hasLinks,
      charCount,
    };
  }

  return { type: "post", hasMedia, hasLinks, charCount };
}

/** Extract a title from the first line of content (up to 120 chars) */
export function extractBlogTitle(content: string): { title: string; body: string } {
  const firstNewline = content.indexOf("\n");
  if (firstNewline > 0 && firstNewline <= 120) {
    return {
      title: content.slice(0, firstNewline).trim(),
      body: content.slice(firstNewline + 1).trim(),
    };
  }
  // No short first line — use first 120 chars
  if (content.length > 120) {
    const cutoff = content.lastIndexOf(" ", 120);
    const end = cutoff > 60 ? cutoff : 120;
    return {
      title: content.slice(0, end).trim(),
      body: content.slice(end).trim(),
    };
  }
  return { title: content.trim(), body: "" };
}

/** Estimate reading time in minutes */
export function estimateReadTime(charCount: number): number {
  // Average 5 chars per word, 238 WPM reading speed
  const words = charCount / 5;
  return Math.max(1, Math.ceil(words / 238));
}
