/**
 * Blogging Awareness — standalone post classification utility.
 *
 * Runs *after* post creation and never touches working features or networks.
 * A post is considered for blog formatting when it exceeds 1,000 characters
 * and passes at least one of the following checks:
 *   1. Has media (manifestIds)
 *   2. Contains links
 *   3. Is over 3,000 characters
 *   4. Is over 250,000 characters (flagged as "book")
 *
 * Books (>250k chars) must be torrent-wrapped before serving.
 */

import type { Post } from "@/types";

// ── Classification types ─────────────────────────────────────────

export type BlogClassification = "post" | "blog" | "book";

export interface BlogAwarenessResult {
  classification: BlogClassification;
  /** True when the post meets the 1,000-char threshold */
  considered: boolean;
  /** Individual check results */
  checks: {
    hasMedia: boolean;
    hasLinks: boolean;
    over3k: boolean;
    over250k: boolean;
  };
  /** Number of checks that passed (0-4) */
  passedCount: number;
}

// ── Helpers ──────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+/i;

function contentHasLinks(content: string): boolean {
  return URL_REGEX.test(content);
}

function postHasMedia(post: Post): boolean {
  const hasManifestIds = Boolean(post.manifestIds && post.manifestIds.length > 0);
  const hasMediaIntent = post.type === "image" || post.type === "video" || post.type === "file";
  return hasManifestIds || hasMediaIntent;
}

// ── Core classification ──────────────────────────────────────────

const BLOG_THRESHOLD = 1_000;
const LONG_FORM_THRESHOLD = 3_000;
const BOOK_THRESHOLD = 250_000;
const MIN_CHECKS_FOR_BLOG = 1;

/**
 * Classify a single post.
 * Pure function — no side-effects, no network, no store writes.
 */
export function classifyPost(post: Post): BlogAwarenessResult {
  const charCount = (post.content ?? "").length;
  const considered = charCount >= BLOG_THRESHOLD;

  const checks = {
    hasMedia: postHasMedia(post),
    hasLinks: contentHasLinks(post.content ?? ""),
    over3k: charCount >= LONG_FORM_THRESHOLD,
    over250k: charCount >= BOOK_THRESHOLD,
  };

  const passedCount = Object.values(checks).filter(Boolean).length;

  if (!considered || passedCount < MIN_CHECKS_FOR_BLOG) {
    return { classification: "post", considered, checks, passedCount };
  }

  if (checks.over250k) {
    return { classification: "book", considered, checks, passedCount };
  }

  return { classification: "blog", considered, checks, passedCount };
}

/**
 * Filter an array of posts to only those classified as blogs (or books).
 */
export function filterBlogPosts(posts: Post[]): Post[] {
  return posts.filter((p) => {
    const { classification } = classifyPost(p);
    return classification === "blog" || classification === "book";
  });
}

// ── Title extraction ─────────────────────────────────────────────

/**
 * Extract a display title from the post content.
 * Uses the first non-empty line, trimmed to 120 chars.
 */
export function extractBlogTitle(content: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
    }
  }
  return "Untitled";
}

/**
 * Extract the first URL from content for link-preview fallback.
 */
export function extractFirstUrl(content: string): string | null {
  const match = content.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}
