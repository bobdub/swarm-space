## Plan: Blogging Awareness — Auto-Format Long Posts + Books

### Concept

Posts over 1,000 characters are evaluated for "blog" formatting. A simple awareness check runs at render time (no new data model needed — uses existing `Post` fields). Posts flagged as "books" (250,000+ chars) get torrent-wrapped for distribution.

### Blog Awareness Logic

A utility function `getBlogAwareness(post: Post)` returns the post's content classification:

```text
Post < 1,000 chars         → "post" (normal)
Post ≥ 1,000 chars          → run consideration checks:
  1. Has media? (manifestIds.length > 0)
  2. Has links? (URL_REGEX matches in content)
  3. Over 3,000 chars?
  4. Over 250,000 chars?

  If ≥ 2 checks pass → "blog"
  If check #4 passes → "book"
  Otherwise           → "post" (normal)
```

No database changes — this is a pure render-time classification based on existing `Post` fields.

### Files & Changes

#### 1. New: `src/lib/blogAwareness.ts`

- `getBlogAwareness(post): { type: "post" | "blog" | "book", hasMedia, hasLinks, charCount }` — the core classifier
- Constants: `BLOG_THRESHOLD = 1000`, `LONG_BLOG_THRESHOLD = 3000`, `BOOK_THRESHOLD = 250000`

#### 2. New: `src/components/BlogPostCard.tsx`

Blog-formatted rendering for posts classified as "blog":

- **Hero section**: If post has media attachments, display the first image/video as a full-width hero. If no media but has links, show link preview card (og-style with URL + domain). If neither renders, show a generated "writing" emoji/icon (a custom SVG of a quill/pen — saved as `public/icons/blog-quill.svg`).
- **Title extraction**: Use the post title of `post.content` as the blog title (up to first `\n` or first 120 chars). Render in large `font-display` heading style.
- **Body**: Remaining content rendered with larger line-height, paragraph spacing (split on double newlines), and the same link rendering as PostCard.
- **Blog badge**: Small "BLOG" badge next to timestamp.
- **Book badge**: If type is "book", show "BOOK" badge instead + a note that it's torrent-served.

#### 3. Modified: `src/components/PostCard.tsx`

- Import `getBlogAwareness` and `BlogPostCard`
- At the top of the component, check: if `awareness.type !== "post"`, delegate rendering to `<BlogPostCard post={post} awareness={awareness} />`
- This keeps all existing PostCard logic (reactions, comments, menus) intact — BlogPostCard only replaces the content/media area inside the card shell

#### 4. Modified: `src/pages/Profile.tsx`

- Add "Blogs" tab to the profile tabs (between "Posts" and "Projects")
- Filter: `posts.filter(p => getBlogAwareness(p).type === "blog" || getBlogAwareness(p).type === "book")`
- Render filtered posts using `<PostCard>` (which auto-delegates to BlogPostCard)
- Update `TabKey` type and `TAB_VALUES` array
- Update grid from `grid-cols-2 md:grid-cols-4` to `grid-cols-2 md:grid-cols-5`

#### 5. New: `public/icons/blog-quill.svg`

A custom quill/writing icon SVG used as the fallback hero when a blog post has no media and no renderable link preview. Simple line-art style matching existing icons in `public/icons/`.

#### 6. Book Torrent Wrapping (250,000+ chars)

- In `PostComposer.tsx`, after creating a post, if content ≥ 250,000 chars:
  - Serialize the content as a text blob
  - Create an encrypted manifest via existing `fileEncryption` pipeline
  - Attach the manifestId to the post
  - Truncate `post.content` to the first 1,000 chars + `\n\n[Full book available via torrent — click to download]`
  - The original full text is served via the existing torrent swarming system
- This ensures books don't bloat IndexedDB replication — peers receive the truncated preview and fetch the full text on demand

### Technical Details

- Blog awareness is computed at render time — no migration, no new store, no new fields on `Post`
- The `BlogPostCard` component wraps the same card shell (reactions, comments, dropdown menu) — it only changes the content area
- Book torrent wrapping reuses the existing `FileUpload` → `fileEncryption` → `announceContent` pipeline
- Profile "Blogs" tab uses the same `PostCard` component, which auto-formats via awareness
-  Blog style | Scifi mixed with ebook.