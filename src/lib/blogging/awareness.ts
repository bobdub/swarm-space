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

import { containsUrl } from "./links";

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

function isBlogOrBook(value: unknown): value is "blog" | "book" {
  return value === "blog" || value === "book";
}

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

function classifyBySignals(post: Post): BlogAwarenessResult {
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
 * Classify a single post.
 * Pure function — no side-effects, no network, no store writes.
 */
export function classifyPost(post: Post): BlogAwarenessResult {
  const bySignals = classifyBySignals(post);
  if (isBlogOrBook(post.blogClassification)) {
    return {
      ...bySignals,
      classification: post.blogClassification,
    };
  }

  return bySignals;
}

/**
 * Persist sticky long-form identity on posts.
 * Once a post becomes blog/book, keep explicit flags to prevent downgrade on peers.
 */
export function applyBlogIdentity(post: Post): Post {
  const bySignals = classifyBySignals(post);
  const explicit = post.blogClassification;
  const explicitIsBlog = isBlogOrBook(explicit);
  const shouldLock = explicitIsBlog || bySignals.classification === "blog" || bySignals.classification === "book";

  if (!shouldLock) {
    return post;
  }

  const nextClassification: BlogClassification =
    explicit === "book" || bySignals.classification === "book"
      ? "book"
      : "blog";

  if (post.blogLocked === true && post.blogClassification === nextClassification) {
    return post;
  }

  return {
    ...post,
    blogClassification: nextClassification,
    blogLocked: true,
  };
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
/**
 * Index of the line used as the blog title: the first non-empty line that
 * holds no link. Lines with links stay in the body so they remain
 * clickable there (the banner never shows links). -1 when there is none.
 */
export function findBlogTitleLineIndex(content: string): number {
  const lines = content.split("\n");
  return lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !containsUrl(trimmed);
  });
}

/**
 * The blog body. The title line is removed only when it is the post's first
 * line; when a link comes first, the post has no separate title line, so the
 * body keeps everything (the banner just borrows the first text line).
 */
export function extractBlogBody(content: string): string {
  const titleIndex = findBlogTitleLineIndex(content);
  const firstNonEmpty = content.split("\n").findIndex((line) => line.trim().length > 0);
  if (titleIndex < 0 || titleIndex !== firstNonEmpty) return content.trim();
  return content
    .split("\n")
    .filter((_, idx) => idx !== titleIndex)
    .join("\n")
    .trim();
}

export function extractBlogTitle(content: string): string {
  const titleIndex = findBlogTitleLineIndex(content);
  if (titleIndex < 0) return "Untitled";
  const trimmed = content.split("\n")[titleIndex].trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
}

/**
 * Extract the first URL from content for link-preview fallback.
 */
export function extractFirstUrl(content: string): string | null {
  const match = content.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}
