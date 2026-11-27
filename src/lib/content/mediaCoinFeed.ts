/**
 * mediaCoinFeed — one feed post per piece of Media Coin content.
 *
 * Content identity is the merkleRoot, never a coinId or post id. Posts
 * carrying exactly the same Media Coin content collapse into the earliest
 * one; the later posts' authors become its "Supported by" names.
 */
import type { Post } from "@/types";

/** Content key of a post's Media Coin media, or null for other posts. */
export function mediaCoinContentKeyOf(post: Post): string | null {
  const roots = (post.mediaCoins ?? []).map((m) => m?.merkleRoot).filter((r): r is string => typeof r === "string" && r.length > 0);
  return roots.length ? [...new Set(roots)].sort().join("|") : null;
}

const time = (p: Post) => {
  const t = new Date(p.createdAt).getTime();
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
};

/** Drop duplicate posts of the same content, keeping input order. */
export function dedupeMediaCoinPosts(posts: Post[]): Post[] {
  const keeper = new Map<string, Post>();
  for (const p of posts) {
    const key = mediaCoinContentKeyOf(p);
    if (!key) continue;
    const cur = keeper.get(key);
    if (!cur || time(p) < time(cur) || (time(p) === time(cur) && p.id < cur.id)) keeper.set(key, p);
  }
  const supporters = new Map<string, Set<string>>();
  for (const p of posts) {
    const key = mediaCoinContentKeyOf(p);
    if (!key) continue;
    const keep = keeper.get(key)!;
    if (keep === p || p.author === keep.author) continue;
    if (!supporters.has(key)) supporters.set(key, new Set());
    supporters.get(key)!.add(p.authorName || p.author);
  }
  const out: Post[] = [];
  for (const p of posts) {
    const key = mediaCoinContentKeyOf(p);
    if (!key) { out.push(p); continue; }
    if (keeper.get(key) !== p) continue;
    const names = supporters.get(key);
    out.push(names?.size ? { ...p, _mediaSupporters: Array.from(names) } : p);
  }
  return out;
}
