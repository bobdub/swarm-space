

# Blogging Awareness — Fix Plan

## Problems Found

1. **Classification too strict**: A post needs >= 1,000 chars AND >= 2 of 4 checks passing. A post with an image that's between 1,000-3,000 characters only passes ONE check (`hasMedia`), so it stays classified as "post". The user's story likely falls in this gap.

2. **Feed ignores classification**: `Index.tsx` always renders `<PostCard>` — it never imports or uses `classifyPost` or `BlogPostCard`. Even if classification works, blog-formatted posts never appear in the home feed.

3. **No blog count badge on Profile hero**: There's a "Blogs" tab but no visual indicator on the profile hero section showing how many blogs a user has.

---

## Plan

### Step 1 — Fix classification threshold (awareness.ts)

Lower the requirement from "2 of 4 checks" to "1 of 4 checks" when the post is >= 1,000 characters. This means a 1,000+ char post with an image qualifies as a blog. Keep the 2-check requirement only as an alternative path for shorter posts if desired, or simply: **>= 1,000 chars + at least 1 check = blog**.

### Step 2 — Render BlogPostCard in the home feed (Index.tsx)

Import `classifyPost` and `BlogPostCard`. When rendering posts, check classification: if "blog" or "book", render `<BlogPostCard>` instead of `<PostCard>`.

### Step 3 — Add blog count to Profile hero

Add a small stat or badge in the profile hero area showing the user's blog count (e.g., "3 Blogs") next to existing stats, linking to the Blogs tab on click.

### Step 4 — Also render BlogPostCard in Posts tab on Profile

In the Profile "Posts" tab, qualified posts should also render as `BlogPostCard` instead of `PostCard` so the formatting is consistent everywhere.

---

## Files to modify

- `src/lib/blogging/awareness.ts` — lower `MIN_CHECKS_FOR_BLOG` from 2 to 1
- `src/pages/Index.tsx` — import and conditionally render `BlogPostCard`
- `src/pages/Profile.tsx` — add blog count stat to hero; use `BlogPostCard` in posts tab for classified posts

